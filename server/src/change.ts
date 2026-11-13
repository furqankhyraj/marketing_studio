// Change requests: revise a post's spec from plain words (LLM), with a simple rule-based fallback.
import type { Post, ReelSpec, CarouselSpec } from "../../shared/types.ts";
import { nowIso } from "./config.ts";
import { getBrand, getPost, updatePost } from "./db.ts";
import { askJson, llmAvailable } from "./llm.ts";
import { getStyles } from "./engines.ts";
import { isCarouselSpec, isHtmlSpec, isReelSpec, normalizeSpec, type AnySpec } from "./posts.ts";
import { enqueueRender } from "./render.ts";
import { specLanguage, languageGuide } from "./language.ts";
import { imageHeuristicChange } from "./imagepost.ts";

const CHANGE_SYSTEM = `You revise Instagram post render specs based on the owner's plain-words feedback.
You get {post: {type, title, hook, caption, hashtags, spec}, request, styles, captionStyles}.
Return JSON {"title": string, "hook": string, "caption": string, "hashtags": string[], "spec": <revised spec, same schema>}.
Keep everything the request doesn't ask to change. Keep width/height/fps/brand. For reels keep 5-7 scenes (stories 1-3), carousels 5-8 slides.
If you change scene text also update its voiceoverText. If the spec has engine "hyperframes", edit its html carefully and keep it valid.
Use only the listed style ids.
Image posts (spec.kind "image", one 1080x1350 graphic): keep kind/width/height/brand.name; edit headline, eyebrow, body, bullets (max 4), cta, options, author, price, oldPrice, badge, design (quote|tip|product|offer|testimonial|question|before-after|fact), style, brand.colors. Never invent reviews, prices or statistics.
Hashtags: at most 5 (Instagram limit), specific niche keywords, no "#". Caption stays search-first: line 1 = hook containing the main keyword; end with one clear CTA.`;

function quoted(text: string): string | undefined {
  return text.match(/["“'‘]([^"”'’]{2,120})["”'’]/)?.[1];
}

/** Rule-based edits. Returns a description of what changed (empty if nothing). */
async function heuristicChange(post: Post, text: string): Promise<{ post: Partial<Post>; changed: string[] }> {
  if (post.type === "image") {
    // single-image posts: text fields, design, style, colors (imagepost.ts)
    const r = imageHeuristicChange(post, text, (await getStyles()).styles);
    return { post: { ...r.meta, spec: r.spec }, changed: r.changed };
  }
  const spec = structuredClone(post.spec) as AnySpec;
  const out: Partial<Post> = {};
  const changed: string[] = [];
  const t = text.trim();
  const after = (re: RegExp) => t.match(re)?.[1]?.trim().replace(/^["“']|["”']$/g, "");

  const hook = after(/(?:hook|headline|title|first (?:line|scene|slide))\s*(?:to|:|=|should be|->)\s*(.+)$/i);
  if (hook) {
    if (isReelSpec(spec) && spec.scenes[0]) {
      spec.scenes[0].headline = hook;
      spec.scenes[0].voiceoverText = hook;
    }
    if (isCarouselSpec(spec) && spec.slides[0]) spec.slides[0].headline = hook;
    out.hook = hook;
    changed.push("hook");
  }
  const cta = after(/(?:cta|call to action|end card)\s*(?:to|:|=|should be|->)\s*(.+)$/i);
  if (cta && isReelSpec(spec)) {
    const kw = cta.match(/comment\s+([A-Z0-9]{3,12})/i)?.[1]?.toUpperCase();
    spec.cta = { text: cta, keyword: kw ?? spec.cta?.keyword };
    changed.push("cta");
  }
  const caption = after(/caption\s*(?:to|:|=|should be|->)\s*(.+)$/i);
  if (caption) {
    out.caption = caption;
    changed.push("caption");
  }
  if (isReelSpec(spec)) {
    if (/\b(shorter|faster|quicker|too long)\b/i.test(t)) {
      spec.scenes = spec.scenes.map((s) => ({ ...s, durationSec: Math.max(1.5, Math.round(s.durationSec * 0.75 * 10) / 10) }));
      changed.push("pace");
    } else if (/\b(longer|slower|too fast)\b/i.test(t)) {
      spec.scenes = spec.scenes.map((s) => ({ ...s, durationSec: Math.min(8, Math.round(s.durationSec * 1.3 * 10) / 10) }));
      changed.push("pace");
    }
    if (/\bno captions?\b|remove captions?/i.test(t)) {
      delete spec.captionStyle;
      changed.push("captions");
    }
  }
  if (!isHtmlSpec(spec)) {
    const { styles, captionStyles } = await getStyles();
    const lower = t.toLowerCase();
    const st = styles.find((s) => lower.includes(s.id.toLowerCase()) || lower.includes(s.name.toLowerCase()));
    if (st && st.id !== (spec as ReelSpec | CarouselSpec).style) {
      (spec as ReelSpec | CarouselSpec).style = st.id;
      changed.push("style");
    }
    const cs = captionStyles.find((c) => lower.includes(c.id.toLowerCase()) || lower.includes(c.name.toLowerCase() + " caption"));
    if (cs && isReelSpec(spec)) {
      spec.captionStyle = cs.id;
      changed.push("captionStyle");
    }
    if (!changed.length) {
      // Fallback: quoted text becomes the new hook; otherwise switch to a different visual style.
      const q = quoted(t);
      if (q) {
        if (isReelSpec(spec) && spec.scenes[0]) {
          spec.scenes[0].headline = q;
          spec.scenes[0].voiceoverText = q;
        }
        if (isCarouselSpec(spec) && spec.slides[0]) spec.slides[0].headline = q;
        out.hook = q;
        changed.push("hook");
      } else {
        const kind = isCarouselSpec(spec) ? "carousel" : post.type;
        const pool = styles.filter((s) => s.supports.includes(kind as any));
        const cur = (spec as ReelSpec).style;
        const i = pool.findIndex((s) => s.id === cur);
        const next = pool[(i + 1) % Math.max(1, pool.length)];
        if (next) {
          (spec as ReelSpec).style = next.id;
          changed.push("style");
        }
      }
    }
  }
  out.spec = spec;
  return { post: out, changed };
}

export async function requestChange(postId: string, text: string): Promise<Post> {
  if ((getPost(postId)?.spec as { engine?: string } | undefined)?.engine === "clip") return (await import("./clips.ts")).clipChange(postId, text); // clips: trim/extend/retitle
  const p = updatePost(postId, (x) => {
    x.status = "changes_requested";
    x.error = undefined;
    x.changeRequests.push({ text, createdAt: nowIso() });
  });
  if (!p) throw new Error("Post not found");
  // revise asynchronously, then re-render
  (async () => {
    try {
      const brand = getBrand(p.brandId)!;
      let patch: Partial<Post> | undefined;
      if (llmAvailable()) {
        try {
          const { styles, captionStyles } = await getStyles();
          const guide = languageGuide(specLanguage(p.spec as any, brand)); // keep Urdu posts in Urdu script
          const raw = await askJson<any>(
            guide ? `${CHANGE_SYSTEM}\n${guide} (Unless the request asks for another language.)` : CHANGE_SYSTEM,
            JSON.stringify({
              post: { type: p.type, title: p.title, hook: p.hook, caption: p.caption, hashtags: p.hashtags, spec: p.spec },
              request: text,
              styles: styles.map((s) => ({ id: s.id, supports: s.supports })),
              captionStyles: captionStyles.map((c) => c.id),
            }),
            12000,
          );
          const spec = normalizeSpec(p.type, raw?.spec ?? p.spec, brand);
          patch = {
            title: typeof raw?.title === "string" && raw.title ? raw.title : p.title,
            hook: typeof raw?.hook === "string" && raw.hook ? raw.hook : p.hook,
            caption: typeof raw?.caption === "string" ? raw.caption : p.caption,
            hashtags: Array.isArray(raw?.hashtags) ? raw.hashtags.map((h: any) => String(h).replace(/^#/, "")) : p.hashtags,
            spec,
          };
        } catch (e: any) {
          console.warn("[change] LLM revision failed, using rules:", e?.message ?? e);
        }
      }
      if (!patch) patch = (await heuristicChange(p, text)).post;
      updatePost(postId, (x) => {
        Object.assign(x, patch);
        // drop a previous auto-voiceover so narration is regenerated for the new text
        if (isReelSpec(x.spec) && x.spec.voiceover?.src?.includes(`/renders/${x.id}/`)) {
          delete x.spec.voiceover;
          delete x.spec.captions;
        }
        if (isHtmlSpec(x.spec) && x.spec.voiceover?.src?.includes(`/renders/${x.id}/`)) delete x.spec.voiceover;
        x.revision += 1;
      });
      enqueueRender(postId);
    } catch (e: any) {
      updatePost(postId, (x) => {
        x.status = "failed";
        x.error = `Change failed: ${e?.message ?? e}`;
      });
    }
  })();
  return p;
}
