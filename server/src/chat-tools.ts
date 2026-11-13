// Chat assistant tools. Mirrors the MCP connector's tool list (mcp/src/tools.ts) but calls the server's
// internal functions directly instead of going over HTTP. Also holds the post-edit helpers shared by the
// Claude agent and the rule-based (no-key) router.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type { Automation, Brand, CarouselSpec, ChatLink, HtmlReelSpec, Post, PostStatus, PostType, ReelSpec, Scene } from "../../shared/types.ts";
import * as db from "./db.ts";
import { PORT, RENDERS_DIR, UPLOADS_DIR, nowIso } from "./config.ts";
import { startAnalysis, normalizeBrain, heuristicBrain } from "./brain.ts";
import { runAudit } from "./audit.ts";
import { planPosts } from "./planner.ts";
import { newPost, normalizeSpec, isCarouselSpec, isHtmlSpec, isReelSpec, isImageSpec } from "./posts.ts";
import { imageDetail } from "./imagepost.ts";
import { enqueueRender, queueState } from "./render.ts";
import { requestChange } from "./change.ts";
import { nextSlotForBrand, zonedTime } from "./schedule.ts";
import { getStyles, loadVoice, tryLoad } from "./engines.ts";
import { MAX_HASHTAGS } from "./hashtags.ts";
import * as ig from "./instagram.ts";
import type { ChatTool, ToolCtx, ToolResult } from "./chat-agent.ts";
import { etsyChatTools } from "./etsy-chat.ts";
import { clipsChatTools } from "./clips-chat.ts";
import { autopostChatTools } from "./chat-autopost.ts";

// ---------- small helpers ----------
export class ChatError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}
const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
const optStr = (v: unknown) => (typeof v === "string" ? v.trim() || undefined : undefined);
export const plural = (n: number, w: string) => (n === 1 ? `1 ${w}` : `${n} ${w.endsWith("y") ? w.slice(0, -1) + "ies" : w + "s"}`);
export const countLabel = plural;

export function brandOrThrow(id: unknown): Brand {
  const b = typeof id === "string" ? db.getBrand(id) : undefined;
  if (!b) throw new ChatError(404, `Brand not found: ${id ?? "(none)"} — use list_brands to get ids.`);
  return b;
}
export function postOrThrow(id: unknown): Post {
  const p = typeof id === "string" ? db.getPost(id) : undefined;
  if (!p) throw new ChatError(404, `Post not found: ${id ?? "(none)"} — use list_posts to get ids.`);
  return p;
}
function tz() {
  return db.getSettings().timezone;
}
export function fmtWhen(iso?: string): string {
  if (!iso) return "unscheduled";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz(), weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
export function postLine(p: Post): string {
  return `- ${p.id} [${p.type}, ${p.status}${p.status === "rendering" ? ` ${Math.round((p.renderProgress ?? 0) * 100)}%` : ""}] "${p.title}" — ${fmtWhen(p.scheduledAt)}, rev ${p.revision}`;
}
export const postLink = (p: Post): ChatLink => ({ label: p.title.length > 40 ? p.title.slice(0, 38) + "…" : p.title, postId: p.id });
export function totalDuration(spec: Post["spec"]): number {
  if (isHtmlSpec(spec)) return spec.durationSec;
  if (isReelSpec(spec)) return Math.round(spec.scenes.reduce((s, x) => s + (Number(x.durationSec) || 0), 0) * 10) / 10;
  return 0;
}
export function postDetail(p: Post): string {
  const s = p.spec;
  const lines = [
    `Post ${p.id}: "${p.title}" (${p.type}, ${p.status}, revision ${p.revision})`,
    `Hook: ${p.hook}`,
    `Scheduled: ${fmtWhen(p.scheduledAt)}`,
    `Caption: ${p.caption || "(none)"}`,
    `Hashtags: ${p.hashtags.map((h) => "#" + h).join(" ") || "(none)"}`,
  ];
  if (isReelSpec(s)) {
    lines.push(`Style: ${s.style} | Caption style: ${s.captionStyle ?? "none"} | Length ≈ ${totalDuration(s)}s | Voiceover: ${s.voiceover?.src ? "yes" : "auto/none"}${(s as any).voice ? ` (voice ${(s as any).voice})` : ""} | Music: ${s.music?.src ? "yes" : "none"}`);
    s.scenes.forEach((sc, i) =>
      lines.push(`Scene ${i + 1} (${sc.durationSec}s): "${sc.headline}"${sc.subtext ? ` / ${sc.subtext}` : ""}${sc.voiceoverText && sc.voiceoverText !== sc.headline ? ` — says: "${sc.voiceoverText}"` : ""}${sc.media ? ` [${sc.media.kind}]` : ""}`),
    );
    if (s.cta) lines.push(`End card: ${s.cta.text}${s.cta.keyword ? ` (keyword ${s.cta.keyword})` : ""}`);
  } else if (isCarouselSpec(s)) {
    lines.push(`Style: ${s.style}`);
    s.slides.forEach((sl, i) => lines.push(`Slide ${i + 1}: "${sl.headline}"${sl.body ? ` — ${sl.body}` : ""}`));
  } else if (isImageSpec(s)) {
    lines.push(imageDetail(s));
  } else if (isHtmlSpec(s)) {
    lines.push(`HyperFrames HTML composition, ${s.durationSec}s${s.template ? `, template ${s.template}` : ""}`);
  }
  if (p.mediaUrls.length) lines.push(`Media: ${p.mediaUrls.join(", ")}`);
  if (p.error) lines.push(`Error: ${p.error}`);
  return lines.join("\n");
}

/** Parse a human time ("tomorrow 6pm", "fri 10:30", "in 2 hours", ISO) in the app timezone. */
export function parseWhen(input: string, now = new Date()): string | undefined {
  const t = input.trim().toLowerCase().replace(/[.,!?]+$/, "");
  if (!t) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = Date.parse(input.trim());
    return isNaN(d) ? undefined : new Date(d).toISOString();
  }
  const rel = t.match(/in\s+(\d+)\s*(min|minute|hour|hr|day)s?/);
  if (rel) {
    const n = +rel[1];
    const ms = rel[2].startsWith("min") ? 60000 : rel[2].startsWith("h") ? 3600000 : 86400000;
    return new Date(now.getTime() + n * ms).toISOString();
  }
  const zone = tz();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(now);
  const P: Record<string, string> = {};
  for (const x of parts) P[x.type] = x.value;
  const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  let dayOffset: number | undefined;
  if (/\btoday|tonight\b/.test(t)) dayOffset = 0;
  else if (/\btomorrow\b/.test(t)) dayOffset = 1;
  else {
    const m = t.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
    if (m) {
      const today = DOW.indexOf(P.weekday.toLowerCase().slice(0, 3));
      dayOffset = (DOW.indexOf(m[1]) - today + 7) % 7 || 7;
      if (/\bnext\b/.test(t) && dayOffset < 7) dayOffset += 0;
    }
  }
  const tm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  let h: number | undefined, mi = 0;
  if (tm && (tm[2] || tm[3] || dayOffset !== undefined)) {
    h = +tm[1];
    mi = tm[2] ? +tm[2] : 0;
    if (tm[3] === "pm" && h < 12) h += 12;
    if (tm[3] === "am" && h === 12) h = 0;
    if (h > 23 || mi > 59) h = undefined;
  }
  if (/\bnoon\b/.test(t)) h = 12;
  if (/\btonight\b/.test(t) && h === undefined) h = 20;
  if (dayOffset === undefined && h === undefined) {
    const d = Date.parse(input);
    return isNaN(d) ? undefined : new Date(d).toISOString();
  }
  const base = new Date(Date.UTC(+P.year, +P.month - 1, +P.day) + (dayOffset ?? 0) * 86400000);
  let when = zonedTime(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h ?? 10, mi, zone);
  if (dayOffset === undefined && when.getTime() < now.getTime()) when = new Date(when.getTime() + 86400000);
  return when.toISOString();
}

// ---------- voices / music ----------
const FALLBACK_VOICES = [
  { id: "af_heart", name: "Heart", gender: "female", accent: "American" },
  { id: "af_bella", name: "Bella", gender: "female", accent: "American" },
  { id: "am_michael", name: "Michael", gender: "male", accent: "American" },
  { id: "am_adam", name: "Adam", gender: "male", accent: "American" },
  { id: "bf_emma", name: "Emma", gender: "female", accent: "British" },
  { id: "bm_george", name: "George", gender: "male", accent: "British" },
];
export async function listVoices(): Promise<{ id: string; name: string; gender: string; accent: string }[]> {
  const v = await tryLoad(loadVoice);
  try {
    const list = v?.listVoices();
    if (Array.isArray(list) && list.length) return list;
  } catch {
    /* fall back */
  }
  return FALLBACK_VOICES;
}

/** True once the render pipeline honours a per-post `spec.voice` (render.ts / audio.ts). */
let voiceSupport: boolean | undefined;
export function perPostVoiceSupported(): boolean {
  voiceSupport = true; // language.ts narrationFor() honours spec.voice for both engines
  if (voiceSupport) return voiceSupport;
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const read = (f: string) => {
      try {
        return fs.readFileSync(path.join(dir, f), "utf8");
      } catch {
        return "";
      }
    };
    const src = read("render.ts") + "\n" + read("audio.ts");
    voiceSupport = /spec as any\)\.voice|spec\.voice\b|\.voice\s*(\?\?|\|\|)\s*s\.voice/.test(src);
  } catch {
    voiceSupport = false;
  }
  return voiceSupport;
}

export interface MusicTrack {
  id: string;
  title?: string;
  name?: string;
  mood?: string;
  tags?: string[];
  [k: string]: unknown;
}
const selfBase = () => `http://${process.env.HOST && process.env.HOST !== "::1" && process.env.HOST !== "0.0.0.0" ? process.env.HOST : "127.0.0.1"}:${PORT}`;

/** The music module (added separately) is optional: load it if present, tolerate absence. */
async function musicModule(): Promise<any | undefined> {
  const spec = "./music.ts";
  try {
    return await import(spec);
  } catch {
    return undefined;
  }
}
export const trackName = (t: MusicTrack) => String(t.title ?? t.name ?? t.id);

export async function listMusic(brandId?: string): Promise<MusicTrack[]> {
  const m = await musicModule();
  for (const fn of ["listTracks", "listMusic", "getTracks"]) {
    if (typeof m?.[fn] !== "function") continue;
    try {
      const r = await m[fn](brandId);
      const arr = Array.isArray(r) ? r : r?.tracks;
      if (Array.isArray(arr)) return arr;
    } catch {
      /* try next / http */
    }
  }
  const res = await fetch(`${selfBase()}/api/music${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ""}`).catch(() => undefined);
  if (!res || !res.ok) throw new Error("Music library is not available on this server yet.");
  const j: any = await res.json();
  const arr = Array.isArray(j) ? j : (j?.tracks ?? j?.music ?? []);
  return Array.isArray(arr) ? arr : [];
}

/** Pick a track by mood/name words. */
export function matchTrack(tracks: MusicTrack[], query: string): MusicTrack | undefined {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !["music", "use", "the", "some", "with", "song", "track", "add", "more", "change", "make", "background"].includes(w));
  if (!words.length) return tracks[0];
  let best: { t: MusicTrack; score: number } | undefined;
  for (const t of tracks) {
    const hay = JSON.stringify(t).toLowerCase();
    const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { t, score };
  }
  return best?.t;
}

/**
 * Set (trackId) or remove (null) a post's music through the music route (POST /api/posts/:id/music), which
 * owns the spec.music / musicOff semantics. render=true lets it re-mix the existing render (seconds) or re-render.
 */
export async function setPostMusic(postId: string, trackId: string | null | undefined, opts: { render?: boolean; volume?: number } = {}): Promise<Post> {
  const body: Record<string, unknown> = { render: opts.render ?? true };
  if (trackId !== undefined) body.trackId = trackId;
  if (opts.volume !== undefined) body.volume = Math.max(0, Math.min(1, Math.round(opts.volume * 100) / 100));
  const res = await fetch(`${selfBase()}/api/posts/${encodeURIComponent(postId)}/music`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
  if (!res) throw new Error("Music route is not reachable.");
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error ?? `Setting music failed (${res.status})`);
  return j?.id ? (j as Post) : postOrThrow(postId);
}

/** Current music level of a post (0–1), falling back to the Settings default. */
export function musicVolumeOf(p: Post): number {
  const v = (p.spec as any)?.music?.volume;
  return typeof v === "number" ? v : ((db.getSettings() as any).musicVolume ?? 0.3);
}

// ---------- post edits (shared by Claude tools and the rule router) ----------
export interface PostEdits {
  title?: string;
  hook?: string;
  caption?: string;
  hashtags?: string[];
  addHashtags?: string[];
  removeHashtags?: string[];
  scheduledAt?: string | null;
  style?: string;
  captionStyle?: string | null;
  scenes?: { index: number; headline?: string; subtext?: string; voiceoverText?: string }[];
  targetDurationSec?: number;
  voice?: string;
  regenerateVoiceover?: boolean;
  cta?: { text: string; keyword?: string };
  rerender?: boolean;
}

const cleanTag = (h: unknown) => String(h).replace(/^#/, "").replace(/\s+/g, "");
const WORDS_PER_SEC = 2.6;

function trimWords(text: string, max: number): string {
  const w = text.split(/\s+/).filter(Boolean);
  if (w.length <= max) return text;
  return w.slice(0, Math.max(3, max)).join(" ").replace(/[,;:]$/, "") + ".";
}

/**
 * Apply structured edits to a post. Spec changes bump the revision, record a change request and queue a
 * re-render; caption/hashtag/title/schedule-only edits are saved without re-rendering.
 */
export async function applyPostEdits(postId: string, e: PostEdits, note: string): Promise<{ post: Post; changes: string[]; rerendered: boolean; warnings: string[] }> {
  const cur = postOrThrow(postId);
  if (["posted", "publishing"].includes(cur.status)) throw new ChatError(409, `This post is already ${cur.status}, so it can't be changed.`);
  const brand = brandOrThrow(cur.brandId);
  const spec = structuredClone(cur.spec) as ReelSpec | CarouselSpec | HtmlReelSpec;
  const changes: string[] = [];
  const warnings: string[] = [];
  const meta: Partial<Post> = {};
  let specChanged = false;
  let dropVoice = false;

  if (e.title !== undefined && e.title.trim() && e.title !== cur.title) {
    meta.title = e.title.trim();
    changes.push(`title → “${meta.title}”`);
  }
  if (e.caption !== undefined && e.caption !== cur.caption) {
    meta.caption = e.caption.slice(0, 2200);
    changes.push("caption updated");
  }
  let tags = [...cur.hashtags];
  if (Array.isArray(e.hashtags)) tags = e.hashtags.map(cleanTag).filter(Boolean);
  if (Array.isArray(e.addHashtags)) {
    // new tags go first so they survive the 5-hashtag cap
    const add = e.addHashtags.map(cleanTag).filter((h) => h && !tags.some((x) => x.toLowerCase() === h.toLowerCase()));
    tags = [...add, ...tags];
  }
  if (Array.isArray(e.removeHashtags)) {
    const rm = new Set(e.removeHashtags.map((h) => cleanTag(h).toLowerCase()));
    tags = tags.filter((t) => !rm.has(t.toLowerCase()));
  }
  if (JSON.stringify(tags) !== JSON.stringify(cur.hashtags)) {
    if (tags.length > MAX_HASHTAGS) warnings.push(`Instagram allows ${MAX_HASHTAGS} hashtags, so I dropped the extras (kept the newest ones).`);
    meta.hashtags = tags.slice(0, MAX_HASHTAGS);
    changes.push(`hashtags → ${meta.hashtags.map((h) => "#" + h).join(" ") || "(none)"}`);
  }
  if (e.scheduledAt !== undefined) {
    if (e.scheduledAt === null) {
      meta.scheduledAt = undefined;
      changes.push("schedule cleared");
    } else {
      const t = Date.parse(e.scheduledAt);
      if (isNaN(t)) throw new ChatError(400, `Invalid date: ${e.scheduledAt}`);
      meta.scheduledAt = new Date(t).toISOString();
      changes.push(`scheduled for ${fmtWhen(meta.scheduledAt)}`);
    }
  }

  const { styles, captionStyles } = await getStyles();
  if (e.style && !isHtmlSpec(spec)) {
    const want = e.style.toLowerCase();
    const st = styles.find((s) => s.id.toLowerCase() === want) ?? styles.find((s) => s.name.toLowerCase() === want);
    if (!st) warnings.push(`Unknown style “${e.style}” (try: ${styles.map((s) => s.id).join(", ")})`);
    else if (st.id !== (spec as ReelSpec).style) {
      if (st.supports?.length && cur.type !== "image" && !st.supports.includes(cur.type)) warnings.push(`Style ${st.name} isn't made for ${cur.type}s, using it anyway.`);
      (spec as ReelSpec | CarouselSpec).style = st.id;
      specChanged = true;
      changes.push(`style → ${st.name}`);
    }
  }
  if (e.captionStyle !== undefined && isReelSpec(spec)) {
    if (e.captionStyle === null || e.captionStyle === "" || e.captionStyle === "none") {
      if (spec.captionStyle) {
        delete spec.captionStyle;
        specChanged = true;
        changes.push("burned-in captions removed");
      }
    } else {
      const cs = captionStyles.find((c) => c.id.toLowerCase() === e.captionStyle!.toLowerCase() || c.name.toLowerCase() === e.captionStyle!.toLowerCase());
      if (!cs) warnings.push(`Unknown caption style “${e.captionStyle}”`);
      else if (cs.id !== spec.captionStyle) {
        spec.captionStyle = cs.id;
        specChanged = true;
        changes.push(`caption style → ${cs.name}`);
      }
    }
  }
  if (e.hook !== undefined && e.hook.trim() && e.hook.trim() !== cur.hook) {
    const h = e.hook.trim();
    meta.hook = h;
    if (isReelSpec(spec) && spec.scenes[0]) {
      spec.scenes[0].headline = h;
      spec.scenes[0].voiceoverText = h;
      specChanged = dropVoice = true;
    } else if (isCarouselSpec(spec) && spec.slides[0]) {
      spec.slides[0].headline = h;
      specChanged = true;
    } else if (isHtmlSpec(spec)) warnings.push("The hook text inside a custom HTML reel isn't edited automatically.");
    changes.push(`hook → “${h}”`);
  }
  if (Array.isArray(e.scenes) && e.scenes.length) {
    for (const se of e.scenes) {
      const i = Math.floor(Number(se.index)) - 1;
      if (isReelSpec(spec)) {
        const sc = spec.scenes[i];
        if (!sc) {
          warnings.push(`There is no scene ${se.index} (this reel has ${spec.scenes.length}).`);
          continue;
        }
        if (se.headline !== undefined) {
          sc.headline = se.headline;
          if (se.voiceoverText === undefined) sc.voiceoverText = se.headline;
        }
        if (se.subtext !== undefined) sc.subtext = se.subtext || undefined;
        if (se.voiceoverText !== undefined) sc.voiceoverText = se.voiceoverText;
        if (i === 0 && se.headline) meta.hook = se.headline;
        specChanged = dropVoice = true;
        changes.push(`scene ${i + 1} → “${sc.headline}”`);
      } else if (isCarouselSpec(spec)) {
        const sl = spec.slides[i];
        if (!sl) {
          warnings.push(`There is no slide ${se.index} (this carousel has ${spec.slides.length}).`);
          continue;
        }
        if (se.headline !== undefined) sl.headline = se.headline;
        if (se.subtext !== undefined) sl.body = se.subtext || undefined;
        specChanged = true;
        changes.push(`slide ${i + 1} → “${sl.headline}”`);
      } else warnings.push("Scene text inside a custom HTML reel can't be edited this way — use a change request.");
    }
  }
  if (e.targetDurationSec !== undefined) {
    const target = Math.max(3, Math.min(90, Number(e.targetDurationSec) || 0));
    if (isReelSpec(spec)) {
      const total = totalDuration(spec) || 1;
      const k = target / total;
      spec.scenes = spec.scenes.map((sc: Scene) => {
        const d = Math.max(1.2, Math.min(8, Math.round(sc.durationSec * k * 10) / 10));
        const next = { ...sc, durationSec: d };
        if (sc.voiceoverText) next.voiceoverText = trimWords(sc.voiceoverText, Math.floor(d * WORDS_PER_SEC));
        return next;
      });
      specChanged = dropVoice = true;
      changes.push(`length ≈ ${totalDuration(spec)}s (was ${total}s)`);
      if (spec.voiceover?.src || db.getSettings().autoVoiceover) warnings.push("Scene lengths follow the narration, so I trimmed the voiceover lines to fit.");
    } else if (isHtmlSpec(spec)) {
      spec.durationSec = target;
      specChanged = true;
      changes.push(`length → ${target}s`);
    } else warnings.push("Carousels don't have a length.");
  }
  if (e.voice && !isCarouselSpec(spec)) {
    if (!perPostVoiceSupported()) {
      warnings.push(
        `Per-post voices aren't supported by the renderer yet — every post uses the voice set in Settings (currently ${db.getSettings().voice}). Change it in Settings → Voice to use ${e.voice}, then ask me to regenerate the voiceover.`,
      );
    } else {
      (spec as any).voice = e.voice;
      specChanged = dropVoice = true;
      changes.push(`voiceover voice → ${e.voice}`);
    }
  }
  if (e.regenerateVoiceover && isReelSpec(spec)) {
    specChanged = dropVoice = true;
    if (!changes.some((c) => c.startsWith("voiceover"))) changes.push("voiceover regenerated");
  }
  if (e.cta?.text && isReelSpec(spec)) {
    const kw = e.cta.keyword ?? e.cta.text.match(/comment\s+([A-Z0-9]{3,12})/i)?.[1]?.toUpperCase() ?? spec.cta?.keyword;
    spec.cta = { text: e.cta.text, keyword: kw };
    specChanged = true;
    changes.push(`end card → “${e.cta.text}”`);
  }

  let finalSpec: Post["spec"] | undefined;
  if (specChanged) {
    try {
      finalSpec = normalizeSpec(cur.type, spec, brand);
    } catch (err: any) {
      throw new ChatError(400, err.message);
    }
  }
  const rerender = specChanged && e.rerender !== false;
  if (!changes.length) return { post: cur, changes, rerendered: false, warnings };
  let post = db.updatePost(postId, (x: Post) => {
    Object.assign(x, meta);
    if ("scheduledAt" in meta && meta.scheduledAt === undefined) x.scheduledAt = undefined;
    if (finalSpec) {
      x.spec = finalSpec;
      if (dropVoice && isReelSpec(x.spec) && x.spec.voiceover?.src?.includes(`/renders/${x.id}/`)) {
        delete x.spec.voiceover;
        delete x.spec.captions;
      }
      x.revision += 1;
      x.changeRequests.push({ text: note, createdAt: nowIso() });
    }
  })!;
  if (rerender) post = enqueueRender(postId) ?? post;
  return { post, changes, rerendered: rerender, warnings };
}

/** Approve logic (same as POST /api/posts/:id/approve). */
export function approvePost(postId: string, scheduledAt?: string): Post {
  const x = postOrThrow(postId);
  if (["posted", "publishing"].includes(x.status)) throw new ChatError(409, `Post is already ${x.status}`);
  const b = brandOrThrow(x.brandId);
  const t = scheduledAt ? Date.parse(scheduledAt) : NaN;
  const sched = !isNaN(t) ? new Date(t).toISOString() : x.scheduledAt && Date.parse(x.scheduledAt) > Date.now() ? x.scheduledAt : nextSlotForBrand(b);
  return db.updatePost(x.id, (y: any) => {
    if (y.status === "rendering" || y.status === "changes_requested") y.approvedPending = true;
    else y.status = "approved";
    y.scheduledAt = sched;
    y.error = undefined;
  })!;
}

export function deletePost(postId: string) {
  const x = postOrThrow(postId);
  db.deletePostRow(x.id);
  fs.rmSync(path.join(RENDERS_DIR, x.id), { recursive: true, force: true });
}

/** Rendered revisions still on disk for a post. */
export function postRevisions(post: Post) {
  const dir = path.join(RENDERS_DIR, post.id);
  if (!fs.existsSync(dir)) return [];
  const out: { revision: number; mediaUrls: string[]; thumbnailUrl?: string; createdAt: string; current: boolean }[] = [];
  for (const d of fs.readdirSync(dir)) {
    const m = d.match(/^r(\d+)$/);
    if (!m) continue;
    const full = path.join(dir, d);
    let files: string[] = [];
    try {
      files = fs.readdirSync(full);
    } catch {
      continue;
    }
    const url = (f: string) => `/files/renders/${encodeURIComponent(post.id)}/${d}/${encodeURIComponent(f)}`;
    const video = files.find((f) => /^reel\.mp4$/i.test(f)) ?? files.find((f) => /\.mp4$/i.test(f));
    const slides = files.filter((f) => /^slide-\d+\.png$/i.test(f)).sort();
    const mediaUrls = video ? [url(video)] : slides.map(url);
    if (!mediaUrls.length) continue;
    const thumb = files.find((f) => /^thumb\.(jpg|png)$/i.test(f));
    const stat = fs.statSync(path.join(full, video ?? slides[0]));
    out.push({ revision: +m[1], mediaUrls, thumbnailUrl: thumb ? url(thumb) : slides[0] ? url(slides[0]) : undefined, createdAt: stat.mtime.toISOString(), current: +m[1] === post.revision });
  }
  return out.sort((a, b) => b.revision - a.revision);
}

export function appStatus(brandId?: string): string {
  const brands = db.listBrands();
  const posts = db.listPosts(brandId ? { brandId } : {});
  const by: Record<string, number> = {};
  for (const p of posts) by[p.status] = (by[p.status] ?? 0) + 1;
  const q = queueState();
  const s = db.getSettings();
  const next = posts.filter((p) => p.status === "approved" && p.scheduledAt).sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))[0];
  const lines = [
    `${brands.length} brand(s): ${brands.map((b) => `${b.name}${b.igConnected ? " (Instagram connected)" : ""}`).join(", ") || "none yet"}`,
    `Posts${brandId ? ` for ${db.getBrand(brandId)?.name}` : ""}: ${Object.entries(by).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ") || "none"}`,
    `Render queue: ${q.running ? `rendering ${db.getPost(q.running)?.title ?? q.running}` : "idle"}${q.queued.length ? `, ${q.queued.length} waiting` : ""}`,
    next ? `Next post: “${next.title}” at ${fmtWhen(next.scheduledAt)}` : "Nothing approved and scheduled yet.",
    `Anthropic key: ${s.anthropicApiKeySet ? "set" : "not set"} · Auto-publish: ${s.autoPublish ? "on" : "off"}`,
  ];
  return lines.join("\n");
}

// ---------- tool definitions ----------
const S = {
  brandId: { type: "string", description: "Brand id (from list_brands)." },
  postId: { type: "string", description: "Post id (from list_posts / get_post)." },
  iso: { type: "string", description: "ISO 8601 date-time, e.g. 2026-11-14T18:00:00+05:00." },
  hashtags: { type: "array", items: { type: "string" }, description: "Hashtags without '#'. Instagram allows max 5 — use specific niche keywords." },
  cta: {
    type: "object",
    properties: { text: { type: "string", description: "End-card text, e.g. \"Comment GROW for the free guide\"." }, keyword: { type: "string" } },
    required: ["text"],
  },
  scene: {
    type: "object",
    properties: {
      headline: { type: "string", description: "Big on-screen text, max ~7 words." },
      subtext: { type: "string" },
      bullets: { type: "array", items: { type: "string" } },
      voiceoverText: { type: "string", description: "Narration line. ALWAYS fill: free voiceover + word captions are generated from it." },
      mediaAssetId: { type: "string", description: "Uploaded brand asset id (list_assets) as background." },
      mediaUrl: { type: "string" },
      durationSec: { type: "number", description: "1.5–4 typical; first scene ≤2s." },
    },
    required: ["headline", "durationSec"],
  },
  slide: {
    type: "object",
    properties: { headline: { type: "string" }, body: { type: "string" }, mediaAssetId: { type: "string" }, mediaUrl: { type: "string" } },
    required: ["headline"],
  },
} as const;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required });

function resolveMedia(brandId: string, x: { mediaAssetId?: string; mediaUrl?: string }) {
  if (x.mediaAssetId) {
    const a = db.getAsset(x.mediaAssetId);
    if (a && a.brandId === brandId && a.kind !== "audio") return { src: a.url, kind: a.kind as "image" | "video" };
  }
  if (x.mediaUrl && /^https?:\/\//.test(x.mediaUrl)) return { src: x.mediaUrl, kind: /\.(mp4|mov|webm)(\?|$)/i.test(x.mediaUrl) ? ("video" as const) : ("image" as const) };
  return undefined;
}

async function createReelLike(type: "reel" | "story", a: any): Promise<ToolResult> {
  const brand = brandOrThrow(a.brandId);
  if (!Array.isArray(a.scenes) || !a.scenes.length) throw new ChatError(400, "scenes[] is required");
  const scenes = a.scenes.map((s: any, i: number) => ({
    id: `s${i + 1}`,
    durationSec: Number(s.durationSec) || 3,
    headline: String(s.headline ?? ""),
    subtext: optStr(s.subtext),
    bullets: Array.isArray(s.bullets) ? s.bullets.map(String) : undefined,
    voiceoverText: optStr(s.voiceoverText),
    media: resolveMedia(brand.id, s),
  }));
  const spec = normalizeSpec(type, { style: a.style, captionStyle: a.captionStyle, scenes, cta: a.cta }, brand);
  const p = newPost({
    brandId: brand.id,
    type,
    title: optStr(a.title),
    hook: optStr(a.hook),
    caption: str(a.caption) ?? "",
    hashtags: Array.isArray(a.hashtags) ? a.hashtags : [],
    spec,
    scheduledAt: a.scheduledAt && !isNaN(Date.parse(a.scheduledAt)) ? new Date(a.scheduledAt).toISOString() : undefined,
  });
  const r = enqueueRender(p.id) ?? p;
  return { ok: true, label: `Created ${type} “${p.title}”`, text: `Created ${type}, render queued:\n${postLine(r)}`, postIds: [p.id], links: [postLink(p)], brandId: brand.id };
}

export function buildTools(): ChatTool[] {
  const tools: ChatTool[] = [
    // ----- brands -----
    {
      name: "list_brands",
      description: "List all brands with ids, analysis status and Instagram connection state. Start here.",
      input_schema: obj({}),
      run: async () => {
        const bs = db.listBrands();
        return {
          ok: true,
          label: `Found ${plural(bs.length, "brand")}`,
          text: bs.length ? bs.map((b) => `- ${b.id} ${b.name} (analysis ${b.analysisStatus}${b.igConnected ? ", IG connected" : ""})`).join("\n") : "No brands yet.",
          links: bs.slice(0, 6).map((b) => ({ label: b.name, to: `/brands/${b.id}` })),
        };
      },
    },
    {
      name: "get_brand",
      description: "Get one brand including its brand brain (summary, audience, voice, colors, CTAs, keywords, pillars, best times, claims to avoid). Read before writing content.",
      input_schema: obj({ brandId: S.brandId }, ["brandId"]),
      run: async ({ brandId }) => {
        const b = brandOrThrow(brandId);
        const br = b.brain;
        return {
          ok: true,
          label: `Read ${b.name}'s brand brain`,
          brandId: b.id,
          links: [{ label: "Brand Brain", to: `/brands/${b.id}` }],
          text: br
            ? JSON.stringify({ id: b.id, name: b.name, website: b.website, instagram: b.instagramHandle, ...br }, null, 1)
            : `${b.name} (${b.id}) has no brand brain yet — run analyze_brand.`,
        };
      },
    },
    {
      name: "create_brand",
      description: "Create a new brand. If a website or description is given, the brand brain is built in the background.",
      input_schema: obj(
        { name: { type: "string" }, website: { type: "string" }, instagramHandle: { type: "string" }, description: { type: "string", description: "What the business does." } },
        ["name"],
      ),
      run: async (a) => {
        const name = str(a.name);
        if (!name) throw new ChatError(400, "name is required");
        const now = nowIso();
        const brand: Brand = {
          id: nanoid(10),
          name,
          website: optStr(a.website),
          instagramHandle: optStr(a.instagramHandle)?.replace(/^@/, ""),
          description: optStr(a.description),
          analysisStatus: "idle",
          igConnected: false,
          createdAt: now,
          updatedAt: now,
        };
        db.saveBrand(brand);
        fs.mkdirSync(path.join(UPLOADS_DIR, brand.id), { recursive: true });
        const out = brand.website || brand.description ? (startAnalysis(brand.id) ?? brand) : brand;
        return {
          ok: true,
          label: `Created brand ${name}`,
          brandId: brand.id,
          links: [{ label: "Brand Brain", to: `/brands/${brand.id}` }],
          text: `Created brand ${name} (id ${brand.id}). Analysis: ${out.analysisStatus}.`,
        };
      },
    },
    {
      name: "analyze_brand",
      description: "Scrape the brand's website/description and (re)build its brand brain. Waits up to ~30s.",
      input_schema: obj({ brandId: S.brandId }, ["brandId"]),
      run: async ({ brandId }) => {
        let b = brandOrThrow(brandId);
        if (b.analysisStatus !== "running") b = startAnalysis(b.id) ?? b;
        const deadline = Date.now() + 30_000;
        while (b.analysisStatus === "running" && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1500));
          b = brandOrThrow(brandId);
        }
        const done = b.analysisStatus === "done";
        return {
          ok: b.analysisStatus !== "failed",
          label: done ? `Analyzed ${b.name}` : b.analysisStatus === "running" ? `Analyzing ${b.name}…` : `Analysis of ${b.name} failed`,
          brandId: b.id,
          links: [{ label: "Brand Brain", to: `/brands/${b.id}` }],
          text: done ? `Brand brain ready: ${b.brain?.summary ?? ""}` : b.analysisStatus === "running" ? "Still analyzing in the background." : `Failed: ${b.analysisError ?? "unknown error"}`,
        };
      },
    },
    {
      name: "update_brand_brain",
      description: "Merge a partial update into the brand brain (fields replace; colors/fonts merge key by key). Use to fix voice, colors, CTAs, keywords, best times, etc.",
      input_schema: obj({ brandId: S.brandId, brain: { type: "object", description: "Partial BrandBrain, e.g. {voice, ctas, bestTimes:[\"Tue 18:00\"], colors:{primary:\"#123456\"}}" } }, ["brandId", "brain"]),
      run: async ({ brandId, brain }) => {
        const cur = brandOrThrow(brandId);
        const b = db.updateBrand(cur.id, (x) => {
          const base = x.brain ?? heuristicBrain(x);
          x.brain = normalizeBrain({ ...base, ...brain, colors: { ...base.colors, ...(brain?.colors ?? {}) } }, base);
          if (x.analysisStatus === "idle") x.analysisStatus = "done";
        })!;
        return { ok: true, label: `Updated ${b.name}'s brand brain`, brandId: b.id, links: [{ label: "Brand Brain", to: `/brands/${b.id}` }], text: `Updated fields: ${Object.keys(brain ?? {}).join(", ")}` };
      },
    },
    {
      name: "list_assets",
      description: "List the brand's uploaded media (images, videos, audio) with ids and URLs.",
      input_schema: obj({ brandId: S.brandId, kind: { type: "string", enum: ["image", "video", "audio"] } }, ["brandId"]),
      run: async ({ brandId, kind }) => {
        const list = db.listAssets(brandOrThrow(brandId).id).filter((a) => !kind || a.kind === kind);
        return { ok: true, label: `Found ${plural(list.length, "asset")}`, text: list.map((a) => `- ${a.id} ${a.kind} ${a.originalName} ${a.url}`).join("\n") || "No assets." };
      },
    },
    // ----- audit -----
    {
      name: "run_audit",
      description: "Run a growth audit for the brand (strengths, weaknesses, opportunities, first 3 reels to make). Takes up to ~30–60s.",
      input_schema: obj({ brandId: S.brandId }, ["brandId"]),
      run: async ({ brandId }) => {
        const a = await runAudit(brandOrThrow(brandId));
        return {
          ok: true,
          label: "Ran growth audit",
          brandId: a.brandId,
          links: [{ label: "Open audit", to: "/audit" }],
          text: `${a.summary}\nStrengths: ${a.strengths.join("; ")}\nWeaknesses: ${a.weaknesses.join("; ")}\nOpportunities: ${a.opportunities.join("; ")}\nFirst reels: ${a.firstReels.map((r) => `“${r.title}” (hook: ${r.hook})`).join("; ")}`,
        };
      },
    },
    {
      name: "get_latest_audit",
      description: "Get the most recent growth audit for the brand.",
      input_schema: obj({ brandId: S.brandId }, ["brandId"]),
      run: async ({ brandId }) => {
        const a = db.listAudits(brandOrThrow(brandId).id)[0];
        if (!a) return { ok: true, label: "No audit yet", text: "No audits yet — run run_audit." };
        return { ok: true, label: "Read latest audit", links: [{ label: "Open audit", to: "/audit" }], text: `${a.summary}\nStrengths: ${a.strengths.join("; ")}\nWeaknesses: ${a.weaknesses.join("; ")}\nOpportunities: ${a.opportunities.join("; ")}` };
      },
    },
    // ----- styles / voices / music -----
    {
      name: "list_styles",
      description: "List reel/carousel/story visual styles and caption styles (ids to pass as style / captionStyle), plus HTML templates.",
      input_schema: obj({}),
      run: async () => {
        const s = await getStyles();
        return {
          ok: true,
          label: `${s.styles.length} styles, ${s.captionStyles.length} caption styles`,
          links: [{ label: "Styles", to: "/styles" }],
          text: [
            "Styles:",
            ...s.styles.map((x) => `- ${x.id}: ${x.name} — ${x.description} [${x.supports.join("/")}]`),
            "Caption styles:",
            ...s.captionStyles.map((c) => `- ${c.id}: ${c.name} — ${c.description}`),
            ...(s.htmlTemplates.length ? ["HTML templates:", ...s.htmlTemplates.map((t) => `- ${t.id}: ${t.name}`)] : []),
          ].join("\n"),
        };
      },
    },
    {
      name: "list_voices",
      description: "List the free local voiceover voices (id, gender, accent).",
      input_schema: obj({}),
      run: async () => {
        const v = await listVoices();
        return { ok: true, label: `${v.length} voices`, text: v.map((x) => `- ${x.id}: ${x.name} (${x.gender}, ${x.accent})`).join("\n") };
      },
    },
    {
      name: "list_music",
      description: "List background music tracks in the library (id, title, mood). Optionally filter by mood words.",
      input_schema: obj({ mood: { type: "string", description: "e.g. calm, upbeat, cinematic" } }),
      run: async ({ mood }, ctx) => {
        let t = await listMusic(ctx.brandId);
        if (mood) t = t.filter((x) => JSON.stringify(x).toLowerCase().includes(String(mood).toLowerCase()));
        return { ok: true, label: `${plural(t.length, "track")}${mood ? ` (${mood})` : ""}`, text: t.map((x) => `- ${x.id}: ${trackName(x)}${x.mood ? ` (${x.mood})` : ""}${x.tags?.length ? ` [${x.tags.join(", ")}]` : ""}`).join("\n") || "No tracks." };
      },
    },
    // ----- planning & creation -----
    {
      name: "plan_content",
      description: "Auto-plan draft posts for the brand (scheduled at its best times) and queue renders. Good for a quick batch.",
      input_schema: obj(
        {
          brandId: S.brandId,
          reels: { type: "integer", minimum: 0, maximum: 20, description: "Default 3." },
          carousels: { type: "integer", minimum: 0, maximum: 20 },
          stories: { type: "integer", minimum: 0, maximum: 20 },
          images: { type: "integer", minimum: 0, maximum: 20, description: "Single-image feed posts (designed 4:5 graphics: tip, quote, poll, product, fact…)." },
          startDate: S.iso,
          render: { type: "boolean", description: "Queue renders now (default true)." },
        },
        ["brandId"],
      ),
      run: async (a) => {
        const b = brandOrThrow(a.brandId);
        const posts = await planPosts(b, { reels: a.reels, carousels: a.carousels, stories: a.stories, images: a.images, startDate: a.startDate, render: a.render });
        const counts: Record<string, number> = {};
        for (const p of posts) counts[p.type] = (counts[p.type] ?? 0) + 1;
        const label = posts.length ? `Planned ${Object.entries(counts).map(([t, n]) => countLabel(n, t)).join(", ")}` : "Planned nothing";
        return {
          ok: true,
          label,
          brandId: b.id,
          postIds: posts.map((p) => p.id),
          links: [...posts.slice(0, 8).map(postLink), { label: "Approve screen", to: "/approve" }],
          text: `${label} for ${b.name}${a.render === false ? " (drafts, not rendered)" : " — renders queued"}:\n${posts.map(postLine).join("\n")}`,
        };
      },
    },
    {
      name: "create_reel",
      description:
        "Write a full reel and queue its render. Hook in the first 1.5s; 5–7 scenes; short headlines; ALWAYS fill voiceoverText and set captionStyle; end with a cta keyword. Respect the brand voice and claimsToAvoid.",
      input_schema: obj(
        {
          brandId: S.brandId,
          title: { type: "string" },
          hook: { type: "string" },
          caption: { type: "string", description: "Instagram caption WITHOUT hashtags." },
          hashtags: S.hashtags,
          style: { type: "string", description: "Style id from list_styles." },
          captionStyle: { type: "string" },
          scenes: { type: "array", items: S.scene, minItems: 1, maxItems: 15 },
          cta: S.cta,
          scheduledAt: S.iso,
        },
        ["brandId", "title", "hook", "caption", "hashtags", "style", "scenes"],
      ),
      run: (a) => createReelLike("reel", a),
    },
    {
      name: "create_story",
      description: "Write an Instagram story (9:16, 1–4 short scenes, ~5–15s) and queue its render.",
      input_schema: obj(
        { brandId: S.brandId, title: { type: "string" }, style: { type: "string" }, captionStyle: { type: "string" }, scenes: { type: "array", items: S.scene, minItems: 1, maxItems: 6 }, cta: S.cta, scheduledAt: S.iso },
        ["brandId", "title", "style", "scenes"],
      ),
      run: (a) => createReelLike("story", a),
    },
    {
      name: "create_carousel",
      description: "Write an Instagram carousel (2–10 slides, 1080x1350) and queue its render. Slide 1 = hook, last = CTA.",
      input_schema: obj(
        {
          brandId: S.brandId,
          title: { type: "string" },
          hook: { type: "string" },
          caption: { type: "string" },
          hashtags: S.hashtags,
          style: { type: "string", description: "Style id that supports carousel." },
          slides: { type: "array", items: S.slide, minItems: 2, maxItems: 10 },
          scheduledAt: S.iso,
        },
        ["brandId", "title", "caption", "hashtags", "style", "slides"],
      ),
      run: async (a) => {
        const brand = brandOrThrow(a.brandId);
        const slides = (a.slides ?? []).map((s: any) => ({ headline: String(s.headline ?? ""), body: optStr(s.body), media: resolveMedia(brand.id, s) }));
        const spec = normalizeSpec("carousel", { style: a.style, slides }, brand);
        const p = newPost({ brandId: brand.id, type: "carousel", title: a.title, hook: a.hook ?? slides[0]?.headline, caption: a.caption ?? "", hashtags: a.hashtags ?? [], spec, scheduledAt: a.scheduledAt });
        const r = enqueueRender(p.id) ?? p;
        return { ok: true, label: `Created carousel “${p.title}”`, postIds: [p.id], links: [postLink(p)], brandId: brand.id, text: `Created carousel (${slides.length} slides):\n${postLine(r)}` };
      },
    },
    // ----- posts -----
    {
      name: "list_posts",
      description: "List posts, optionally filtered by brand, status (draft, rendering, ready, changes_requested, approved, publishing, posted, failed) and type.",
      input_schema: obj({
        brandId: S.brandId,
        status: { type: "string", enum: ["draft", "rendering", "ready", "changes_requested", "approved", "publishing", "posted", "failed"] },
        type: { type: "string", enum: ["reel", "carousel", "story", "image"] },
      }),
      run: async (q) => {
        const posts = db.listPosts({ brandId: optStr(q.brandId), status: optStr(q.status), type: optStr(q.type) });
        return {
          ok: true,
          label: `Found ${plural(posts.length, "post")}${q.status ? ` (${String(q.status).replace("_", " ")})` : ""}`,
          postIds: posts.slice(0, 30).map((p) => p.id),
          links: posts.slice(0, 6).map(postLink),
          text: posts.length ? posts.slice(0, 40).map(postLine).join("\n") + (posts.length > 40 ? `\n…and ${posts.length - 40} more` : "") : "No posts match.",
        };
      },
    },
    {
      name: "get_post",
      description: "Get one post with full details: scenes/slides text, caption, hashtags, style, status, media.",
      input_schema: obj({ postId: S.postId }, ["postId"]),
      run: async ({ postId }) => {
        const p = postOrThrow(postId);
        return { ok: true, label: `Read “${p.title}”`, postIds: [p.id], links: [postLink(p)], text: postDetail(p) };
      },
    },
    {
      name: "request_change",
      description:
        "Send free-form revision feedback for a post (e.g. \"make the hook punchier and translate the captions to Urdu\"); the server rewrites the spec and re-renders. Use for creative rewrites; for precise edits prefer update_post.",
      input_schema: obj({ postId: S.postId, text: { type: "string", description: "What to change, in plain words." } }, ["postId", "text"]),
      run: async ({ postId, text }) => {
        const cur = postOrThrow(postId);
        if (["posted", "publishing"].includes(cur.status)) throw new ChatError(409, `Post is already ${cur.status}`);
        const p = await requestChange(cur.id, String(text));
        return { ok: true, label: `Revision ${cur.revision + 1} requested`, revision: cur.revision + 1, postIds: [p.id], links: [postLink(p)], text: `Change requested (“${text}”). The post is being rewritten and re-rendered as revision ${cur.revision + 1}.` };
      },
    },
    {
      name: "update_post",
      description:
        "Precise edits to a post. Metadata (title, caption, hashtags, scheduledAt) saves without re-rendering. Visual edits (hook, style, captionStyle, scene text, targetDurationSec, voice, cta) bump the revision and queue a re-render.",
      input_schema: obj(
        {
          postId: S.postId,
          title: { type: "string" },
          hook: { type: "string", description: "New hook (also scene/slide 1 headline)." },
          caption: { type: "string", description: "Instagram caption without hashtags." },
          hashtags: S.hashtags,
          addHashtags: S.hashtags,
          removeHashtags: S.hashtags,
          scheduledAt: S.iso,
          style: { type: "string", description: "Style id from list_styles." },
          captionStyle: { type: "string", description: "Caption style id, or \"none\" to remove burned-in captions." },
          scenes: {
            type: "array",
            description: "Scene (or carousel slide) text edits, 1-based index.",
            items: obj({ index: { type: "integer", minimum: 1 }, headline: { type: "string" }, subtext: { type: "string" }, voiceoverText: { type: "string" } }, ["index"]),
          },
          targetDurationSec: { type: "number", description: "Rescale the reel to about this many seconds." },
          voice: { type: "string", description: "Voiceover voice id from list_voices (regenerates the narration)." },
          regenerateVoiceover: { type: "boolean" },
          cta: S.cta,
          rerender: { type: "boolean", description: "Default true when visuals change." },
        },
        ["postId"],
      ),
      run: async ({ postId, ...edits }) => {
        const r = await applyPostEdits(postId, edits, `Chat edit: ${Object.keys(edits).join(", ")}`);
        if (!r.changes.length) return { ok: !r.warnings.length, label: "Nothing changed", text: r.warnings.join("\n") || "Nothing to change." };
        return {
          ok: true,
          label: r.rerendered ? `Revision ${r.post.revision}: ${r.changes.join(", ")}` : `Saved: ${r.changes.join(", ")}`,
          revision: r.rerendered ? r.post.revision : undefined,
          postIds: [r.post.id],
          links: [postLink(r.post)],
          text: `Changed: ${r.changes.join("; ")}.${r.rerendered ? ` Re-render queued (revision ${r.post.revision}).` : " No re-render needed."}${r.warnings.length ? `\nNotes: ${r.warnings.join(" ")}` : ""}`,
        };
      },
    },
    {
      name: "set_post_music",
      description:
        "Set, change or remove a post's background music and/or its volume. trackId from list_music, \"auto\" to auto-pick, or null to remove; omit trackId to only change volume (0–1, music level under the voice). The audio is re-mixed in ~10s (or re-rendered).",
      input_schema: obj(
        { postId: S.postId, trackId: { type: ["string", "null"], description: "Track id, \"auto\", or null for no music. Omit to keep the track." }, volume: { type: "number", minimum: 0, maximum: 1 } },
        ["postId"],
      ),
      run: async ({ postId, trackId, volume }) => {
        const cur = postOrThrow(postId);
        const p = await setPostMusic(cur.id, trackId, { volume });
        const what = trackId === null ? "Music removed" : trackId ? `Music → ${trackId}` : `Music volume → ${Math.round((volume ?? 0) * 100)}%`;
        return { ok: true, label: what, postIds: [p.id], links: [postLink(p)], revision: p.revision !== cur.revision ? p.revision : undefined, text: `${what}. Status: ${p.status}.` };
      },
    },
    {
      name: "render_post",
      description: "Queue a (re-)render of a post with its current spec.",
      input_schema: obj({ postId: S.postId }, ["postId"]),
      run: async ({ postId }) => {
        const cur = postOrThrow(postId);
        if (cur.status === "publishing") throw new ChatError(409, "Post is being published");
        const p = enqueueRender(cur.id) ?? cur;
        return { ok: true, label: `Re-render queued`, postIds: [p.id], links: [postLink(p)], text: `Render queued for “${p.title}”.` };
      },
    },
    {
      name: "approve_post",
      description:
        "Approve a rendered post so it auto-publishes at scheduledAt (or the next best slot). The app asks the user to confirm with a button before anything happens.",
      input_schema: obj({ postId: S.postId, scheduledAt: S.iso }, ["postId"]),
      sensitive: true,
      describe: (a) => {
        const p = db.getPost(String(a.postId));
        return `Approve “${p?.title ?? a.postId}”${a.scheduledAt ? ` for ${fmtWhen(a.scheduledAt)}` : p?.scheduledAt ? ` for ${fmtWhen(p.scheduledAt)}` : ""}`;
      },
      run: async ({ postId, scheduledAt }) => {
        const p = approvePost(postId, scheduledAt);
        return { ok: true, label: `Approved “${p.title}”`, postIds: [p.id], links: [postLink(p), { label: "Calendar", to: "/calendar" }], text: `Approved — will publish ${fmtWhen(p.scheduledAt)}.` };
      },
    },
    {
      name: "approve_posts",
      description: "Approve several posts at once (each at its scheduled time or the next best slot). The user confirms with a button first.",
      input_schema: obj({ postIds: { type: "array", items: { type: "string" }, minItems: 1 } }, ["postIds"]),
      sensitive: true,
      describe: (a) => `Approve ${plural((a.postIds ?? []).length, "post")}: ${(a.postIds ?? []).map((id: string) => `“${db.getPost(id)?.title ?? id}”`).slice(0, 5).join(", ")}`,
      run: async ({ postIds }) => {
        const ok: Post[] = [];
        const errs: string[] = [];
        for (const id of postIds ?? []) {
          try {
            ok.push(approvePost(id));
          } catch (e: any) {
            errs.push(`${id}: ${e.message}`);
          }
        }
        return { ok: ok.length > 0, label: `Approved ${plural(ok.length, "post")}`, postIds: ok.map((p) => p.id), links: [...ok.slice(0, 6).map(postLink), { label: "Calendar", to: "/calendar" }], text: ok.map((p) => `- “${p.title}” → ${fmtWhen(p.scheduledAt)}`).join("\n") + (errs.length ? `\nFailed: ${errs.join("; ")}` : "") };
      },
    },
    {
      name: "publish_now",
      description: "Immediately publish a rendered post to the brand's Instagram. Public and irreversible — the user confirms with a button first.",
      input_schema: obj({ postId: S.postId }, ["postId"]),
      sensitive: true,
      describe: (a) => `Publish “${db.getPost(String(a.postId))?.title ?? a.postId}” to Instagram now`,
      run: async ({ postId }) => {
        const x = postOrThrow(postId);
        if (x.status === "posted") throw new ChatError(409, "Already posted");
        const p = await ig.publishPost(x.id);
        return { ok: p.status !== "failed", label: p.status === "posted" ? `Published “${p.title}”` : `Publish: ${p.status}`, postIds: [p.id], links: [postLink(p), ...(p.igPermalink ? [{ label: "View on Instagram", to: p.igPermalink }] : [])], text: `Status ${p.status}${p.igPermalink ? ` — ${p.igPermalink}` : ""}${p.error ? ` (${p.error})` : ""}` };
      },
    },
    {
      name: "delete_post",
      description: "Delete a post from the app (not from Instagram). The user confirms with a button first.",
      input_schema: obj({ postId: S.postId }, ["postId"]),
      sensitive: true,
      describe: (a) => `Delete “${db.getPost(String(a.postId))?.title ?? a.postId}” (can't be undone)`,
      run: async ({ postId }) => {
        const p = postOrThrow(postId);
        deletePost(p.id);
        return { ok: true, label: `Deleted “${p.title}”`, text: `Deleted post ${p.id}.` };
      },
    },
    {
      name: "get_calendar",
      description: "List posts scheduled in a date range (default: today through the next 14 days).",
      input_schema: obj({ brandId: S.brandId, from: S.iso, to: S.iso }),
      run: async ({ brandId, from, to }) => {
        const f = from ? Date.parse(from) : new Date().setHours(0, 0, 0, 0);
        const t = to ? Date.parse(to) : Date.now() + 14 * 86400000;
        const posts = db
          .listPosts({ brandId: optStr(brandId) })
          .filter((p) => p.scheduledAt && Date.parse(p.scheduledAt) >= f && Date.parse(p.scheduledAt) <= t)
          .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
        return { ok: true, label: `${plural(posts.length, "post")} on the calendar`, postIds: posts.map((p) => p.id), links: [...posts.slice(0, 5).map(postLink), { label: "Calendar", to: "/calendar" }], text: posts.map(postLine).join("\n") || "Nothing scheduled in that range." };
      },
    },
    // ----- instagram -----
    {
      name: "instagram_status",
      description: "Check whether the brand's Instagram is connected, plus followers/media count when it is.",
      input_schema: obj({ brandId: S.brandId }, ["brandId"]),
      run: async ({ brandId }) => {
        const b = brandOrThrow(brandId);
        if (!b.igConnected) return { ok: true, label: `${b.name}: Instagram not connected`, links: [{ label: "Connect Instagram", to: "/instagram" }], text: `Instagram is not connected for ${b.name}. Connect it on the Instagram page.` };
        let extra = "";
        try {
          const ins = await ig.getInsights(b.id);
          extra = ` Followers: ${ins.followers ?? "?"}, media: ${ins.mediaCount ?? "?"}.`;
        } catch (e: any) {
          extra = ` (Couldn't read insights: ${e.message})`;
        }
        return { ok: true, label: `${b.name}: Instagram connected`, links: [{ label: "Instagram", to: "/instagram" }], text: `Connected${ig.igUsername(b.id) ? ` as @${ig.igUsername(b.id)}` : ""}.${extra}` };
      },
    },
    {
      name: "connect_instagram_url",
      description: "Get the Instagram Login link for a brand. The user opens it and logs in themselves; never ask for passwords or tokens.",
      input_schema: obj({ brandId: S.brandId }, ["brandId"]),
      run: async ({ brandId }) => {
        const b = brandOrThrow(brandId);
        try {
          return { ok: true, label: "Instagram connect link", links: [{ label: "Instagram page", to: "/instagram" }], text: `Open this link and log in: ${ig.authUrl(b.id)}` };
        } catch (e: any) {
          return { ok: false, label: "Can't create connect link", links: [{ label: "Settings", to: "/settings" }, { label: "Instagram page", to: "/instagram" }], text: e.message };
        }
      },
    },
    // ----- automations -----
    {
      name: "list_automations",
      description: "List the brand's comment-keyword → reply + DM automations.",
      input_schema: obj({ brandId: S.brandId }, ["brandId"]),
      run: async ({ brandId }) => {
        const l = db.listAutomations(brandOrThrow(brandId).id);
        return { ok: true, label: `${plural(l.length, "automation")}`, links: [{ label: "Automations", to: "/automations" }], text: l.map((a) => `- ${a.id} “${a.keyword}” ${a.enabled ? "on" : "off"}: reply “${a.replyText}”, DM “${a.dmText}”${a.link ? ` ${a.link}` : ""}`).join("\n") || "No automations yet." };
      },
    },
    {
      name: "create_automation",
      description: "When someone comments the keyword on the brand's posts, reply publicly and DM them (with optional link).",
      input_schema: obj(
        { brandId: S.brandId, keyword: { type: "string" }, replyText: { type: "string" }, dmText: { type: "string" }, link: { type: "string" }, postId: { type: "string" }, enabled: { type: "boolean" } },
        ["brandId", "keyword"],
      ),
      run: async (a) => {
        const b = brandOrThrow(a.brandId);
        const keyword = str(a.keyword);
        if (!keyword) throw new ChatError(400, "keyword is required");
        const au: Automation = {
          id: nanoid(12),
          brandId: b.id,
          keyword,
          replyText: str(a.replyText) || "Sent you a DM! 📩",
          dmText: str(a.dmText) || `Thanks for commenting ${keyword.toUpperCase()}! ${a.link ? "Here's the link:" : ""}`.trim(),
          link: optStr(a.link),
          enabled: a.enabled !== false,
          postId: optStr(a.postId),
          createdAt: nowIso(),
        };
        db.saveAutomation(au);
        return { ok: true, label: `Automation “${au.keyword}” created`, brandId: b.id, links: [{ label: "Automations", to: "/automations" }], text: `When someone comments ${au.keyword}: reply “${au.replyText}”, DM “${au.dmText}”${au.link ? ` + ${au.link}` : ""}.` };
      },
    },
    {
      name: "delete_automation",
      description: "Delete a comment→DM automation by id. The user confirms with a button first.",
      input_schema: obj({ automationId: { type: "string" } }, ["automationId"]),
      sensitive: true,
      describe: (a) => `Delete automation “${db.getAutomation(String(a.automationId))?.keyword ?? a.automationId}”`,
      run: async ({ automationId }) => {
        const a = db.getAutomation(String(automationId));
        if (!a) throw new ChatError(404, "Automation not found");
        db.deleteAutomationRow(a.id);
        return { ok: true, label: `Deleted automation “${a.keyword}”`, links: [{ label: "Automations", to: "/automations" }], text: "Deleted." };
      },
    },
    {
      name: "get_comment_log",
      description: "Recent Instagram comments the automation poller has seen, with keyword matches and whether reply/DM were sent.",
      input_schema: obj({ brandId: S.brandId, limit: { type: "integer", minimum: 1, maximum: 200 } }, ["brandId"]),
      run: async ({ brandId, limit }) => {
        const l = db.listComments(brandOrThrow(brandId).id).slice(0, limit ?? 30);
        return { ok: true, label: `${plural(l.length, "comment")}`, links: [{ label: "Automations", to: "/automations" }], text: l.map((c) => `- @${c.username}: “${c.text}”${c.matchedKeyword ? ` → ${c.matchedKeyword} (reply ${c.replied ? "✓" : "✗"}, DM ${c.dmSent ? "✓" : "✗"})` : ""}`).join("\n") || "No comments logged yet." };
      },
    },
    {
      name: "app_status",
      description: "Overview: brands, post counts by status, render queue, next scheduled post, key/auto-publish settings.",
      input_schema: obj({ brandId: S.brandId }),
      run: async ({ brandId }) => ({ ok: true, label: "Checked status", links: [{ label: "Approve", to: "/approve" }, { label: "Calendar", to: "/calendar" }], text: appStatus(optStr(brandId)) }),
    },
  ];
  tools.push(...autopostChatTools()); // image posts + autopilot (chat-autopost.ts)
  tools.push(...etsyChatTools()); // etsy_import, etsy_list_listings, etsy_create_posts (etsy-chat.ts)
  tools.push(...clipsChatTools()); // clips_start_job, clips_job_status, clips_make_custom (clips-chat.ts)
  return tools;
}

export const SENSITIVE_TOOLS = new Set(buildTools().filter((t) => t.sensitive).map((t) => t.name));
export type { ToolCtx, ToolResult, ChatTool };
export type { PostStatus, PostType };
