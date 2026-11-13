// Autopilot: keeps each enabled brand's next `leadDays` filled with posts. When the upcoming schedule has fewer
// posts than the weekly target, it plans new ones (rotating content pillars, formats and timely occasions,
// avoiding duplicate topics) into free best-time slots and queues their renders through the normal single render
// queue, a couple at a time. approval "manual" (default) → posts land in "Waiting for your yes";
// approval "auto" (explicit opt-in) → approved automatically and published at their time when autoPublish is on.
import type { AutopilotDigest, AutopilotSettings, Brand, Post, PostType } from "../../shared/types.ts";
import { DEFAULT_BEST_TIMES, nowIso } from "./config.ts";
import { getBrand, getSettings, listBrands, listPosts, updateBrand, updatePost } from "./db.ts";
import { ensureBrain, parseSlot } from "./brain.ts";
import { nextSlots, takenSlots } from "./schedule.ts";
import { planPosts } from "./planner.ts";
import { enqueueRender, queueState } from "./render.ts";
import { upcomingOccasions, type Occasion } from "./occasions.ts";

export const FORMATS = ["reel", "carousel", "image", "story"] as const;
type Format = (typeof FORMATS)[number];

export const AUTOPILOT_DEFAULTS: AutopilotSettings = {
  enabled: false,
  postsPerWeek: { reel: 3, carousel: 1, image: 2, story: 0 },
  approval: "manual",
  leadDays: 7,
  occasions: true,
  render: true,
};
const MAX_PER_WEEK = 14;
const MAX_PER_RUN = 12;          // never create more than this in one run
const QUEUE_LOW_WATER = 2;       // only feed the render queue when it has fewer than this many waiting

export function autopilotOf(brand: Brand): AutopilotSettings {
  const a = brand.autopilot ?? ({} as Partial<AutopilotSettings>);
  return {
    ...AUTOPILOT_DEFAULTS,
    ...a,
    postsPerWeek: { ...AUTOPILOT_DEFAULTS.postsPerWeek, ...(a.postsPerWeek ?? {}) },
  };
}

const httpErr = (status: number, msg: string) => Object.assign(new Error(msg), { status });
const clampInt = (v: unknown, min: number, max: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
};

/** Validate + save a partial autopilot patch. approval "auto" needs acknowledgeAutoApprove: true. */
export function setAutopilot(brandId: string, patch: any): Brand {
  const brand = getBrand(brandId);
  if (!brand) throw httpErr(404, "Brand not found");
  const p = patch ?? {};
  if (p.approval !== undefined && p.approval !== "manual" && p.approval !== "auto") throw httpErr(400, 'approval must be "manual" or "auto"');
  if (p.approval === "auto" && autopilotOf(brand).approval !== "auto" && p.acknowledgeAutoApprove !== true)
    throw httpErr(400, 'approval "auto" publishes posts without your review. Send acknowledgeAutoApprove: true to confirm.');
  const cur = autopilotOf(brand);
  const next: AutopilotSettings = { ...cur };
  if (typeof p.enabled === "boolean") next.enabled = p.enabled;
  if (p.postsPerWeek && typeof p.postsPerWeek === "object") {
    for (const f of FORMATS) if (p.postsPerWeek[f] !== undefined) next.postsPerWeek[f] = clampInt(p.postsPerWeek[f], 0, MAX_PER_WEEK, cur.postsPerWeek[f]);
  }
  if (p.approval) next.approval = p.approval;
  if (p.leadDays !== undefined) next.leadDays = clampInt(p.leadDays, 1, 21, cur.leadDays);
  if (p.pillars !== undefined) next.pillars = Array.isArray(p.pillars) ? p.pillars.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 12) : undefined;
  if (typeof p.occasions === "boolean") next.occasions = p.occasions;
  if (typeof p.render === "boolean") next.render = p.render;
  const total = FORMATS.reduce((s, f) => s + next.postsPerWeek[f], 0);
  if (next.enabled && total === 0) throw httpErr(400, "Set at least one post per week before turning autopilot on");
  return updateBrand(brand.id, (b) => {
    b.autopilot = next;
  })!;
}

// ---------------------------------------------------------------- time helpers

function tz() {
  return getSettings().timezone;
}
function dayKey(iso: string | number | Date, zone = tz()): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: zone });
}
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/**
 * `count` free slots in (from, until]: the brand's best times first; if they run out, the same clock times on
 * every day, then a few sensible extra times — always picking the least-busy day so posts spread out.
 */
export function autopilotSlots(brand: Brand, count: number, from: Date, until: Date, busy: string[] = []): string[] {
  if (count <= 0) return [];
  const end = until.getTime();
  const taken = new Set([...takenSlots(brand.id), ...busy]);
  const best = brand.brain?.bestTimes?.length ? brand.brain.bestTimes : DEFAULT_BEST_TIMES;
  const out = nextSlots(best, count, from, taken).filter((t) => Date.parse(t) <= end);
  if (out.length >= count) return out.slice(0, count);
  const clock = [...new Set(best.map(parseSlot).filter(Boolean).map((s) => hhmm(s!.h, s!.m)))];
  const extraClock = ["10:00", "13:00", "19:00", "21:00"].filter((c) => !clock.includes(c));
  const perDay = new Map<string, number>();
  for (const t of [...taken].filter((t) => Date.parse(t) > from.getTime() && Date.parse(t) <= end)) perDay.set(dayKey(t), (perDay.get(dayKey(t)) ?? 0) + 1);
  for (const t of out) perDay.set(dayKey(t), (perDay.get(dayKey(t)) ?? 0) + 1);
  for (const times of [clock, extraClock]) {
    const ext = DOW.flatMap((d) => times.map((c) => `${d} ${c}`));
    const cands = nextSlots(ext, 7 * times.length * 3, from, new Set([...taken, ...out])).filter((t) => Date.parse(t) <= end);
    while (out.length < count && cands.length) {
      // least busy day first, then earliest
      cands.sort((a, b) => (perDay.get(dayKey(a)) ?? 0) - (perDay.get(dayKey(b)) ?? 0) || Date.parse(a) - Date.parse(b));
      const t = cands.shift()!;
      out.push(t);
      perDay.set(dayKey(t), (perDay.get(dayKey(t)) ?? 0) + 1);
    }
    if (out.length >= count) break;
  }
  return out.sort((a, b) => Date.parse(a) - Date.parse(b)).slice(0, count);
}

// ---------------------------------------------------------------- planning

export interface AutopilotPlanItem {
  type: Format;
  slot: string;
  pillar?: string;
  occasion?: { name: string; date: string; angle?: string };
}

export interface AutopilotStatus {
  windowStart: string;
  windowEnd: string;
  targets: Record<Format, number>;
  scheduled: Record<Format, number>;
  deficit: Record<Format, number>;
  occasions: Occasion[];
}

const ACTIVE = (p: Post) => !["failed", "posted", "publishing"].includes(p.status);

export function autopilotStatus(brand: Brand, now = new Date(), override: Partial<AutopilotSettings> = {}): AutopilotStatus {
  const ap = { ...autopilotOf(brand), ...override };
  const until = new Date(now.getTime() + ap.leadDays * 86400000);
  const upcoming = listPosts({ brandId: brand.id }).filter((p) => p.scheduledAt && ACTIVE(p) && Date.parse(p.scheduledAt) > now.getTime() && Date.parse(p.scheduledAt) <= until.getTime());
  const targets = {} as Record<Format, number>;
  const scheduled = {} as Record<Format, number>;
  const deficit = {} as Record<Format, number>;
  for (const f of FORMATS) {
    targets[f] = Math.round((ap.postsPerWeek[f] * ap.leadDays) / 7);
    scheduled[f] = upcoming.filter((p) => p.type === f).length;
    deficit[f] = Math.max(0, targets[f] - scheduled[f]);
  }
  const brain = ensureBrain(brand);
  const occasions = ap.occasions === false ? [] : upcomingOccasions(brain, now, until, brand.website);
  return { windowStart: now.toISOString(), windowEnd: until.toISOString(), targets, scheduled, deficit, occasions };
}

/** Interleave formats so a week reads reel, image, carousel, reel… instead of four reels in a row. */
function interleave(deficit: Record<Format, number>): Format[] {
  const left = { ...deficit };
  const total = FORMATS.reduce((s, f) => s + left[f], 0);
  const out: Format[] = [];
  const done: Record<string, number> = {};
  while (out.length < total) {
    let bestF: Format | undefined;
    let bestScore = -1;
    for (const f of FORMATS) {
      if (left[f] <= 0) continue;
      const score = left[f] / (deficit[f] || 1) - (out[out.length - 1] === f ? 0.5 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestF = f;
      }
    }
    if (!bestF) break;
    out.push(bestF);
    left[bestF]--;
    done[bestF] = (done[bestF] ?? 0) + 1;
  }
  return out;
}

export function planAutopilot(brand: Brand, now = new Date(), override: Partial<AutopilotSettings> = {}, maxPosts = MAX_PER_RUN): { items: AutopilotPlanItem[]; status: AutopilotStatus; pillarCursor: number } {
  const ap = { ...autopilotOf(brand), ...override };
  const status = autopilotStatus(brand, now, override);
  let formats = interleave(status.deficit).slice(0, maxPosts);
  const slots = autopilotSlots(brand, formats.length, now, new Date(status.windowEnd));
  formats = formats.slice(0, slots.length);
  const items: AutopilotPlanItem[] = formats.map((type, i) => ({ type, slot: slots[i] }));
  // occasions: one post per not-yet-covered occasion, in a slot inside its lead window (prefer an image post)
  const covered = new Set(listPosts({ brandId: brand.id }).map((p) => p.occasion).filter(Boolean) as string[]);
  for (const o of status.occasions) {
    if (covered.has(o.name)) continue;
    const endOfDay = Date.parse(`${o.date}T23:59:59Z`);
    const startWin = Date.parse(`${o.date}T00:00:00Z`) - (o.leadDays ?? 3) * 86400000;
    const fits = items.filter((it) => !it.occasion && it.type !== "story" && Date.parse(it.slot) >= startWin && Date.parse(it.slot) <= endOfDay);
    const it = fits.filter((x) => x.type === "image").pop() ?? fits.pop();
    if (it) it.occasion = { name: o.name, date: o.date, angle: o.angle };
  }
  // pillars rotate across the remaining items
  const brain = ensureBrain(brand);
  const pillars = (ap.pillars?.length ? ap.pillars : brain.contentPillars ?? []).filter(Boolean);
  let cursor = ap.pillarCursor ?? 0;
  if (pillars.length) for (const it of items) if (!it.occasion) it.pillar = pillars[cursor++ % pillars.length];
  return { items, status, pillarCursor: cursor };
}

// ---------------------------------------------------------------- run

export interface AutopilotRunResult {
  brandId: string;
  created: Post[];
  plan: AutopilotPlanItem[];
  status: AutopilotStatus;
  summary: string;
  dryRun: boolean;
}

const COUNT_KEY: Record<Format, "reels" | "carousels" | "images" | "stories"> = { reel: "reels", carousel: "carousels", image: "images", story: "stories" };
const label = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Feed autopilot drafts into the render queue, a couple at a time (renders stay staggered). */
export function feedRenderQueue(): number {
  const q = queueState();
  let room = Math.max(0, QUEUE_LOW_WATER - q.queued.length - (q.running ? 0 : 0));
  if (room <= 0) return 0;
  const now = Date.now();
  const drafts = listPosts({ status: "draft" })
    .filter((p) => p.autopilot && p.scheduledAt && Date.parse(p.scheduledAt) > now)
    .filter((p) => {
      const b = getBrand(p.brandId);
      return b && autopilotOf(b).enabled && autopilotOf(b).render !== false;
    })
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
  let n = 0;
  for (const p of drafts) {
    if (room-- <= 0) break;
    const auto = autopilotOf(getBrand(p.brandId)!).approval === "auto";
    enqueueRender(p.id);
    if (auto) updatePost(p.id, (x) => void (x.approvedPending = true));
    n++;
  }
  return n;
}

export async function runAutopilot(
  brandId: string,
  opts: { now?: Date; dryRun?: boolean; render?: boolean; leadDays?: number; force?: boolean; maxPosts?: number } = {},
): Promise<AutopilotRunResult> {
  const brand = getBrand(brandId);
  if (!brand) throw httpErr(404, "Brand not found");
  const ap = autopilotOf(brand);
  const now = opts.now ?? new Date();
  const override: Partial<AutopilotSettings> = opts.leadDays ? { leadDays: clampInt(opts.leadDays, 1, 21, ap.leadDays) } : {};
  const { items, status, pillarCursor } = planAutopilot(brand, now, override, opts.maxPosts ?? MAX_PER_RUN);
  if (opts.dryRun) {
    return { brandId, created: [], plan: items, status, dryRun: true, summary: items.length ? `Would make ${items.length} post(s)` : "Schedule is full — nothing to make" };
  }
  if (!ap.enabled && !opts.force) throw httpErr(409, "Autopilot is off for this brand");
  const created: Post[] = [];
  const recent = listPosts({ brandId }).slice(-80);
  const avoid = [...recent.map((p) => p.title), ...recent.map((p) => p.hook)].filter(Boolean);
  const errors: string[] = [];
  for (const it of items) {
    try {
      const counts = { reels: 0, carousels: 0, images: 0, stories: 0, [COUNT_KEY[it.type]]: 1 };
      const [p] = await planPosts(brand, {
        ...counts,
        slots: [it.slot],
        render: false,
        pillar: it.pillar,
        occasion: it.occasion,
        avoidTitles: avoid,
        extra: { autopilot: true, ...(it.pillar ? { pillar: it.pillar } : {}), ...(it.occasion ? { occasion: it.occasion.name } : {}) },
      });
      if (p) {
        created.push(p);
        avoid.push(p.title, p.hook);
      }
    } catch (e: any) {
      errors.push(`${it.type}: ${e?.message ?? e}`);
    }
  }
  const wantRender = opts.render ?? ap.render !== false;
  if (wantRender) feedRenderQueue();
  const byType: Record<string, number> = {};
  for (const p of created) byType[p.type] = (byType[p.type] ?? 0) + 1;
  const what = Object.entries(byType).map(([t, n]) => label(n, t)).join(", ");
  const summary = created.length
    ? `Made ${what} for the next ${override.leadDays ?? ap.leadDays} days${ap.approval === "auto" ? " (auto-approved)" : " — waiting for your yes"}${errors.length ? `; ${errors.length} failed` : ""}`
    : errors.length
      ? `Failed: ${errors.join("; ").slice(0, 300)}`
      : "Schedule is full — nothing to make";
  updateBrand(brandId, (b) => {
    b.autopilot = { ...autopilotOf(b), pillarCursor, lastRunAt: nowIso(), lastResult: summary };
  });
  if (created.length) console.log(`[autopilot] ${brand.name}: ${summary}`);
  return { brandId, created: created.map((p) => listPosts({ brandId }).find((x) => x.id === p.id) ?? p), plan: items, status, summary, dryRun: false };
}

// ---------------------------------------------------------------- worker

let busy = false;
export async function autopilotTick(now = new Date()) {
  if (busy) return;
  busy = true;
  try {
    for (const b of listBrands()) {
      const ap = autopilotOf(b);
      if (!ap.enabled) continue;
      try {
        const st = autopilotStatus(b, now);
        const missing = FORMATS.reduce((s, f) => s + st.deficit[f], 0);
        if (missing > 0) await runAutopilot(b.id, { now });
      } catch (e: any) {
        console.warn(`[autopilot] ${b.name}: ${e?.message ?? e}`);
      }
    }
    feedRenderQueue();
  } finally {
    busy = false;
  }
}

/** Started from workers.ts. Disable with AUTOPILOT=0; interval via AUTOPILOT_INTERVAL_MS (default 10 min). */
export function startAutopilot() {
  if (/^(0|false|off|no)$/i.test(process.env.AUTOPILOT ?? "")) return;
  const every = Math.max(30_000, Number(process.env.AUTOPILOT_INTERVAL_MS) || 10 * 60_000);
  const run = () => void autopilotTick().catch((e) => console.warn("[autopilot]", e?.message ?? e));
  setTimeout(run, 90_000).unref?.();
  setInterval(run, every).unref?.();
  // keep the render queue fed between planning runs (staggered renders)
  setInterval(() => {
    try {
      feedRenderQueue();
    } catch {
      /* ignore */
    }
  }, 60_000).unref?.();
}

// ---------------------------------------------------------------- digest

export function autopilotDigest(brandId?: string, now = new Date()): AutopilotDigest {
  const zone = tz();
  const today = dayKey(now, zone);
  const in7 = now.getTime() + 7 * 86400000;
  const brands = listBrands().filter((b) => !brandId || b.id === brandId);
  return {
    generatedAt: now.toISOString(),
    brands: brands.map((b) => {
      const ap = autopilotOf(b);
      const posts = listPosts({ brandId: b.id });
      const brain = ensureBrain(b);
      const upcoming = posts.filter((p) => p.scheduledAt && ACTIVE(p) && Date.parse(p.scheduledAt) > now.getTime() && Date.parse(p.scheduledAt) <= in7);
      return {
        brandId: b.id,
        brandName: b.name,
        enabled: ap.enabled,
        approval: ap.approval,
        lastRunAt: ap.lastRunAt,
        lastResult: ap.lastResult,
        target: FORMATS.reduce((s, f) => s + ap.postsPerWeek[f], 0),
        scheduledNext7: upcoming.length,
        madeToday: posts
          .filter((p) => p.autopilot && dayKey(p.createdAt, zone) === today)
          .map((p) => ({ id: p.id, title: p.title, type: p.type, status: p.status })),
        waiting: posts
          .filter((p) => p.status === "ready")
          .sort((a, c) => Date.parse(a.scheduledAt ?? a.createdAt) - Date.parse(c.scheduledAt ?? c.createdAt))
          .map((p) => ({ id: p.id, title: p.title, type: p.type, scheduledAt: p.scheduledAt, autopilot: !!p.autopilot })),
        scheduled: posts
          .filter((p) => p.status === "approved" && p.scheduledAt && Date.parse(p.scheduledAt) > now.getTime())
          .sort((a, c) => Date.parse(a.scheduledAt!) - Date.parse(c.scheduledAt!))
          .slice(0, 12)
          .map((p) => ({ id: p.id, title: p.title, type: p.type, scheduledAt: p.scheduledAt!, status: p.status })),
        upcomingOccasions: (ap.occasions === false ? [] : upcomingOccasions(brain, now, new Date(now.getTime() + 30 * 86400000), b.website)).map((o) => ({ name: o.name, date: o.date })),
      };
    }),
  };
}

export type { Format as AutopilotFormat };
export const formatOfType = (t: PostType): Format | undefined => (FORMATS as readonly string[]).includes(t) ? (t as Format) : undefined;
