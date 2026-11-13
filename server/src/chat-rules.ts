// Rule-based chat router used when no Anthropic key is configured (or the API call fails).
// Covers the common requests: plan N posts, edit a post (style/hook/length/music/voice/scene text),
// approve/schedule/publish with confirmation, list posts, calendar, status.
import { nanoid } from "nanoid";
import type { Brand, ChatAction, ChatSession, Post, ReelSpec } from "../../shared/types.ts";
import * as db from "./db.ts";
import { getStyles } from "./engines.ts";
import { isCarouselSpec, isHtmlSpec, isReelSpec } from "./posts.ts";
import { enqueueRender } from "./render.ts";
import type { ChatTool, ToolResult } from "./chat-agent.ts";
import { etsyRule } from "./etsy-chat.ts";
import { clipsRule } from "./clips-chat.ts";
import {
  applyPostEdits,
  buildTools,
  fmtWhen,
  listMusic,
  listVoices,
  matchTrack,
  musicVolumeOf,
  parseWhen,
  perPostVoiceSupported,
  plural,
  postDetail,
  postLink,
  setPostMusic,
  totalDuration,
  trackName,
  type PostEdits,
} from "./chat-tools.ts";
import { autopostGlobalRule, imagePostRule } from "./chat-autopost.ts";

export interface RuleReply {
  text: string;
  actions: ChatAction[];
  revision?: number;
  lastPostIds?: string[];
  brandId?: string;
}

export const KEY_NOTE =
  "Tip: add an Anthropic API key in Settings (or drive the app from Claude Desktop via MCP) to unlock full natural-language chat — rewrites, translations and free-form requests.";

let toolCache: Map<string, ChatTool> | undefined;
function tool(name: string): ChatTool {
  toolCache ??= new Map(buildTools().map((t) => [t.name, t]));
  const t = toolCache.get(name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

export function actionFrom(toolName: string, r: ToolResult): ChatAction {
  return {
    id: nanoid(10),
    tool: toolName,
    label: r.label,
    status: r.ok ? "done" : "failed",
    detail: r.text.slice(0, 1500),
    links: r.links,
    postIds: r.postIds,
    brandId: r.brandId,
    revision: r.revision,
  };
}

async function runTool(name: string, input: Record<string, unknown>): Promise<{ r: ToolResult; action: ChatAction }> {
  let r: ToolResult;
  try {
    r = await tool(name).run(input, { sessionId: "" });
  } catch (e: any) {
    r = { ok: false, label: `${name.replace(/_/g, " ")} failed`, text: e?.message ?? String(e) };
  }
  return { r, action: actionFrom(name, r) };
}

export function pendingAction(name: string, input: Record<string, unknown>): ChatAction {
  const t = tool(name);
  const postIds = typeof input.postId === "string" ? [input.postId] : Array.isArray(input.postIds) ? (input.postIds as string[]) : undefined;
  return {
    id: nanoid(10),
    tool: name,
    label: t.describe?.(input) ?? name,
    status: "pending_confirmation",
    input,
    postIds,
    links: postIds?.slice(0, 5).map((id) => {
      const p = db.getPost(id);
      return p ? postLink(p) : { label: id, postId: id };
    }),
  };
}

// ---------- text helpers ----------
const unquote = (s: string) => s.trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim();
function after(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  const v = m?.[m.length - 1];
  return v ? unquote(v.replace(/[.!]+$/, "")) || undefined : undefined;
}
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };
const toNum = (s: string) => (/^\d+$/.test(s) ? +s : (NUM[s.toLowerCase()] ?? NaN));
const FILLER = new Set(["just", "really", "very", "actually", "basically", "simply", "that", "so", "literally", "totally", "quite"]);

/** Heuristic "punchier" hook: drop filler, cap at 7 words, end with punch. */
export function punchier(hook: string): string {
  const words = (x: string) => x.replace(/[.…]+$/, "").split(/\s+/).filter((y) => y && !FILLER.has(y.toLowerCase()));
  let w = words(hook);
  if (w.length > 8) {
    // long hook: keep its strongest clause (prefer one with a number) instead of cutting mid-phrase
    const parts = hook.split(/\s*[:—–|]\s*|\s+-\s+/).map(words).filter((p) => p.length >= 3);
    const pick = parts.find((p) => p.length <= 9 && p.some((x) => /\d/.test(x))) ?? parts.find((p) => p.length <= 9);
    w = pick ?? w.slice(0, 8);
  }
  let s = w.join(" ").replace(/[,;:]$/, "");
  if (!s) return hook;
  s = s[0].toUpperCase() + s.slice(1);
  const q = /^(how|why|what|who|when|where|do|does|did|are|is|can|should|would|will)\b/i.test(s);
  if (!/[?!]$/.test(s)) s += q ? "?" : "!";
  if (s.replace(/[?!]$/, "").toLowerCase() === hook.replace(/[.?!…]+$/, "").toLowerCase()) s = q ? `Wait — ${s[0].toLowerCase()}${s.slice(1)}` : `Stop scrolling: ${s}`;
  return s;
}

const LANGS = "urdu|arabic|hindi|french|spanish|german|turkish|italian|portuguese|english|indonesian|malay|bengali|persian|farsi|punjabi|chinese|japanese|korean|russian";

// ---------- post chat ----------
export async function rulesPostTurn(post: Post, text: string): Promise<RuleReply> {
  const t = text.trim();
  const lower = t.toLowerCase();
  const actions: ChatAction[] = [];

  // Sensitive actions → confirmation card
  if (/\b(publish|post (it|this)? ?now|go live)\b/.test(lower) && !/\bdon'?t\b/.test(lower)) {
    if (!post.mediaUrls.length) return { text: "This post hasn't been rendered yet, so it can't be published. Want me to render it first? Say “re-render”.", actions };
    return { text: `Ready to publish “${post.title}” to Instagram right now. This is public and can't be undone — press Confirm to go ahead.`, actions: [pendingAction("publish_now", { postId: post.id })] };
  }
  if (/\bapprove\b/.test(lower) && !/\bdon'?t\b/.test(lower)) {
    const when = after(t, /\b(?:for|at|on)\s+(.+)$/i);
    const scheduledAt = when ? parseWhen(when) : undefined;
    return {
      text: `I'll approve “${post.title}” so it posts ${scheduledAt ? fmtWhen(scheduledAt) : post.scheduledAt ? fmtWhen(post.scheduledAt) : "at the next best time"}. Press Confirm to approve.`,
      actions: [pendingAction("approve_post", { postId: post.id, ...(scheduledAt ? { scheduledAt } : {}) })],
    };
  }
  if (/\bdelete (this|the|it)?\s*(post|reel|carousel|story)?\b/.test(lower) && !/hashtag|scene|slide/.test(lower)) {
    return { text: `Delete “${post.title}”? This can't be undone — press Confirm to delete it.`, actions: [pendingAction("delete_post", { postId: post.id })] };
  }
  // image posts: headline / body / cta / design / style / color edits (chat-autopost.ts)
  const img = await imagePostRule(post, t);
  if (img) return { text: img.text, revision: img.revision, actions: [actionFrom("update_image_post", { ok: true, label: `Revision ${img.revision}: ${img.changes.join(", ")}`, text: img.changes.join("; "), postIds: [post.id], revision: img.revision })] };

  const wantsTranslate = new RegExp(`\\btranslat\\w*|\\b(in|into|to) (${LANGS})\\b`).test(lower);

  // Parse edits
  const edits: PostEdits = {};
  const notes: string[] = [];
  const { styles, captionStyles } = await getStyles();

  const scene = t.match(/\b(scene|slide)\s*#?\s*(\d+)(?:'s)?\s*(?:text|headline|title|line|copy)?\s*(?:to|:|=|->|→|should say|should be|says?)\s*(.+)$/i);
  if (scene) edits.scenes = [{ index: +scene[2], headline: unquote(scene[3].replace(/[.!]+$/, "")) }];

  const hookTo = after(t, /\bhook\s*(?:text\s*)?(?:to|:|=|->|→|should be|should say)\s*(.+)$/i);
  if (hookTo) edits.hook = hookTo;
  else if (/\bhook\b/.test(lower) && /\b(punch\w*|strong\w*|better|catch\w*|engag\w*|snap\w*|bold\w*|shorter|grab\w*|hook\w* harder)\b/.test(lower)) edits.hook = punchier(post.hook || (isReelSpec(post.spec) ? post.spec.scenes[0]?.headline : "") || post.title);

  const titleTo = after(t, /\btitle\s*(?:to|:|=|->|→)\s*(.+)$/i);
  if (titleTo && !scene) edits.title = titleTo;

  const capStyle = captionStyles.find((c) => lower.includes(c.id.toLowerCase()) || (lower.includes(c.name.toLowerCase()) && /caption|subtitle/.test(lower)));
  if (capStyle && /caption|subtitle/.test(lower)) edits.captionStyle = capStyle.id;
  else if (/\b(no|remove|without|turn off|hide|disable)\s+(the\s+)?(burned[- ]in\s+|on[- ]screen\s+)?(captions|subtitles)\b/.test(lower)) edits.captionStyle = null;
  else if (/\b(add|turn on|show|enable)\s+(the\s+)?(captions|subtitles)\b/.test(lower)) edits.captionStyle = captionStyles.find((c) => c.id === "white-pill")?.id ?? captionStyles[0]?.id;

  if (!wantsTranslate && edits.captionStyle === undefined) {
    const cap = after(t, /\b(?:instagram\s+)?caption\s*(?:text\s*)?(?:to|:|=|->|→|should be|should say)\s*(.+)$/i);
    if (cap) edits.caption = cap;
  }
  const addTags = after(t, /\badd\s+(?:the\s+)?(?:hashtags?|tags?)\s*:?\s*(.+)$/i) ?? (/\badd\b/.test(lower) && /#\w/.test(t) ? t.match(/#[\p{L}\p{N}_]+/gu)?.join(" ") : undefined);
  if (addTags) edits.addHashtags = addTags.split(/[\s,]+/).map((x) => x.replace(/^#/, "")).filter((x) => x && !["and", "the"].includes(x.toLowerCase()));
  const rmTags = after(t, /\b(?:remove|delete|drop)\s+(?:the\s+)?(?:hashtags?|tags?)\s*:?\s*(.+)$/i);
  if (rmTags) edits.removeHashtags = rmTags.split(/[\s,]+/).map((x) => x.replace(/^#/, "")).filter(Boolean);

  const cta = after(t, /\b(?:cta|call to action|end card|end screen)\s*(?:text\s*)?(?:to|:|=|->|→|should be|should say)\s*(.+)$/i);
  if (cta) edits.cta = { text: cta };

  // length
  const secs = lower.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/);
  if (secs && /\b(shorten|shorter|trim|cut|make|length|long|under|to|max|keep|only)\b/.test(lower) && !/scene\s*\d+\s*(?:to|:)/i.test(t)) edits.targetDurationSec = +secs[1];
  else if (isReelSpec(post.spec) || isHtmlSpec(post.spec)) {
    const total = totalDuration(post.spec);
    if (/\b(shorter|faster|quicker|too long|tighten|snappier pace)\b/.test(lower) && !/\bhook\b/.test(lower)) edits.targetDurationSec = Math.round(total * 0.75);
    else if (/\b(longer|slower|too fast|too short)\b/.test(lower) && !/voice/.test(lower)) edits.targetDurationSec = Math.round(total * 1.3);
  }

  // style
  if (isHtmlSpec(post.spec) && /\b(style|look)\b/.test(lower) && styles.some((st) => lower.includes(st.id.toLowerCase()) || lower.includes(st.name.toLowerCase()))) {
    notes.push("This reel is a custom HTML (HyperFrames) composition, so the visual styles don't apply to it. Describe the look you want as a change request (needs the AI writer), or plan a new reel.");
  }
  if (!isHtmlSpec(post.spec)) {
    let best: { id: string; name: string; len: number } | undefined;
    for (const s of styles) {
      for (const cand of [s.id.toLowerCase(), s.name.toLowerCase(), s.id.toLowerCase().replace(/-/g, " ")]) {
        const re = new RegExp(`\\b${cand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b(?!\\s*(music|song|track|beat|voice|vibe music))`);
        if (re.test(lower) && (!best || cand.length > best.len)) best = { id: s.id, name: s.name, len: cand.length };
      }
    }
    // don't treat caption-style words or music moods as visual styles
    if (best && capStyle && lower.includes(capStyle.name.toLowerCase()) && capStyle.name.toLowerCase().includes(best.name.toLowerCase())) best = undefined;
    if (best && best.id === (post.spec as ReelSpec).style) notes.push(`It is already in the ${best.name} style.`);
    else if (best) edits.style = best.id;
    else if (/\b(different|another|new|other|fresh)\s+(style|look|vibe)\b|\bchange\s+the\s+(style|look)\b/.test(lower)) {
      const kind = isCarouselSpec(post.spec) ? "carousel" : post.type;
      const pool = styles.filter((s) => !s.supports?.length || s.supports.includes(kind as any));
      const cur = (post.spec as ReelSpec).style;
      const i = pool.findIndex((s) => s.id === cur);
      const next = pool[(i + 1) % Math.max(1, pool.length)];
      if (next && next.id !== cur) edits.style = next.id;
    }
  }

  // voice
  if (/\bvoice|voiceover|voice-over|narrat|narrator|speaker\b/.test(lower) && !isCarouselSpec(post.spec)) {
    const voices = await listVoices();
    const gender = /\b(male|man|man's|guy|masculine|deep)\b/.test(lower) && !/\bfemale\b/.test(lower) ? "male" : /\b(female|woman|girl|feminine|lady)\b/.test(lower) ? "female" : undefined;
    const accent = /\b(british|uk|english accent)\b/.test(lower) ? "british" : /\b(american|us accent)\b/.test(lower) ? "american" : undefined;
    const named = voices.find((v) => new RegExp(`\\b(${v.id.toLowerCase()}|${v.name.toLowerCase()})\\b`).test(lower));
    const curVoice = String((post.spec as any).voice ?? db.getSettings().voice);
    let pick = named;
    if (!pick && (gender || accent)) {
      const pool = voices.filter((v) => (!gender || v.gender.toLowerCase() === gender) && (!accent || v.accent.toLowerCase().includes(accent)));
      pick = pool.find((v) => v.id !== curVoice) ?? pool[0];
    }
    if (pick) {
      edits.voice = pick.id;
      if (perPostVoiceSupported()) notes.push(`Voice: ${pick.name} (${pick.gender}, ${pick.accent}).`);
    } else if (/\b(regenerate|redo|re-?do|refresh|new|re-?record)\b/.test(lower)) edits.regenerateVoiceover = true;
  }

  // music
  let music: { query: string } | { remove: true } | { volume: number } | undefined;
  const volPct = lower.match(/\b(?:music|volume)\b[^0-9]{0,20}(\d{1,3})\s*%/)?.[1];
  const volWords = /\b(louder|quieter|softer|lower|higher|turn (it )?(up|down)|volume|too loud|too quiet|can'?t hear)\b/;
  if (/\b(music|song|soundtrack|beat|track|volume)\b/.test(lower) && (volPct || volWords.test(lower)) && !/\bvoice\b/.test(lower)) {
    const cur = musicVolumeOf(post);
    const up = /\b(louder|higher|up|too quiet|can'?t hear)\b/.test(lower);
    const v = volPct ? +volPct / 100 : up ? Math.max(cur * 1.5, cur + 0.1) : Math.min(cur * 0.6, cur - 0.08);
    music = { volume: Math.max(0.05, Math.min(1, Math.round(v * 100) / 100)) };
  } else if (/\b(music|song|soundtrack|beat|track)\b/.test(lower)) {
    if (/\b(no|remove|without|mute|drop|stop|turn off)\b[^.]*\b(music|song|soundtrack|track)\b/.test(lower)) music = { remove: true };
    else music = { query: lower.replace(/.*?\b(use|add|put|play|with|switch to|change to|try|make it)\b/, "") };
  }

  const wantsRender = /\b(re-?render|render (it |this )?(again|now)|render it|regenerate (the )?video)\b/.test(lower);
  const when = /\b(schedule|reschedule|move it|post it)\b/.test(lower) ? after(t, /\b(?:for|at|on|to)\s+(.+)$/i) : undefined;
  if (when) {
    const iso = parseWhen(when);
    if (iso && post.status === "approved") {
      return { text: `“${post.title}” is approved. Move it to ${fmtWhen(iso)}? Press Confirm.`, actions: [pendingAction("approve_post", { postId: post.id, scheduledAt: iso })] };
    }
    if (iso) edits.scheduledAt = iso;
    else notes.push(`I couldn't read the time “${when}” — try “tomorrow 6pm” or “Fri 10:30”.`);
  }

  const hasEdits = Object.keys(edits).length > 0;
  const isQuestion =
    !hasEdits && !music && !wantsRender && (/\?\s*$/.test(t) || /^(what|which|how|why|who|when|does|is|are|can you (tell|describe|summari)|describe|summari[sz]e|tell me|explain|show me)\b/.test(lower));

  if (isQuestion) {
    return { text: describePost(post, lower), actions };
  }
  if (wantsTranslate && !hasEdits && !music) {
    return {
      text: `Translating needs the AI writer, which isn't switched on — there's no Anthropic API key in Settings. Add a key and ask again, or paste the translated lines and I'll put them in (e.g. “change scene 2 text to …”).\n\n${KEY_NOTE}`,
      actions,
    };
  }

  let revision: number | undefined;
  let rerenderedByEdits = false;
  const changes: string[] = [];
  const warnings: string[] = [...notes];
  if (hasEdits) {
    try {
      const r = await applyPostEdits(post.id, { ...edits, rerender: music ? false : undefined }, text);
      changes.push(...r.changes);
      warnings.push(...r.warnings);
      if (r.changes.length) {
        const specChanged = r.post.revision !== post.revision;
        if (specChanged) revision = r.post.revision;
        rerenderedByEdits = r.rerendered;
        actions.push(
          actionFrom("update_post", {
            ok: true,
            label: specChanged ? `Revision ${r.post.revision}: ${r.changes.join(", ")}` : `Saved: ${r.changes.join(", ")}`,
            text: r.changes.join("; "),
            postIds: [post.id],
            revision,
          }),
        );
      }
    } catch (e: any) {
      return { text: `I couldn't apply that: ${e.message}`, actions };
    }
  }
  if (music) {
    try {
      let trackId: string | null | undefined = null;
      let label = "Music removed";
      let doIt = "remove" in music;
      if ("volume" in music) {
        trackId = undefined;
        label = `Music volume → ${Math.round(music.volume * 100)}%`;
        if ((db.getPost(post.id)!.spec as any).music) doIt = true;
        else warnings.push("This post has no music yet — pick a track first (e.g. “use calm music”).");
      } else if ("query" in music) {
        const tracks = await listMusic(post.brandId);
        const tr = matchTrack(tracks, music.query);
        if (!tr) {
          warnings.push(tracks.length ? `I couldn't find a track matching that. Available: ${tracks.slice(0, 8).map((x) => trackName(x)).join(", ")}.` : "The music library is empty.");
        } else {
          trackId = tr.id;
          label = `Music → ${trackName(tr)}`;
          doIt = true;
        }
      }
      if (doIt) {
        const before = db.getPost(post.id)!;
        const p = await setPostMusic(post.id, trackId, { render: !(hasEdits && before.revision !== post.revision), volume: "volume" in music ? music.volume : undefined });
        if (p.revision !== before.revision) revision = p.revision;
        changes.push(label.toLowerCase());
        actions.push(actionFrom("set_post_music", { ok: true, label, text: label, postIds: [post.id], revision: p.revision !== before.revision ? p.revision : undefined }));
      }
    } catch (e: any) {
      warnings.push(`Music: ${e.message}`);
    }
    // make sure spec edits saved without a render above get rendered now
    const now = db.getPost(post.id)!;
    if (hasEdits && changes.length && !["rendering", "changes_requested"].includes(now.status) && now.revision !== post.revision) {
      enqueueRender(post.id);
      rerenderedByEdits = true;
    }
  }
  if (wantsRender && !rerenderedByEdits && !revision) {
    const p = enqueueRender(post.id);
    if (p) actions.push(actionFrom("render_post", { ok: true, label: "Re-render queued", text: "Render queued", postIds: [post.id] }));
    return { text: `Re-rendering “${post.title}” now. The new video will show here when it's ready.`, actions };
  }

  if (!changes.length && warnings.length) return { text: warnings.join(" "), actions };
  if (!changes.length) {
    const tips = [
      "“make the hook punchier”",
      `“switch to ${styles[5]?.name ?? "neon"} style”`,
      "“shorten to 15s”",
      "“change scene 2 text to …”",
      "“use calm music”",
      "“male voice”",
      "“caption: …”",
      "“approve it”",
    ];
    return {
      text: `${warnings.length ? warnings.join(" ") + "\n\n" : ""}I'm in simple mode, so I understand direct edits like ${tips.join(", ")}.\n\n${KEY_NOTE}`,
      actions,
    };
  }
  const nowPost = db.getPost(post.id)!;
  const rendering = ["rendering", "changes_requested"].includes(nowPost.status);
  const reply = [
    `Done — ${changes.join("; ")}.`,
    rendering
      ? `Re-rendering${revision ? ` as revision ${revision}` : ""}; the new video will appear here when it's ready (a reel takes a few minutes).`
      : music && actions.some((a) => a.tool === "set_post_music")
        ? "The audio was re-mixed — play the preview to hear it."
        : !revision
          ? "No re-render needed for that."
          : "",
    post.status === "approved" && revision ? "Note: it was approved before — approve it again once you're happy with the new version." : "",
    warnings.join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { text: reply, actions, revision };
}

export function describePost(post: Post, lower = ""): string {
  const s = post.spec;
  if (/\bcaption\b/.test(lower) && !/scene/.test(lower)) return `The caption is:\n\n${post.caption || "(empty)"}\n\n${post.hashtags.map((h) => "#" + h).join(" ")}`;
  if (isReelSpec(s)) {
    const say = s.scenes.map((sc, i) => `${i + 1}. “${sc.headline}”${sc.voiceoverText && sc.voiceoverText !== sc.headline ? ` — narration: “${sc.voiceoverText}”` : ""} (${sc.durationSec}s)`).join("\n");
    return `“${post.title}” is a ${totalDuration(s)}s ${post.type} in the ${s.style} style${s.captionStyle ? ` with ${s.captionStyle} captions` : ""}. Scene by scene:\n${say}${s.cta ? `\nEnd card: “${s.cta.text}”` : ""}\n\nStatus: ${post.status.replace("_", " ")}, revision ${post.revision}${post.scheduledAt ? `, scheduled ${fmtWhen(post.scheduledAt)}` : ""}.`;
  }
  if (isCarouselSpec(s)) return `“${post.title}” is a ${s.slides.length}-slide carousel (${s.style}):\n${s.slides.map((x, i) => `${i + 1}. “${x.headline}”${x.body ? ` — ${x.body}` : ""}`).join("\n")}`;
  return postDetail(post);
}

// ---------- global assistant ----------
const BRAND_STOP = new Set(["academy", "shop", "studio", "store", "brand", "company", "official", "the", "and", "etsy", "online"]);

export function findBrandIn(text: string, fallback?: string): Brand | undefined {
  const lower = text.toLowerCase();
  const brands = db.listBrands();
  const full = brands.filter((b) => lower.includes(b.name.toLowerCase()));
  if (full.length) return full.sort((a, b) => b.name.length - a.name.length)[0];
  for (const b of brands) {
    const words = b.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !BRAND_STOP.has(w));
    if (words.some((w) => new RegExp(`\\b${w}\\b`).test(lower))) return b;
  }
  if (fallback) {
    const b = db.getBrand(fallback);
    if (b) return b;
  }
  return brands.length === 1 ? brands[0] : undefined;
}

export function findPostsIn(text: string, brandId: string | undefined, ctx: ChatSession["context"]): Post[] {
  const lower = text.toLowerCase();
  const out = new Map<string, Post>();
  for (const tok of text.match(/[A-Za-z0-9_-]{8,16}/g) ?? []) {
    const p = db.getPost(tok);
    if (p) out.set(p.id, p);
  }
  if (out.size) return [...out.values()];
  const pool = db.listPosts(brandId ? { brandId } : {});
  const quoted = text.match(/["“]([^"”]{3,120})["”]/)?.[1]?.toLowerCase();
  if (quoted) {
    const hit = pool.filter((p) => p.title.toLowerCase().includes(quoted) || p.hook.toLowerCase().includes(quoted));
    if (hit.length) return hit;
  }
  if (/\b(them|those|these|they|it|that one|this one|that post|this post|that reel|this reel)\b/.test(lower) && ctx?.lastPostIds?.length) {
    const l = ctx.lastPostIds.map((id) => db.getPost(id)).filter(Boolean) as Post[];
    if (l.length) return l;
  }
  const type = /\bcarousel/.test(lower) ? "carousel" : /\b(image|graphic) posts?\b/.test(lower) ? "image" : /\bstor(y|ies)\b/.test(lower) ? "story" : /\breels?\b/.test(lower) ? "reel" : undefined;
  if (/\b(latest|newest|last|most recent|recent)\b/.test(lower)) {
    const l = pool.filter((p) => !type || p.type === type).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (l[0]) return [l[0]];
  }
  let best: { p: Post; score: number } | undefined;
  for (const p of pool) {
    const words = p.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
    if (words.length < 2) continue;
    const hit = words.filter((w) => lower.includes(w)).length;
    const score = hit / words.length;
    if (score >= 0.6 && (!best || score > best.score)) best = { p, score };
  }
  return best ? [best.p] : [];
}

/** Tool output lists posts as "- id [type, status] "title" — when, rev N" (ids are for Claude); show people a cleaner line. */
function friendly(text: string): string {
  return text.replace(/^- \S+ \[(\w+), ([^\]]+)\] "(.*)" — (.*), rev \d+$/gm, (_m, type, status, title, when) => `• “${title}” — ${type}, ${String(status).replace("_", " ")}, ${when}`);
}

const STATUS_WORDS: [RegExp, string][] = [
  [/\b(ready|waiting|to approve|need(s)? (my )?approval|pending approval|for approval)\b/, "ready"],
  [/\bdrafts?\b/, "draft"],
  [/\brendering|in progress\b/, "rendering"],
  [/\b(approved|scheduled|queued to post)\b/, "approved"],
  [/\b(posted|published|live)\b/, "posted"],
  [/\b(failed|broken|errors?)\b/, "failed"],
];

export async function rulesGlobalTurn(text: string, opts: { brandId?: string; session: ChatSession; hasPending: boolean }): Promise<RuleReply> {
  const t = text.trim();
  const lower = t.toLowerCase();
  const ctx = opts.session.context ?? {};
  const brand = findBrandIn(t, opts.brandId ?? ctx.brandId);
  const brands = db.listBrands();
  const needBrand = (): RuleReply => ({
    text: brands.length ? `Which brand? ${brands.map((b) => b.name).join(" or ")}.` : "You don't have a brand yet. Say “create brand <name> website <url>” to add one.",
    actions: [],
  });
  const one = async (name: string, input: Record<string, unknown>, intro?: string): Promise<RuleReply> => {
    const { r, action } = await runTool(name, input);
    return { text: `${intro ? intro + "\n\n" : ""}${r.ok ? "" : "That didn't work: "}${friendly(r.text)}`, actions: [action], lastPostIds: r.postIds, brandId: r.brandId ?? brand?.id };
  };

  if (!t || /^(help|hi|hello|hey|salam|assalam\w*|what can you do|commands|\?)\b/.test(lower)) {
    return {
      text: [
        "Hi! I can run the app for you. Try:",
        "• “Plan 3 reels for " + (brand?.name ?? "my brand") + " this week”",
        "• “What's waiting for approval?” / “Show the calendar”",
        "• “Make the hook of the latest reel punchier” / “Switch the latest reel to neon style”",
        "• “Approve all ready posts” (you'll confirm first)",
        "• “Run an audit” / “Status” / “List styles” / “List music” / “Instagram status”",
        "• “When someone comments GROW, DM them https://…”",
        "",
        KEY_NOTE,
      ].join("\n"),
      actions: [],
    };
  }
  if (/^(yes|yep|yeah|ok|okay|confirm|do it|go ahead|sure)\b/.test(lower) && opts.hasPending) {
    return { text: "Please press the Confirm button on the card above — I only run approvals, publishing and deletes from that button.", actions: [] };
  }

  // image posts + autopilot (chat-autopost.ts)
  const ap = await autopostGlobalRule(t, brand, { one, needBrand, pending: pendingAction });
  if (ap) return ap;

  // create brand
  if (/\b(create|add|new|set up|setup)\b.*\bbrand\b/.test(lower)) {
    const url = t.match(/https?:\/\/\S+|(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?/i)?.[0];
    const name =
      t.match(/["“]([^"”]{2,60})["”]/)?.[1] ??
      t.match(/\b(?:called|named)\s+(.+?)(?=\s+(?:with|website|site|url|at|for|that|which|who)\b|[,.]|$)/i)?.[1] ??
      t.match(/\bbrand\s*:?\s+(?!called|named)(.+?)(?=\s+(?:with|website|site|url|at|that|which|who)\b|[,.]|$)/i)?.[1];
    if (!name || /^(for|a|an|the)$/i.test(name.trim())) return { text: "What's the brand called? e.g. “create brand “Linen & Thread” website etsy.com/shop/…”.", actions: [] };
    const desc = t.match(/\b(?:that|which|who)\s+(.+)$/i)?.[1];
    return one("create_brand", { name: name.trim(), website: url && !url.includes(name) ? url : undefined, description: desc });
  }

  // clips from a long video ("make 5 clips from C:\Videos\lesson.mp4", "clip status")
  const clipsR = clipsRule(t, brand);
  if (clipsR) return "text" in clipsR ? { text: clipsR.text, actions: [] } : one(clipsR.tool, clipsR.input);
  // etsy ("make a reel from my newest Etsy listing", "import my Etsy shop")
  const etsyR = etsyRule(lower, brand);
  if (etsyR) return "text" in etsyR ? { text: etsyR.text, actions: [] } : one(etsyR.tool, etsyR.input);

  // plan
  if (/\b(plan|make|create|generate|produce|write)\b/.test(lower) && /\b(reels?|carousels?|stor(y|ies)|posts?|content|week)\b/.test(lower) && !findPostsIn(t, brand?.id, ctx).length) {
    if (!brand) return needBrand();
    const counts: Record<string, number> = {};
    for (const m of lower.matchAll(/\b(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\s+(?:more\s+|new\s+|short\s+)?(reels?|carousels?|stor(?:y|ies)|posts?)\b/g)) {
      const n = toNum(m[1]);
      const k = m[2].startsWith("reel") ? "reels" : m[2].startsWith("carousel") ? "carousels" : m[2].startsWith("stor") ? "stories" : "reels";
      if (!isNaN(n)) counts[k] = (counts[k] ?? 0) + Math.min(20, n);
    }
    if (!Object.keys(counts).length) counts.reels = 3;
    const render = !/\b(no render|don'?t render|without render\w*|drafts? only|just drafts?|not render)\b/.test(lower);
    let startDate: string | undefined;
    if (/\bnext week\b/.test(lower)) {
      const d = new Date();
      d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
      d.setHours(0, 0, 0, 0);
      startDate = d.toISOString();
    }
    return one("plan_content", { brandId: brand.id, reels: counts.reels ?? 0, carousels: counts.carousels ?? 0, stories: counts.stories ?? 0, render, startDate }, `On it — planning for ${brand.name}.`).then((r) => ({
      ...r,
      text: r.text + (render ? "\n\nRenders are queued (one at a time, a few minutes each). They'll land on the Approve screen." : ""),
    }));
  }

  // approve
  if (/\bapprove\b/.test(lower) && !/\bdon'?t\b/.test(lower)) {
    let posts: Post[];
    if (/\ball\b/.test(lower)) posts = db.listPosts({ brandId: brand?.id, status: "ready" });
    else posts = findPostsIn(t, brand?.id, ctx);
    if (!posts.length) {
      const ready = db.listPosts({ brandId: brand?.id, status: "ready" });
      return { text: ready.length ? `Which post? Ready now:\n${ready.slice(0, 8).map((p) => `• “${p.title}”`).join("\n")}\n\nSay “approve all ready” or name one.` : "Nothing is ready to approve right now.", actions: [], lastPostIds: ready.map((p) => p.id) };
    }
    const when = after(t, /\b(?:for|at|on)\s+((?:today|tomorrow|tonight|mon|tue|wed|thu|fri|sat|sun|next|in \d|\d).+)$/i);
    const scheduledAt = when ? parseWhen(when) : undefined;
    const act = posts.length === 1 ? pendingAction("approve_post", { postId: posts[0].id, ...(scheduledAt ? { scheduledAt } : {}) }) : pendingAction("approve_posts", { postIds: posts.map((p) => p.id) });
    return { text: `${posts.length === 1 ? `Approve “${posts[0].title}”` : `Approve these ${posts.length} posts`}${scheduledAt ? ` for ${fmtWhen(scheduledAt)}` : " at their scheduled times"}? Press Confirm.`, actions: [act], lastPostIds: posts.map((p) => p.id) };
  }

  // publish
  if (/\b(publish|post\b.*\bnow|go live)\b/.test(lower) && !/\bdon'?t\b/.test(lower)) {
    const posts = findPostsIn(t, brand?.id, ctx);
    if (posts.length !== 1) return { text: "Which post should I publish? Name it (or open it and use the chat there).", actions: [] };
    return { text: `Publish “${posts[0].title}” to Instagram right now? This is public and can't be undone — press Confirm.`, actions: [pendingAction("publish_now", { postId: posts[0].id })], lastPostIds: [posts[0].id] };
  }

  // delete
  if (/\b(delete|remove)\b/.test(lower) && /\bautomation\b/.test(lower) && brand) {
    const kw = t.match(/\b([A-Z0-9]{3,12})\b/)?.[1];
    const au = db.listAutomations(brand.id).find((a) => kw && a.keyword.toLowerCase() === kw.toLowerCase());
    if (!au) return { text: "Which automation? Tell me its keyword (e.g. “delete the GROW automation”).", actions: [] };
    return { text: `Delete the “${au.keyword}” automation? Press Confirm.`, actions: [pendingAction("delete_automation", { automationId: au.id })] };
  }
  if (/\b(delete|remove|trash)\b/.test(lower) && /\b(post|reel|carousel|story|it|them|those)\b/.test(lower) && !/hashtag|music|caption|scene/.test(lower)) {
    const posts = findPostsIn(t, brand?.id, ctx);
    if (posts.length !== 1) return { text: posts.length ? "Please delete one post at a time — which one?" : "Which post? Name it or paste its id.", actions: [] };
    return { text: `Delete “${posts[0].title}”? This can't be undone — press Confirm.`, actions: [pendingAction("delete_post", { postId: posts[0].id })] };
  }

  // audit / analyze
  if (/\baudit\b/.test(lower)) {
    if (!brand) return needBrand();
    if (/\b(show|latest|last|previous|see|read)\b/.test(lower)) return one("get_latest_audit", { brandId: brand.id });
    return one("run_audit", { brandId: brand.id }, `Ran a growth audit for ${brand.name}:`);
  }
  if (/\b(analy[sz]e|re-?analy[sz]e|rebuild (the )?brain|brand brain)\b/.test(lower)) {
    if (!brand) return needBrand();
    if (/\b(show|what|see|read)\b/.test(lower)) return one("get_brand", { brandId: brand.id });
    return one("analyze_brand", { brandId: brand.id });
  }

  // post-specific edits / questions / scheduling
  const refs = findPostsIn(t, brand?.id, ctx);
  if (refs.length === 1 && /\b(change|make|switch|use|set|shorten|shorter|translate|add|remove|regenerate|replace|update|fix|rewrite|schedule|reschedule|move|render|what|describe|voice|music|style|hook|caption|scene)\b/.test(lower)) {
    const r = await rulesPostTurn(refs[0], t);
    return { ...r, lastPostIds: [refs[0].id], text: `About “${refs[0].title}”: ${r.text}`, actions: r.actions.map((a) => ({ ...a, links: a.links ?? [postLink(refs[0])] })) };
  }
  if (/\b(change|make|switch|shorten|translate|regenerate|rewrite)\b/.test(lower) && /\b(hook|style|music|voice|scene|caption|length|\d+\s*s)\b/.test(lower)) {
    return { text: "Which post should I change? Mention its title (in quotes), say “the latest reel”, or open the post and use its chat panel.", actions: [] };
  }

  // calendar
  if (/\b(calendar|schedule[d]?|what'?s (coming|next|up)|upcoming|this week|next week)\b/.test(lower)) return one("get_calendar", { brandId: brand?.id });

  // list posts
  if (/\b(list|show|which|what|any|how many|see)\b/.test(lower) && /\b(posts?|reels?|carousels?|stories|drafts?|ready|approved|waiting|approval|failed|posted|published|rendering)\b/.test(lower)) {
    const status = STATUS_WORDS.find(([re]) => re.test(lower))?.[1];
    const type = /\bcarousels?\b/.test(lower) ? "carousel" : /\b(image|graphic) posts?\b/.test(lower) ? "image" : /\bstor(y|ies)\b/.test(lower) ? "story" : /\breels?\b/.test(lower) ? "reel" : undefined;
    return one("list_posts", { brandId: brand?.id, status, type });
  }

  if (/\b(caption )?styles?\b|\blooks\b|\btemplates?\b/.test(lower) && /\b(list|show|what|which|available|options)\b/.test(lower)) return one("list_styles", {});
  if (/\b(music|tracks?|songs?)\b/.test(lower)) {
    const mood = lower.match(/\b(calm|upbeat|happy|chill|cinematic|energetic|sad|epic|lofi|lo-fi|ambient|corporate|inspiring|dramatic)\b/)?.[1];
    return one("list_music", mood ? { mood } : {});
  }
  if (/\bvoices?\b/.test(lower)) return one("list_voices", {});

  if (/\b(instagram|insta|ig)\b/.test(lower)) {
    if (!brand) return needBrand();
    if (/\b(connect|link|log ?in|authori[sz]e)\b/.test(lower)) return one("connect_instagram_url", { brandId: brand.id });
    return one("instagram_status", { brandId: brand.id });
  }

  // automations
  const kw = t.match(/\bcomments?\s+["“]?([A-Za-z0-9]{2,15})["”]?/i)?.[1];
  if (kw && /\b(when|if|whenever|automation|auto)\b/.test(lower)) {
    if (!brand) return needBrand();
    const link = t.match(/https?:\/\/\S+/)?.[0];
    const reply = after(t, /\breply\s+(?:with\s+)?["“]?([^"”]+?)["”]?(?=\s+and\s+(?:dm|send|message)|$)/i);
    const dm = after(t, /\b(?:dm|message|send)\s+(?:them\s+)?["“]?([^"”]+?)["”]?$/i)?.replace(link ?? "\u0000", "").trim();
    return one("create_automation", { brandId: brand.id, keyword: kw.toUpperCase(), replyText: reply, dmText: dm && dm.length > 2 ? dm : undefined, link });
  }
  if (/\bautomations?\b/.test(lower)) {
    if (!brand) return needBrand();
    return one("list_automations", { brandId: brand.id });
  }
  if (/\bcomments?\b/.test(lower) && brand) return one("get_comment_log", { brandId: brand.id });

  if (/\b(status|overview|summary|dashboard|how('?s| is| are) (it|things|everything)|what'?s going on|queue)\b/.test(lower)) return one("app_status", { brandId: brand?.id });
  if (/\bbrands?\b/.test(lower)) return one("list_brands", {});

  return {
    text: `I'm in simple mode and didn't catch that. I can plan posts, list what's ready, show the calendar, approve or publish (with your confirmation), run audits, and edit a post's hook, style, length, music, voice or scene text.\n\nTry: “plan 2 reels for ${brand?.name ?? "my brand"}”, “what's waiting for approval?”, “switch the latest reel to neon style”.\n\n${KEY_NOTE}`,
    actions: [],
  };
}


