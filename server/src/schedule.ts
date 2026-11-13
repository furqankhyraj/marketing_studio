// Best-time slot computation in the user's timezone (no external tz library; uses Intl).
import { parseSlot } from "./brain.ts";
import { DEFAULT_BEST_TIMES } from "./config.ts";
import { getSettings, listPosts } from "./db.ts";
import type { Brand } from "../../shared/types.ts";

export function tzParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd: p.weekday };
}

/** Convert a wall-clock time in `tz` to a UTC Date. */
export function zonedTime(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = tzParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    const diff = asUtc - Date.UTC(y, mo - 1, d, h, mi);
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

/** Next `count` best-time slots after `from`, skipping times already taken by `taken` (ISO strings). */
export function nextSlots(bestTimes: string[] | undefined, count: number, from: Date, taken: Set<string>): string[] {
  const tz = getSettings().timezone;
  const slots = (bestTimes?.length ? bestTimes : DEFAULT_BEST_TIMES).map(parseSlot).filter(Boolean) as {
    dow: number;
    h: number;
    m: number;
  }[];
  const out: string[] = [];
  const takenMin = new Set([...taken].map((t) => Math.floor(new Date(t).getTime() / 60000)));
  const start = from.getTime() + 5 * 60 * 1000; // at least 5 min out
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let day = 0; day < 120 && out.length < count; day++) {
    const p = tzParts(new Date(from.getTime() + day * 86400000), tz);
    const dow = DOW.indexOf(p.wd);
    const todays = slots.filter((s) => s.dow === dow).sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
    for (const s of todays) {
      const t = zonedTime(p.y, p.mo, p.d, s.h, s.m, tz);
      const key = Math.floor(t.getTime() / 60000);
      if (t.getTime() < start || takenMin.has(key)) continue;
      takenMin.add(key);
      out.push(t.toISOString());
      if (out.length >= count) break;
    }
  }
  return out;
}

export function takenSlots(brandId: string): Set<string> {
  return new Set(
    listPosts({ brandId })
      .filter((p) => p.scheduledAt)
      .map((p) => p.scheduledAt!),
  );
}

export function nextSlotForBrand(brand: Brand, from = new Date()): string {
  return nextSlots(brand.brain?.bestTimes, 1, from, takenSlots(brand.id))[0] ?? new Date(from.getTime() + 86400000).toISOString();
}
