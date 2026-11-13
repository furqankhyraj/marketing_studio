// Pinterest: generate pins into a publish queue; a separate publisher agent (Claude + Claude in Chrome, or anything
// that speaks HTTP / MCP) claims a due pin, uploads it on pinterest.com and reports the pin URL back.
// No Pinterest API access is required. Routes: registerPinterestRoutes(app) (see CONTRACTS.md "Pinterest").
//
// Sources:
//  - posts: approved / posted reels + stories become VIDEO pins (same MP4), image posts + carousels become image pins
//    (their first image).
//  - Etsy listings: fresh 1000x1500 image pins (renderer "PinImage": photo / collage / text layouts), rotating
//    listings and layouts so every listing gets several different pins over time (Pinterest rewards fresh pins).
// Lifecycle: rendering → ready (manual approval) | queued → claimed → published, or failed / skipped.
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Express, Request } from "express";
import type {
  Brand, BrandBrain, EtsyListing, MediaRef, PinClaim, PinImageSpec, PinLayout, PinStatus, PinterestPin, PinterestSettings, PinterestStatus, Post,
} from "../../shared/types.ts";
import * as db from "./db.ts";
import { RENDERS_DIR, fileUrlFor, localPathForUrl, nowIso } from "./config.ts";
import { brandStyleRef, ensureBrain } from "./brain.ts";
import { askJson, llmAvailable } from "./llm.ts";
import { loadRenderer } from "./engines.ts";
import { tzParts, zonedTime } from "./schedule.ts";
import { extractBenefits, formatPrice, listListings, productName, sentenceCase, shopFor } from "./etsy.ts";
import { smartLower } from "./hashtags.ts";

const httpErr = (status: number, msg: string) => Object.assign(new Error(msg), { status });
const LEASE_MIN = 30;
const MAX_ATTEMPTS = 3;
const OPEN: PinStatus[] = ["rendering", "ready", "queued", "claimed"];

// ================================================================ storage
db.db.exec(`
CREATE TABLE IF NOT EXISTS pins (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, status TEXT, scheduled_at TEXT, source_post_id TEXT, listing_id TEXT, data TEXT NOT NULL, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_pins_brand ON pins(brand_id);
CREATE INDEX IF NOT EXISTS idx_pins_status ON pins(status, scheduled_at);
`);

export function listPins(f: { brandId?: string; status?: string; limit?: number } = {}): PinterestPin[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.brandId) where.push("brand_id = ?"), args.push(f.brandId);
  if (f.status) {
    const st = f.status.split(",").map((s) => s.trim()).filter(Boolean);
    where.push(`status IN (${st.map(() => "?").join(",")})`);
    args.push(...st);
  }
  const sql = `SELECT data FROM pins ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(scheduled_at, created_at) ${f.limit ? `LIMIT ${Math.max(1, Math.min(500, f.limit))}` : ""}`;
  return (db.db.prepare(sql).all(...args) as { data: string }[]).map((r) => JSON.parse(r.data));
}
export function getPin(id: string): PinterestPin | undefined {
  const r = db.db.prepare("SELECT data FROM pins WHERE id = ?").get(id) as { data: string } | undefined;
  return r ? JSON.parse(r.data) : undefined;
}
function savePin(p: PinterestPin): PinterestPin {
  p.updatedAt = nowIso();
  db.db
    .prepare("INSERT OR REPLACE INTO pins(id, brand_id, status, scheduled_at, source_post_id, listing_id, data, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)")
    .run(p.id, p.brandId, p.status, p.scheduledAt ?? null, p.sourcePostId ?? null, p.etsyListingId ?? null, JSON.stringify(p), p.createdAt);
  return p;
}
function updatePin(id: string, fn: (p: PinterestPin) => void): PinterestPin {
  const p = getPin(id);
  if (!p) throw httpErr(404, "Pin not found");
  fn(p);
  return savePin(p);
}
export function deletePin(id: string) {
  const p = getPin(id);
  if (p?.spec) fs.rmSync(path.join(RENDERS_DIR, "pins", id), { recursive: true, force: true });
  db.db.prepare("DELETE FROM pins WHERE id = ?").run(id);
}

// ================================================================ settings
export function pinterestOf(b: Brand): PinterestSettings {
  const s = b.pinterest;
  return {
    enabled: s?.enabled ?? false,
    approval: s?.approval === "manual" ? "manual" : "auto",
    pinsPerDay: clampInt(s?.pinsPerDay, 1, 25, 5),
    leadDays: clampInt(s?.leadDays, 1, 14, 3),
    fromPosts: s?.fromPosts ?? true,
    fromEtsy: s?.fromEtsy ?? true,
    boards: Array.isArray(s?.boards) ? s!.boards : [],
    defaultBoard: s?.defaultBoard || undefined,
    account: s?.account || undefined,
    chromeProfile: s?.chromeProfile || undefined,
    activeHours: Array.isArray(s?.activeHours) && s!.activeHours.length === 2 ? s!.activeHours : [8, 22],
    design: s?.design === "persian" ? "persian" : "classic",
    lastRunAt: s?.lastRunAt,
    lastResult: s?.lastResult,
  };
}
function clampInt(v: unknown, lo: number, hi: number, d: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
}
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

export function setPinterest(brandId: string, body: any): PinterestSettings {
  const b = db.getBrand(brandId);
  if (!b) throw httpErr(404, "Brand not found");
  const cur = pinterestOf(b);
  const next: PinterestSettings = { ...cur };
  if (typeof body.enabled === "boolean") next.enabled = body.enabled;
  if (body.approval === "auto" || body.approval === "manual") next.approval = body.approval;
  if (body.pinsPerDay !== undefined) next.pinsPerDay = clampInt(body.pinsPerDay, 1, 25, cur.pinsPerDay);
  if (body.leadDays !== undefined) next.leadDays = clampInt(body.leadDays, 1, 14, cur.leadDays);
  if (typeof body.fromPosts === "boolean") next.fromPosts = body.fromPosts;
  if (typeof body.fromEtsy === "boolean") next.fromEtsy = body.fromEtsy;
  if (Array.isArray(body.boards))
    next.boards = body.boards
      .map((x: any) => ({
        name: str(x?.name, 100) ?? "",
        keywords: (Array.isArray(x?.keywords) ? x.keywords : String(x?.keywords ?? "").split(","))
          .map((k: any) => String(k).trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 30),
      }))
      .filter((x: any) => x.name)
      .slice(0, 50);
  if (body.design === "classic" || body.design === "persian") next.design = body.design;
  for (const k of ["defaultBoard", "account", "chromeProfile"] as const) if (body[k] !== undefined) next[k] = str(body[k], 120) || undefined;
  if (Array.isArray(body.activeHours) && body.activeHours.length === 2) {
    const a = clampInt(body.activeHours[0], 0, 23, 8);
    const z = clampInt(body.activeHours[1], 1, 24, 22);
    next.activeHours = a < z ? [a, z] : cur.activeHours;
  }
  db.updateBrand(brandId, (x) => void (x.pinterest = next));
  return next;
}

export function pinterestStatus(brandId: string): PinterestStatus {
  const b = db.getBrand(brandId);
  if (!b) throw httpErr(404, "Brand not found");
  const pins = listPins({ brandId });
  const counts = { rendering: 0, ready: 0, queued: 0, claimed: 0, published: 0, failed: 0, skipped: 0 } as Record<PinStatus, number>;
  for (const p of pins) counts[p.status] = (counts[p.status] ?? 0) + 1;
  const now = Date.now();
  const queued = pins.filter((p) => p.status === "queued").sort(bySched);
  const dayStart = now - 24 * 3600_000;
  return {
    settings: pinterestOf(b),
    counts,
    due: queued.filter((p) => !p.scheduledAt || Date.parse(p.scheduledAt) <= now).length,
    nextDueAt: queued.find((p) => p.scheduledAt && Date.parse(p.scheduledAt) > now)?.scheduledAt,
    publishedToday: pins.filter((p) => p.status === "published" && p.publishedAt && Date.parse(p.publishedAt) >= dayStart).length,
  };
}
const bySched = (a: PinterestPin, b: PinterestPin) => Date.parse(a.scheduledAt ?? a.createdAt) - Date.parse(b.scheduledAt ?? b.createdAt);

// ================================================================ scheduling
/** Next free publish slot: `pinsPerDay` slots spread evenly over the active hours (local timezone). */
function nextPinSlot(b: Brand, extraTaken: Set<number> = new Set()): string {
  const s = pinterestOf(b);
  const tz = db.getSettings().timezone;
  const [h0, h1] = s.activeHours!;
  const taken = new Set<number>(extraTaken);
  for (const p of listPins({ brandId: b.id })) if (p.scheduledAt && p.status !== "skipped" && p.status !== "failed") taken.add(Math.floor(Date.parse(p.scheduledAt) / 60000));
  const start = Date.now() + 5 * 60_000;
  for (let day = 0; day < 60; day++) {
    const d = tzParts(new Date(Date.now() + day * 86400_000), tz);
    for (let i = 0; i < s.pinsPerDay; i++) {
      const mins = Math.round((h0 + ((h1 - h0) * (i + 0.5)) / s.pinsPerDay) * 60);
      const t = zonedTime(d.y, d.mo, d.d, Math.floor(mins / 60), mins % 60, tz);
      const key = Math.floor(t.getTime() / 60000);
      if (t.getTime() < start || taken.has(key)) continue;
      return t.toISOString();
    }
  }
  return new Date(Date.now() + 86400_000).toISOString();
}

// ================================================================ copy
const DIGITAL = /\b(printable|digital|download|pdf|svg|template|instant|editable|canva)\b/i;

function cut(s: string, max: number): string {
  s = s.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/[\s,;:|–-]+\S*$/, "").trim() + "…";
}
/** Etsy-style "A | B | C" titles → the first segments that fit. */
function pinTitleFrom(title: string, max = 100): string {
  const parts = title.split(/\s*[|•·]\s*|\s+[–—-]\s+/).map((x) => x.trim()).filter(Boolean);
  let out = "";
  for (const p of parts) {
    const next = out ? `${out} – ${p}` : p;
    if (next.length > max) break;
    out = next;
  }
  return sentenceCase(out || cut(title, max));
}
const titleCase = (s: string) => s.replace(/\b([a-z])([a-z]*)/g, (_m, a: string, r: string) => (/^(and|or|for|the|a|an|of|to|in|on|with)$/.test(a + r) ? a + r : a.toUpperCase() + r));
function stripSocial(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/\b(comment|link in bio|dm me|follow for|save this|tag a friend|send this)\b/i.test(l))
    .join("\n")
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chooseBoard(s: PinterestSettings, brain: BrandBrain, b: Brand, text: string, hint?: string): string {
  const lower = text.toLowerCase();
  if (hint) {
    const exact = s.boards.find((x) => x.name.toLowerCase() === hint.toLowerCase());
    if (exact) return exact.name;
  }
  // The default board is the catch-all: a more specific board that matches at all wins over it.
  const hit = (k: string) => !!k && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(lower);
  const scored = s.boards
    .map((bd) => ({ name: bd.name, score: [bd.name.toLowerCase(), ...bd.keywords].reduce((n, k) => n + (hit(k) ? (k === bd.name.toLowerCase() ? 2 : 1) : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  const specific = scored.find((x) => x.name !== s.defaultBoard);
  if (specific) return specific.name;
  if (scored[0]) return scored[0].name;
  if (s.defaultBoard) return s.defaultBoard;
  if (s.boards[0]) return s.boards[0].name;
  if (hint) return cut(hint, 50);
  return cut(titleCase(brain.niche || `${b.name} ideas`), 50);
}

function withUtm(url: string | undefined, pinId: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", "pinterest");
    u.searchParams.set("utm_medium", "social");
    u.searchParams.set("utm_campaign", pinId);
    return u.toString();
  } catch {
    return url;
  }
}
const footerFor = (b: Brand) => {
  const shop = shopFor(b);
  if (shop) return `etsy.com/shop/${shop}`;
  try {
    return b.website ? new URL(/^https?:/.test(b.website) ? b.website : `https://${b.website}`).host.replace(/^www\./, "") : b.name;
  } catch {
    return b.name;
  }
};
const siteFor = (b: Brand) => (b.website ? (/^https?:/.test(b.website) ? b.website : `https://${b.website}`) : undefined);

interface PinCopy {
  title: string;
  description: string;
  altText: string;
  keywords: string[];
  board: string;
  overlayTitle?: string;
  subtitle?: string;
  badge?: string;
  bullets?: string[];
}

const PIN_SYSTEM = `You write Pinterest pin copy that ranks in Pinterest search (Pinterest is a visual search engine, not a social feed).
Return JSON {"title": string (<=100 chars, main keyword first, natural, no clickbait), "description": string (220-480 chars: 2-3 natural sentences that use 3-5 search phrases people type, say what it is, who it's for and the occasion/use, end with a soft call to action; NO hashtags, NO emoji spam, never "link in bio" or "comment"), "altText": string (<=300 chars: literally what the image shows), "keywords": string[] (5-8 lowercase search phrases), "board": string (pick one of the given boards when one fits, else suggest a short keyword board name), "overlayTitle": string (<=7 words, the big text ON the image), "subtitle": string (<=7 words, optional), "badge": string (<=3 words, optional, e.g. "INSTANT DOWNLOAD"), "bullets": string[] (0-3 items of <=6 words, only for text layouts)}.
Never invent prices, reviews or claims that aren't in the input.`;

async function llmCopy(input: object, fb: PinCopy, s: PinterestSettings, brain: BrandBrain, b: Brand): Promise<PinCopy> {
  if (!llmAvailable()) return fb;
  try {
    const r = await askJson<any>(PIN_SYSTEM, JSON.stringify({ ...input, boards: s.boards.map((x) => x.name), brand: { name: b.name, niche: brain.niche, audience: brain.audience, voice: brain.voice, avoid: brain.claimsToAvoid } }), 1500);
    const kw = Array.isArray(r?.keywords) ? r.keywords.map((k: any) => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 8) : fb.keywords;
    const text = `${r?.title ?? ""} ${r?.description ?? ""} ${kw.join(" ")}`;
    return {
      title: cut(str(r?.title, 200) || fb.title, 100),
      description: cut(str(r?.description, 800)?.replace(/#[\p{L}\p{N}_]+/gu, "") || fb.description, 500),
      altText: cut(str(r?.altText, 600) || fb.altText, 500),
      keywords: kw,
      board: chooseBoard(s, brain, b, text, str(r?.board, 100)),
      overlayTitle: cut(str(r?.overlayTitle, 80) || fb.overlayTitle || "", 60) || fb.overlayTitle,
      subtitle: str(r?.subtitle, 60) || fb.subtitle,
      badge: str(r?.badge, 30)?.toUpperCase() || fb.badge,
      bullets: Array.isArray(r?.bullets) && r.bullets.length ? r.bullets.map((x: any) => cut(String(x), 48)).slice(0, 3) : fb.bullets,
    };
  } catch (e: any) {
    console.warn("[pinterest] LLM copy failed, using templates:", e?.message ?? e);
    return fb;
  }
}

function listingCopy(b: Brand, brain: BrandBrain, s: PinterestSettings, l: EtsyListing, layout: PinLayout): PinCopy {
  const digital = DIGITAL.test(`${l.title} ${l.tags.join(" ")}`);
  const title = pinTitleFrom(l.title);
  const short = productName(l.title, 6);
  const benefits = extractBenefits(l, 3);
  const price = formatPrice(l.price, l.currency);
  const tags = [...new Set(l.tags.map((t) => t.toLowerCase().trim()).filter(Boolean))];
  const uses = tags.slice(0, 4).join(", ");
  const description = cut(
    [
      `${title}.`,
      benefits.length ? `${benefits.slice(0, 2).join(". ")}.` : "",
      digital ? "Instant digital download: print at home or at a print shop, no shipping and no waiting." : "",
      uses ? `Perfect for ${uses}.` : "",
      price ? `Just ${price} on Etsy.` : "",
      `Tap to see all the details in the ${b.name} shop.`,
    ]
      .filter(Boolean)
      .join(" "),
    500,
  );
  const subtitle = digital ? "Print at home in minutes" : price ? `Only ${price}` : undefined;
  return {
    title,
    description,
    altText: cut(`${layout === "collage" ? "Collage of photos showing" : layout === "text" ? "Graphic with text about" : "Photo of"} ${smartLower(short)} from ${b.name}${benefits[0] ? `: ${benefits[0].toLowerCase()}` : ""}`, 500),
    keywords: tags.slice(0, 8),
    board: chooseBoard(s, brain, b, `${l.title} ${tags.join(" ")}`),
    overlayTitle: titleCase(short),
    subtitle,
    badge: digital ? "INSTANT DOWNLOAD" : (l.listedAt && Date.now() - Date.parse(l.listedAt) < 30 * 86400_000 ? "NEW" : "HANDMADE"),
    bullets: benefits.filter((x) => !/what'?s inside|includes?:?$|:$|^\W*details/i.test(x)).map((x) => cut(x, 48)).slice(0, 3),
  };
}

function postCopy(b: Brand, brain: BrandBrain, s: PinterestSettings, p: Post): PinCopy {
  const caption = stripSocial(p.caption || "");
  const first = caption.split("\n").find((l) => l.trim().length > 10) ?? p.hook;
  const baseTitle = (p.title || "").replace(/\s*[—–-]\s*(reel|carousel|story|image( post)?|post)\s*$/i, "").trim();
  const title = cut(baseTitle.length > 12 ? baseTitle : p.hook || first || b.name, 100);
  const kws = [...new Set([...(p.hashtags ?? []).map((h) => smartLower(h.replace(/([a-z])([A-Z])/g, "$1 $2"))), ...(brain.keywords ?? []).slice(0, 4)])].slice(0, 8);
  const description = cut([caption.replace(/\n+/g, " "), kws.length ? `Ideas for ${kws.slice(0, 4).join(", ")}.` : ""].filter(Boolean).join(" "), 500);
  return {
    title,
    description: description || cut(`${title}. ${brain.summary}`, 500),
    altText: cut(p.type === "reel" || p.type === "story" ? `Short video: ${p.hook || title}` : `Graphic: ${p.hook || title}`, 500),
    keywords: kws,
    board: chooseBoard(s, brain, b, `${title} ${caption} ${kws.join(" ")}`),
  };
}

// ================================================================ create
function basePin(b: Brand, kind: "image" | "video", layout: PinLayout, c: PinCopy): PinterestPin {
  const t = nowIso();
  return {
    id: nanoid(12),
    brandId: b.id,
    kind,
    layout,
    status: "rendering",
    title: c.title,
    description: c.description,
    board: c.board,
    altText: c.altText,
    keywords: c.keywords,
    attempts: 0,
    createdAt: t,
    updatedAt: t,
  };
}
const afterReady = (b: Brand): PinStatus => (pinterestOf(b).approval === "manual" ? "ready" : "queued");

/** Turn an approved / posted post into a pin (video pins reuse the MP4; image posts / carousels use the first image). */
export async function createPinFromPost(postId: string, o: { force?: boolean } = {}): Promise<PinterestPin> {
  const p = db.getPost(postId);
  if (!p) throw httpErr(404, "Post not found");
  const b = db.getBrand(p.brandId)!;
  if (!p.mediaUrls?.length) throw httpErr(400, "Post has no rendered media yet");
  if (!o.force) {
    const existing = listPins({ brandId: b.id }).find((x) => x.sourcePostId === postId && x.status !== "skipped" && x.status !== "failed");
    if (existing) return existing;
  }
  const s = pinterestOf(b);
  const brain = ensureBrain(b);
  const video = p.type === "reel" || p.type === "story";
  const file = localPathForUrl(p.mediaUrls[0]);
  if (!file || !fs.existsSync(file)) throw httpErr(400, "Post media file is missing on disk");
  const fb = postCopy(b, brain, s, p);
  const c = await llmCopy({ kind: video ? "video pin" : "image pin", title: p.title, hook: p.hook, caption: p.caption, hashtags: p.hashtags }, fb, s, brain, b);
  const pin = basePin(b, video ? "video" : "image", video ? "video" : "post-image", c);
  pin.sourcePostId = p.id;
  pin.etsyListingId = p.etsyListingId;
  pin.mediaPath = file;
  pin.mediaUrl = p.mediaUrls[0];
  pin.thumbnailUrl = p.thumbnailUrl ?? (video ? undefined : p.mediaUrls[0]);
  const cover = p.coverUrl ?? p.thumbnailUrl;
  const coverPath = cover ? localPathForUrl(cover) : undefined;
  if (video && coverPath && fs.existsSync(coverPath)) pin.coverPath = coverPath;
  pin.link = withUtm(p.etsyLink ?? siteFor(b), pin.id);
  // a post you haven't approved yet never goes straight to the publish queue
  pin.status = p.status === "approved" || p.status === "posted" ? afterReady(b) : "ready";
  pin.scheduledAt = nextPinSlot(b);
  return savePin(pin);
}

/** Fresh 2:3 image pin for an Etsy listing. Layout rotates photo → collage → text per listing unless given. */
export async function createPinFromListing(brandId: string, listingId: string, o: { layout?: "photo" | "collage" | "text" | "persian" } = {}): Promise<PinterestPin> {
  const b = db.getBrand(brandId);
  if (!b) throw httpErr(404, "Brand not found");
  const l = listListings(brandId).find((x) => x.listingId === listingId);
  if (!l) throw httpErr(404, `Listing ${listingId} not found (import the shop first)`);
  const s = pinterestOf(b);
  const brain = ensureBrain(b);
  const photos: MediaRef[] = l.imageAssetIds
    .map((id) => db.getAsset(id))
    .filter((a) => !!a && a.kind === "image" && fs.existsSync(a.path))
    .map((a) => ({ src: a!.url, kind: "image" as const }));
  const done = listPins({ brandId }).filter((x) => x.etsyListingId === listingId && x.layout !== "video").length;
  const cycle: ("photo" | "collage" | "text")[] = new Set(photos.map((p) => p.src)).size >= 2 ? ["photo", "collage", "text"] : ["photo", "text"];
  const layout: "photo" | "collage" | "text" | "persian" = o.layout ?? (s.design === "persian" ? "persian" : cycle[done % cycle.length]);
  const PERSIAN = ["mihrab", "toranj", "tazhib", "kashi", "shab"];
  const fb = listingCopy(b, brain, s, l, layout === "persian" ? "photo" : layout);
  const c = await llmCopy(
    { kind: `image pin (${layout} layout)`, listing: { title: l.title, description: l.description.slice(0, 1500), tags: l.tags, price: formatPrice(l.price, l.currency), reviews: l.reviews.slice(0, 2).map((r) => r.text) } },
    fb,
    s,
    brain,
    b,
  );
  const pin = basePin(b, "image", layout, c);
  pin.etsyListingId = listingId;
  pin.link = withUtm(l.url, pin.id);
  const start = photos.length ? done % photos.length : 0;
  const rotated = photos.length ? [...photos.slice(start), ...photos.slice(0, start)] : [];
  pin.spec = {
    kind: "pin",
    width: 1000,
    height: 1500,
    layout,
    ...(layout === "persian" ? { variant: PERSIAN[done % PERSIAN.length] } : {}),
    brand: brandStyleRef(b),
    title: c.overlayTitle || fb.overlayTitle || c.title,
    subtitle: c.subtitle,
    badge: c.badge,
    price: layout === "text" ? undefined : formatPrice(l.price, l.currency),
    bullets: layout === "text" || layout === "persian" ? c.bullets : undefined,
    footer: footerFor(b),
    photos: rotated.slice(0, layout === "collage" ? 3 : 1),
  };
  savePin(pin);
  enqueuePinRender(pin.id);
  return pin;
}

// ================================================================ render queue (serial)
const renderQueue: string[] = [];
let rendering = false;
export function enqueuePinRender(id: string) {
  if (!renderQueue.includes(id)) renderQueue.push(id);
  void drain();
}
async function drain() {
  if (rendering) return;
  rendering = true;
  try {
    while (renderQueue.length) {
      const id = renderQueue.shift()!;
      const pin = getPin(id);
      if (!pin?.spec) continue;
      try {
        const r: any = await loadRenderer();
        if (typeof r.renderPinImage !== "function") throw new Error("renderer has no renderPinImage (update renderer/)");
        const outDir = path.join(RENDERS_DIR, "pins", id);
        const res = await r.renderPinImage(pin.spec, outDir);
        const b = db.getBrand(pin.brandId)!;
        const v = Date.now();
        updatePin(id, (x) => {
          x.mediaPath = res.imagePath;
          x.mediaUrl = `${fileUrlFor(res.imagePath)}?v=${v}`;
          x.thumbnailUrl = `${fileUrlFor(res.thumbnailPath)}?v=${v}`;
          x.error = undefined;
          if (x.status === "rendering") {
            x.status = afterReady(b);
            x.scheduledAt ??= nextPinSlot(b);
          }
        });
      } catch (e: any) {
        console.warn(`[pinterest] render ${id} failed: ${e?.message ?? e}`);
        updatePin(id, (x) => {
          x.status = "failed";
          x.error = `Render failed: ${e?.message ?? e}`;
        });
      }
    }
  } finally {
    rendering = false;
  }
}

// ================================================================ publisher agent: claim / report
export const PUBLISHER_INSTRUCTIONS = `You are the Pinterest publisher for Social MCP Studio. Work one pin at a time.
1. Claim: call pinterest_claim_next (MCP) or POST http://localhost:4300/api/pinterest/claim {"agent":"<your name>"}. Nothing returned = nothing is due; stop.
2. Open Chrome in the profile that is signed in to the brand's Pinterest account (claim.chromeProfile / claim.account). Never sign in, change account settings, or accept new terms yourself; if Pinterest asks you to sign in, release the pin (step 6) and tell the user.
3. Go to https://www.pinterest.com/pin-creation-tool/ and upload the file at pin.mediaPath (a JPEG or an MP4; use the browser's file-upload tool with that absolute path). For a video pin, if pin.coverPath is set you may pick that frame/cover; otherwise keep Pinterest's default.
4. Fill in exactly: Title = pin.title, Description = pin.description, Link = pin.link (leave empty if none), Board = pin.board (pick it; if it does not exist choose "Create board" with that exact name, public), Alt text = pin.altText (under "More options"). Optionally add up to 3 tagged topics that match pin.keywords. Do not add hashtags.
5. Click Publish. Open the new pin and copy its URL (https://www.pinterest.com/pin/<id>/). Then call pinterest_mark_published {pinId, pinUrl} (or POST /api/pinterest/pins/<id>/published {"pinUrl"}).
6. If something goes wrong (upload rejected, page changed, not signed in): call pinterest_mark_failed {pinId, error, retry:true} for temporary problems or retry:false for permanent ones, or pinterest_release {pinId} to hand it back untouched. A claim expires by itself after ${LEASE_MIN} minutes.
7. Repeat from step 1 until nothing is due (at most 10 pins per run, and wait at least 1 minute between pins so the account looks natural).`;

function releaseExpired() {
  const now = Date.now();
  for (const p of listPins({ status: "claimed" }))
    if (p.claimExpiresAt && Date.parse(p.claimExpiresAt) < now)
      updatePin(p.id, (x) => {
        x.status = "queued";
        x.claimedAt = x.claimedBy = x.claimExpiresAt = undefined;
        x.error = "Claim expired (the publisher did not report back) — back in the queue";
      });
}

export function claimNext(o: { brandId?: string; agent?: string; any?: boolean } = {}): PinClaim | null {
  releaseExpired();
  const now = Date.now();
  const enabled = new Set(db.listBrands().filter((b) => pinterestOf(b).enabled).map((b) => b.id)); // Pinterest switched off = nothing is handed out
  const pin = listPins({ brandId: o.brandId, status: "queued" })
    .filter((p) => enabled.has(p.brandId))
    .filter((p) => (o.any || !p.scheduledAt || Date.parse(p.scheduledAt) <= now) && p.mediaPath && fs.existsSync(p.mediaPath))
    .sort(bySched)[0];
  if (!pin) return null;
  const claimed = updatePin(pin.id, (x) => {
    x.status = "claimed";
    x.claimedAt = nowIso();
    x.claimedBy = str(o.agent, 60) || "agent";
    x.claimExpiresAt = new Date(now + LEASE_MIN * 60_000).toISOString();
    x.attempts += 1;
  });
  const b = db.getBrand(pin.brandId)!;
  const s = pinterestOf(b);
  return { pin: claimed, brandName: b.name, account: s.account, chromeProfile: s.chromeProfile, instructions: PUBLISHER_INSTRUCTIONS };
}

export function markPublished(id: string, pinUrl: string): PinterestPin {
  const url = str(pinUrl, 300) ?? "";
  if (!/^https:\/\/([a-z]+\.)?pinterest\.[a-z.]+\/pin\/[\w-]+/i.test(url) && !/^https:\/\/pin\.it\//i.test(url)) throw httpErr(400, "pinUrl must be a Pinterest pin URL (https://www.pinterest.com/pin/<id>/)");
  return updatePin(id, (x) => {
    if (x.status === "published") return;
    x.status = "published";
    x.pinUrl = url;
    x.publishedAt = nowIso();
    x.error = undefined;
    x.claimExpiresAt = undefined;
  });
}

export function markFailed(id: string, error: string, retry = true): PinterestPin {
  return updatePin(id, (x) => {
    x.error = str(error, 500) || "Publish failed";
    x.claimedAt = x.claimedBy = x.claimExpiresAt = undefined;
    if (retry && x.attempts < MAX_ATTEMPTS) {
      x.status = "queued";
      x.scheduledAt = new Date(Date.now() + 30 * 60_000).toISOString();
    } else x.status = "failed";
  });
}

export function releasePin(id: string): PinterestPin {
  return updatePin(id, (x) => {
    if (x.status !== "claimed") return;
    x.status = "queued";
    x.attempts = Math.max(0, x.attempts - 1);
    x.claimedAt = x.claimedBy = x.claimExpiresAt = undefined;
  });
}

// ================================================================ worker
let busy = false;
/** Fill the queue for one brand: pins for new approved posts, then fresh Etsy listing pins up to pinsPerDay × leadDays. */
export async function runPinterest(brandId: string, o: { force?: boolean } = {}): Promise<{ created: PinterestPin[]; summary: string }> {
  const b = db.getBrand(brandId);
  if (!b) throw httpErr(404, "Brand not found");
  const s = pinterestOf(b);
  const created: PinterestPin[] = [];
  const notes: string[] = [];
  if (!s.enabled && !o.force) return { created, summary: "Pinterest is off for this brand" };
  const pins = listPins({ brandId });
  if (s.fromPosts) {
    const have = new Set(pins.map((p) => p.sourcePostId).filter(Boolean));
    const posts = db
      .listPosts({ brandId })
      .filter((p) => (p.status === "approved" || p.status === "posted") && p.mediaUrls?.length && !have.has(p.id))
      .slice(0, 6);
    for (const p of posts) {
      try {
        created.push(await createPinFromPost(p.id));
      } catch (e: any) {
        notes.push(`post ${p.id}: ${e?.message}`);
      }
    }
  }
  if (s.fromEtsy) {
    const listings = listListings(brandId).filter((l) => l.imageAssetIds.length || l.title);
    const open = listPins({ brandId, status: OPEN.join(",") }).length;
    const want = Math.min(8, s.pinsPerDay * s.leadDays - open);
    if (listings.length && want > 0) {
      const all = listPins({ brandId });
      const stats = new Map(listings.map((l) => [l.listingId, { n: 0, last: 0 }]));
      for (const p of all)
        if (p.etsyListingId && stats.has(p.etsyListingId) && p.status !== "skipped") {
          const st = stats.get(p.etsyListingId)!;
          st.n++;
          st.last = Math.max(st.last, Date.parse(p.createdAt));
        }
      for (let i = 0; i < want; i++) {
        const ranked = [...listings].sort((a, z) => {
          const A = stats.get(a.listingId)!;
          const Z = stats.get(z.listingId)!;
          return A.n - Z.n || A.last - Z.last;
        });
        const l = ranked[0];
        try {
          created.push(await createPinFromListing(brandId, l.listingId));
          const st = stats.get(l.listingId)!;
          st.n++;
          st.last = Date.now();
        } catch (e: any) {
          notes.push(`listing ${l.listingId}: ${e?.message}`);
          break;
        }
      }
    } else if (!listings.length) notes.push("no Etsy listings imported");
  }
  const summary = `${created.length} pin(s) created${notes.length ? ` · ${notes.slice(0, 3).join("; ")}` : ""}`;
  db.updateBrand(brandId, (x) => {
    x.pinterest = { ...pinterestOf(x), lastRunAt: nowIso(), lastResult: summary };
  });
  return { created, summary };
}

export async function pinterestTick() {
  if (busy) return;
  busy = true;
  try {
    releaseExpired();
    for (const b of db.listBrands()) {
      if (!pinterestOf(b).enabled) continue;
      try {
        const r = await runPinterest(b.id);
        if (r.created.length) console.log(`[pinterest] ${b.name}: ${r.summary}`);
      } catch (e: any) {
        console.warn(`[pinterest] ${b.name}: ${e?.message ?? e}`);
      }
    }
  } finally {
    busy = false;
  }
}

export function startPinterestWorker() {
  const safe = () => pinterestTick().catch((e) => console.warn("[pinterest]", e?.message ?? e));
  setTimeout(safe, 40_000);
  setInterval(safe, 15 * 60_000);
  // resume renders interrupted by a restart
  for (const p of listPins({ status: "rendering" })) enqueuePinRender(p.id);
}

// ================================================================ routes
export function registerPinterestRoutes(app: Express) {
  const brandId = (req: Request) => {
    const id = String(req.params.id);
    if (!db.getBrand(id)) throw httpErr(404, "Brand not found");
    return id;
  };
  const pinId = (req: Request) => String(req.params.pinId);

  app.get("/api/brands/:id/pinterest", (req, res) => res.json(pinterestStatus(brandId(req))));
  const saveSettings = (req: Request, res: any) => {
    setPinterest(brandId(req), req.body ?? {});
    res.json(pinterestStatus(brandId(req)));
  };
  app.put("/api/brands/:id/pinterest", saveSettings);
  app.patch("/api/brands/:id/pinterest", saveSettings);
  app.post("/api/brands/:id/pinterest/run", async (req, res) => res.json(await runPinterest(brandId(req), { force: true })));
  app.post("/api/brands/:id/pinterest/pins", async (req, res) => {
    const id = brandId(req);
    const body = req.body ?? {};
    if (body.postId) return res.json({ pins: [await createPinFromPost(String(body.postId), { force: !!body.force })] });
    if (body.listingId) {
      const layout = ["photo", "collage", "text", "persian"].includes(body.layout) ? body.layout : undefined;
      return res.json({ pins: [await createPinFromListing(id, String(body.listingId), { layout })] });
    }
    throw httpErr(400, "Give postId or listingId");
  });

  app.get("/api/pinterest/pins", (req, res) =>
    res.json(listPins({ brandId: str(req.query.brandId, 40) || undefined, status: str(req.query.status, 100) || undefined, limit: Number(req.query.limit) || undefined })),
  );
  app.get("/api/pinterest/instructions", (_req, res) => res.json({ instructions: PUBLISHER_INSTRUCTIONS }));
  app.get("/api/pinterest/pins/:pinId", (req, res) => {
    const p = getPin(pinId(req));
    if (!p) throw httpErr(404, "Pin not found");
    res.json(p);
  });
  app.patch("/api/pinterest/pins/:pinId", (req, res) => {
    const b = req.body ?? {};
    const p = updatePin(pinId(req), (x) => {
      if (b.title !== undefined) x.title = cut(String(b.title), 100);
      if (b.description !== undefined) x.description = cut(String(b.description), 500);
      if (b.altText !== undefined) x.altText = cut(String(b.altText), 500);
      if (b.board !== undefined) x.board = cut(String(b.board), 100) || x.board;
      if (b.link !== undefined) x.link = str(b.link, 1000) || undefined;
      if (b.scheduledAt !== undefined) {
        const t = Date.parse(String(b.scheduledAt));
        if (b.scheduledAt && isNaN(t)) throw httpErr(400, "Invalid scheduledAt");
        x.scheduledAt = b.scheduledAt ? new Date(t).toISOString() : undefined;
      }
      if (b.spec && x.spec) {
        x.spec = { ...x.spec, ...b.spec, kind: "pin", width: 1000, height: 1500 } as PinImageSpec;
        if (x.status !== "published") x.status = "rendering";
      }
    });
    if (p.status === "rendering") enqueuePinRender(p.id);
    res.json(p);
  });
  app.post("/api/pinterest/pins/:pinId/approve", (req, res) =>
    res.json(
      updatePin(pinId(req), (x) => {
        if (x.status === "ready" || x.status === "failed" || x.status === "skipped") {
          x.status = x.mediaPath ? "queued" : "rendering";
          x.error = undefined;
          x.attempts = 0;
          if (!x.scheduledAt || Date.parse(x.scheduledAt) < Date.now()) x.scheduledAt = nextPinSlot(db.getBrand(x.brandId)!);
        }
      }),
    ),
  );
  app.post("/api/pinterest/pins/:pinId/skip", (req, res) => res.json(updatePin(pinId(req), (x) => void (x.status !== "published" && (x.status = "skipped")))));
  app.post("/api/pinterest/pins/:pinId/rerender", (req, res) => {
    const p = updatePin(pinId(req), (x) => {
      if (!x.spec) throw httpErr(400, "Only image pins made by the app can be re-rendered");
      x.status = "rendering";
    });
    enqueuePinRender(p.id);
    res.json(p);
  });
  app.delete("/api/pinterest/pins/:pinId", (req, res) => {
    deletePin(pinId(req));
    res.json({ ok: true });
  });

  // publisher agent
  app.post("/api/pinterest/claim", (req, res) => {
    const b = req.body ?? {};
    const c = claimNext({ brandId: str(b.brandId, 40) || undefined, agent: str(b.agent, 60), any: !!b.any });
    if (!c) {
      const next = listPins({ brandId: str(b.brandId, 40) || undefined, status: "queued" }).sort(bySched)[0];
      const on = db.listBrands().filter((x) => pinterestOf(x).enabled);
      if (!on.length) return res.json({ pin: null, message: "Pinterest is switched off for every brand (dashboard → Pinterest → On). Nothing to publish." });
      return res.json({ pin: null, message: next ? `Nothing due. Next pin is due at ${next.scheduledAt}.` : "Nothing in the queue." });
    }
    res.json(c);
  });
  app.post("/api/pinterest/pins/:pinId/published", (req, res) => res.json(markPublished(pinId(req), String(req.body?.pinUrl ?? ""))));
  app.post("/api/pinterest/pins/:pinId/failed", (req, res) => res.json(markFailed(pinId(req), String(req.body?.error ?? ""), req.body?.retry !== false)));
  app.post("/api/pinterest/pins/:pinId/release", (req, res) => res.json(releasePin(pinId(req))));
}
