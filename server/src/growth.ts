// Instagram growth features: hook A/B variants, alt text, branded reel covers, trial reels / collaborators /
// audio name options, and a publish preview of the container params. Routes: registerGrowthRoutes(app).
import path from "node:path";
import fs from "node:fs";
import type { Express, Request } from "express";
import type { Brand, BrandBrain, HookScores, HookVariant, Post, ReelSpec, TrialReelOptions } from "../../shared/types.ts";
import { RENDERS_DIR, fileUrlFor, localPathForUrl, publicUrlFor } from "./config.ts";
import { getBrand, getPost, getSettings, listPosts, updatePost } from "./db.ts";
import { askJson, llmAvailable } from "./llm.ts";
import { loadRenderer, tryLoad } from "./engines.ts";
import { fullCaption, isCarouselSpec, isReelSpec } from "./posts.ts";
import { ensureBrain } from "./brain.ts";
import { requestChange } from "./change.ts";
import { queueState } from "./render.ts";
import { countHashtags, MAX_HASHTAGS, mainKeyword, shortTopic, smartLower } from "./hashtags.ts";
import { heuristicAltText } from "./alttext.ts";
import {
  carouselItemExtras, carouselParentExtras, cleanAudioName, cleanCollaborators, disabledFromEnv, reelContainerExtras, shareToFeed,
  singleImageExtras, imageContainerBody, MAX_ALT_TEXT, type IgParamOptions,
} from "./igparams.ts";

const httpErr = (status: number, msg: string) => Object.assign(new Error(msg), { status });
function postOr404(id: string): Post {
  const p = getPost(id);
  if (!p) throw httpErr(404, "Post not found");
  return p;
}
const brainOf = (p: Post): { brand: Brand; brain: BrandBrain } => {
  const brand = getBrand(p.brandId);
  if (!brand) throw httpErr(404, "Brand not found");
  return { brand, brain: ensureBrain(brand) };
};

// ================= Hook A/B =================
const CURIOSITY = /\b(nobody|secret|stop|mistake|mistakes|why|never|truth|actually|wrong|before you|this is why|didn't know|hidden|lied|myth|wish i)\b|\?|…|\.\.\./i;
const VAGUE = /\b(things|stuff|something|amazing|awesome|great|best ever)\b/i;

export function scoreHookHeuristic(text: string, keyword = ""): { score: number; scores: HookScores; why: string } {
  const t = text.trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  const kw = keyword.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const kwHit = kw.length ? kw.filter((w) => t.toLowerCase().includes(w)).length / kw.length : 0;
  let curiosity = 4 + (CURIOSITY.test(t) ? 3 : 0) + (/^(pov|you|your|if you)\b/i.test(t) ? 1 : 0) + (/\b(you|your)\b/i.test(t) ? 1 : 0);
  let specificity = 3 + (/\d/.test(t) ? 2 : 0) + Math.round(kwHit * 3) + (VAGUE.test(t) ? -2 : 0) + (words >= 5 ? 1 : 0);
  let clarity = words <= 7 ? 9 : words <= 10 ? 7 : words <= 14 ? 5 : 3;
  if (t.length > 60) clarity -= 2;
  const c = (n: number) => Math.max(1, Math.min(10, Math.round(n)));
  curiosity = c(curiosity);
  specificity = c(specificity);
  clarity = c(clarity);
  const score = Math.round(((curiosity + specificity + clarity) / 3) * 10) / 10;
  const why = [
    curiosity >= 7 ? "opens a curiosity gap" : "low curiosity",
    specificity >= 7 ? "specific (number/keyword)" : "could be more specific",
    clarity >= 7 ? "readable in 3s" : "too long for the first 3s",
  ].join(", ");
  return { score, scores: { curiosity, specificity, clarity }, why };
}

const HOOK_TEMPLATES: ((t: string, brand: string) => string)[] = [
  (t) => `Nobody tells you this about ${t}`,
  (t) => `3 ${t} mistakes costing you money`,
  (t) => `Still struggling with ${t}? Watch this`,
  (t) => `POV: you finally got ${t} right`,
  (t) => `Stop scrolling if you want ${t}`,
  (t) => `The ${t} trick I wish I knew sooner`,
  (t, b) => `Why everyone's switching to ${b} for ${t}`,
  (t) => `Before you try ${t}, watch this`,
];

function hashStr(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function postTopic(p: Post, brain: BrandBrain): string {
  const fromTitle = shortTopic(p.title.replace(/^(\d+\s+)?(quick tips|mistakes with|behind the scenes|myth vs fact|why|is)\b[:\s]*/i, ""), 4);
  return smartLower(fromTitle && fromTitle.split(" ").length <= 4 ? fromTitle : mainKeyword(brain, brain.products?.[0] ?? ""));
}

export function heuristicHooks(p: Post, brand: Brand, brain: BrandBrain, n = 3): HookVariant[] {
  const topic = postTopic(p, brain);
  const start = hashStr(p.id + (p.hookVariants?.length ?? 0) + p.revision);
  const out: HookVariant[] = [];
  for (let k = 0; out.length < n && k < HOOK_TEMPLATES.length; k++) {
    const text = HOOK_TEMPLATES[(start + k * 3) % HOOK_TEMPLATES.length](topic, brand.name).replace(/\s+/g, " ").trim();
    if (text.toLowerCase() === p.hook.toLowerCase() || out.some((o) => o.text === text)) continue;
    out.push({ text, ...scoreHookHeuristic(text, topic), source: "heuristic" });
  }
  return out.sort((a, b) => b.score - a.score);
}

const HOOK_SYSTEM = `You write and score Instagram reel hooks (the on-screen + spoken first line, first 3 seconds).
Input: {brand, post: {type, title, hook, caption, scenes}, count}.
Write "count" NEW hook variants (each <= 10 words, different angles: curiosity gap, specific number/result, direct callout).
Include the main search keyword of the post naturally. Respect claimsToAvoid; no fake numbers or promises.
Score each 1-10 on: curiosity (makes you need the next second), specificity (concrete, keyword, number),
clarity (instantly readable in the first 3 seconds). Be a strict judge.
Return {"variants":[{"text":string,"scores":{"curiosity":n,"specificity":n,"clarity":n},"why":string (<= 15 words)}]}`;

export async function generateHooks(postId: string, count = 3): Promise<{ variants: HookVariant[]; post: Post }> {
  const p = postOr404(postId);
  const { brand, brain } = brainOf(p);
  const n = Math.max(2, Math.min(5, Math.round(count) || 3));
  let variants: HookVariant[] = [];
  if (llmAvailable()) {
    try {
      const scenes = isReelSpec(p.spec) ? p.spec.scenes.map((s) => s.headline) : isCarouselSpec(p.spec) ? p.spec.slides.map((s) => s.headline) : [];
      const raw = await askJson<any>(
        HOOK_SYSTEM,
        JSON.stringify({
          brand: { name: brand.name, niche: brain.niche, audience: brain.audience, voice: brain.voice, keywords: brain.keywords, claimsToAvoid: brain.claimsToAvoid },
          post: { type: p.type, title: p.title, hook: p.hook, caption: p.caption, scenes },
          count: n,
        }),
        2000,
      );
      const c = (x: any) => Math.max(1, Math.min(10, Math.round(Number(x) || 5)));
      variants = (Array.isArray(raw?.variants) ? raw.variants : [])
        .filter((v: any) => typeof v?.text === "string" && v.text.trim())
        .slice(0, n)
        .map((v: any) => {
          const scores = { curiosity: c(v.scores?.curiosity), specificity: c(v.scores?.specificity), clarity: c(v.scores?.clarity) };
          return {
            text: v.text.trim().slice(0, 120),
            scores,
            score: Math.round(((scores.curiosity + scores.specificity + scores.clarity) / 3) * 10) / 10,
            why: typeof v.why === "string" ? v.why.slice(0, 160) : undefined,
            source: "llm" as const,
          };
        });
    } catch (e: any) {
      console.warn("[growth] LLM hooks failed, using templates:", e?.message ?? e);
    }
  }
  if (variants.length < n) variants.push(...heuristicHooks(p, brand, brain, n - variants.length));
  variants.sort((a, b) => b.score - a.score);
  const post = updatePost(p.id, (x) => {
    x.hookVariants = variants;
  })!;
  return { variants, post };
}

/** Apply a hook through the normal change-request path (revises spec, regenerates voiceover, re-renders). */
export async function applyHook(postId: string, input: { text?: string; index?: number }): Promise<Post> {
  const p = postOr404(postId);
  if (["posted", "publishing"].includes(p.status)) throw httpErr(409, `Post is already ${p.status}`);
  const text = (typeof input.text === "string" && input.text.trim()) || (Number.isInteger(input.index) ? p.hookVariants?.[input.index!]?.text : undefined);
  if (!text) throw httpErr(400, "text or a valid index (from POST /hooks) is required");
  const clean = text.replace(/["“”]/g, "'").trim().slice(0, 120);
  return requestChange(p.id, `Change the hook to "${clean}"`);
}

// ================= Alt text =================
const ALT_SYSTEM = `You write Instagram image alt text (accessibility + search). One entry per image, in order.
Each: 1-2 plain sentences, <= 300 characters, describe what is visible (graphic style, product/photo, the on-image text
quoted briefly), include the post's main keyword naturally, no hashtags, no "image of".
Input: {brand, keyword, slides:[{headline, body, hasPhoto}]}. Return {"altText": string[]}`;

export async function generateAltText(postId: string): Promise<Post> {
  const p = postOr404(postId);
  if (p.type !== "carousel" && p.type !== "image") throw httpErr(400, "Alt text is only supported for image/carousel posts (Instagram ignores it on reels and stories)");
  const { brand, brain } = brainOf(p);
  let alt = heuristicAltText(p, brand.name);
  if (llmAvailable() && isCarouselSpec(p.spec)) {
    try {
      const raw = await askJson<any>(
        ALT_SYSTEM,
        JSON.stringify({
          brand: { name: brand.name, niche: brain.niche },
          keyword: mainKeyword(brain, p.title),
          slides: p.spec.slides.map((s) => ({ headline: s.headline, body: s.body, hasPhoto: s.media?.kind === "image" })),
        }),
        2000,
      );
      if (Array.isArray(raw?.altText)) alt = alt.map((h, i) => (typeof raw.altText[i] === "string" && raw.altText[i].trim() ? raw.altText[i].trim().slice(0, MAX_ALT_TEXT) : h));
    } catch (e: any) {
      console.warn("[growth] LLM alt text failed, using heuristic:", e?.message ?? e);
    }
  }
  return updatePost(p.id, (x) => {
    x.altText = alt;
  })!;
}

// ================= Reel covers =================
/** Cover spec: the hook as a single title-card scene (no audio, captions or end card). */
export function coverSpec(p: Post, brandName?: string): ReelSpec | undefined {
  if (!isReelSpec(p.spec)) return undefined;
  const s = p.spec;
  const first = s.scenes[0];
  const hook = (p.hook || first?.headline || p.title).trim();
  return {
    width: s.width || 1080,
    height: s.height || 1920,
    fps: s.fps || 30,
    style: s.style,
    brand: s.brand,
    scenes: [
      {
        id: "cover",
        durationSec: 3,
        headline: hook,
        subtext: brandName ?? s.brand?.name, // most styles already show the @handle in the header
        ...(first?.media ? { media: first.media } : {}),
      },
    ],
  };
}

let coverBusy = false;
export async function renderCover(postId: string): Promise<Post> {
  const p = postOr404(postId);
  if (p.type !== "reel") throw httpErr(400, "Covers are for reels only");
  const spec = coverSpec(p, getBrand(p.brandId)?.name);
  if (!spec) throw httpErr(400, "Branded covers need a Remotion reel spec (HyperFrames reels use thumb_offset instead)");
  const r = await tryLoad(loadRenderer);
  if (!r?.renderStill) throw httpErr(503, "Renderer with renderStill is not available");
  if (coverBusy) throw httpErr(409, "Another cover is rendering — try again in a few seconds");
  coverBusy = true;
  try {
    const out = path.join(RENDERS_DIR, p.id, `r${p.revision}`, "cover.jpg");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const file = await r.renderStill(spec, Math.round(spec.fps * 1.6), out); // 1.6s: entrance animations have settled
    const url = fileUrlFor(file) + `?v=${Date.now().toString(36)}`;
    return updatePost(p.id, (x) => {
      x.coverUrl = url;
      x.coverRevision = p.revision;
    })!;
  } finally {
    coverBusy = false;
  }
}

/** Minimal post-render hook without touching render.ts: when the render queue is idle, render a cover for one
 *  finished Remotion reel whose cover is missing/stale. Disable with AUTO_COVER=0. */
const coverFailed = new Set<string>();
export function startCoverWatcher(intervalMs = 45_000) {
  if (/^(0|false|off|no)$/i.test(process.env.AUTO_COVER ?? "")) return;
  const tick = async () => {
    if (coverBusy) return;
    const q = queueState();
    if (q.running || q.queued.length) return;
    const due = listPosts({ type: "reel" }).find(
      (p) =>
        ["ready", "approved"].includes(p.status) &&
        p.mediaUrls?.length &&
        isReelSpec(p.spec) &&
        p.coverRevision !== p.revision &&
        !coverFailed.has(`${p.id}:${p.revision}`),
    );
    if (!due) return;
    try {
      await renderCover(due.id);
    } catch (e: any) {
      coverFailed.add(`${due.id}:${due.revision}`);
      console.warn(`[growth] auto cover failed for ${due.id}: ${e?.message ?? e}`);
    }
  };
  setInterval(() => void tick().catch(() => undefined), intervalMs).unref?.();
}

// ================= Options + preview =================
export function updateGrowth(postId: string, body: any): Post {
  const p = postOr404(postId);
  if (["posted", "publishing"].includes(p.status)) throw httpErr(409, `Post is already ${p.status}`);
  const b = body ?? {};
  if (b.trial !== undefined && b.trial !== null && p.type !== "reel") throw httpErr(400, "Trial reels are only available for reels");
  if (b.collaborators !== undefined && b.collaborators !== null) {
    if (!Array.isArray(b.collaborators)) throw httpErr(400, "collaborators must be an array of usernames");
    if (p.type === "story" && b.collaborators.length) throw httpErr(400, "Instagram does not support collaborators on stories");
    if (b.collaborators.filter((u: any) => String(u ?? "").trim()).length > 3) throw httpErr(400, "Instagram allows at most 3 collaborators");
  }
  return updatePost(p.id, (x: Post) => {
    if (b.trial === null) delete x.trial;
    else if (b.trial !== undefined) {
      const t: TrialReelOptions = { enabled: !!b.trial.enabled, graduation: b.trial.graduation === "SS_PERFORMANCE" ? "SS_PERFORMANCE" : "MANUAL" };
      x.trial = t;
    }
    if (b.collaborators === null) delete x.collaborators;
    else if (b.collaborators !== undefined) x.collaborators = cleanCollaborators(b.collaborators);
    if (b.audioName === null) delete x.audioName;
    else if (b.audioName !== undefined) x.audioName = cleanAudioName(b.audioName) ?? "";
    if (b.altText === null) delete x.altText;
    else if (Array.isArray(b.altText)) x.altText = b.altText.map((a: any) => String(a ?? "").slice(0, MAX_ALT_TEXT));
    if (b.coverThumbOffsetMs === null) delete x.coverThumbOffsetMs;
    else if (b.coverThumbOffsetMs !== undefined) x.coverThumbOffsetMs = Math.max(0, Math.round(Number(b.coverThumbOffsetMs) || 0));
    if (b.coverUrl === null) {
      delete x.coverUrl;
      delete x.coverRevision;
    }
  })!;
}

/** The container bodies publishPost would send (access token omitted), for the UI and tests. */
export function publishPreview(p: Post) {
  const s = getSettings();
  const brandName = getBrand(p.brandId)?.name;
  const opts: IgParamOptions = { publicBaseUrl: s.publicBaseUrl, brandName, disabled: disabledFromEnv() };
  const caption = fullCaption(p);
  const pa = { ...p, altText: p.altText?.some((a) => a?.trim()) ? p.altText : heuristicAltText(p, brandName) };
  const pub = (u: string) => (s.publicBaseUrl ? publicUrlFor(u, s.publicBaseUrl) : u);
  const containers: Record<string, unknown>[] = [];
  const notes: string[] = [];
  if (p.type === "image") {
    if (!s.publicBaseUrl) notes.push("Image posts need publicBaseUrl so Instagram can fetch the image.");
    containers.push(imageContainerBody(pa, p.mediaUrls[0] ? pub(p.mediaUrls[0]) : "<render first>", caption, opts));
  } else if (p.type === "carousel") {
    if (!s.publicBaseUrl) notes.push("Carousels need publicBaseUrl so Instagram can fetch the images.");
    const urls = p.mediaUrls.slice(0, 10);
    if (urls.length <= 1) containers.push({ image_url: pub(urls[0] ?? "<render first>"), caption, ...singleImageExtras(pa, opts) });
    else {
      urls.forEach((u, i) => containers.push({ image_url: pub(u), is_carousel_item: true, ...carouselItemExtras(pa, i, opts) }));
      containers.push({ media_type: "CAROUSEL", children: "<child ids>", caption, ...carouselParentExtras(pa, opts) });
    }
  } else {
    const local = p.mediaUrls[0] ? localPathForUrl(p.mediaUrls[0]) : undefined;
    const resumable = !!(local && fs.existsSync(local));
    const base: Record<string, unknown> = {
      media_type: p.type === "story" ? "STORIES" : "REELS",
      ...(resumable ? { upload_type: "resumable" } : { video_url: p.mediaUrls[0] ? pub(p.mediaUrls[0]) : "<render first>" }),
    };
    if (p.type === "reel") {
      Object.assign(base, { caption, ...(shareToFeed(p, opts) ? { share_to_feed: true } : {}), ...reelContainerExtras(p, opts) });
      if (p.coverUrl && !s.publicBaseUrl) notes.push("Cover rendered, but cover_url needs publicBaseUrl — sending thumb_offset instead.");
    }
    containers.push(base);
  }
  const hashtagsInCaption = countHashtags(caption);
  return { containers, caption, hashtagsInCaption, maxHashtags: MAX_HASHTAGS, disabledParams: [...disabledFromEnv()], notes };
}

// ================= routes =================
export function registerGrowthRoutes(app: Express) {
  const id = (req: Request) => String(req.params.id);
  app.get("/api/posts/:id/growth", (req, res) => {
    const p = postOr404(id(req));
    res.json({
      trial: p.trial ?? null,
      collaborators: p.collaborators ?? [],
      audioName: p.audioName ?? null,
      altText: p.altText ?? [],
      coverUrl: p.coverUrl ?? null,
      coverStale: !!p.coverUrl && p.coverRevision !== p.revision,
      hookVariants: p.hookVariants ?? [],
      preview: publishPreview(p),
    });
  });
  app.patch("/api/posts/:id/growth", (req, res) => res.json(updateGrowth(id(req), req.body)));
  app.post("/api/posts/:id/hooks", async (req, res) => res.json(await generateHooks(id(req), Number(req.body?.count) || 3)));
  app.post("/api/posts/:id/hooks/apply", async (req, res) => res.json(await applyHook(id(req), { text: req.body?.text, index: req.body?.index })));
  app.post("/api/posts/:id/alt-text", async (req, res) => res.json(await generateAltText(id(req))));
  app.post("/api/posts/:id/cover", async (req, res) => res.json(await renderCover(id(req))));
  startCoverWatcher();
}
