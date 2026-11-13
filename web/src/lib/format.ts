import type { PostStatus } from "./types";

/** Rewrite absolute server URLs (http://localhost:4300/files/...) to relative paths so the Vite proxy serves them. */
export function mediaUrl(u?: string): string | undefined {
  if (!u) return u;
  return u.replace(/^https?:\/\/(localhost|127\.0\.0\.1):4300(?=\/)/, "");
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return "Not scheduled";
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function fmtTime(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function relTime(iso: string): string {
  const s = (Date.now() - +new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** ISO -> value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(+d) ? undefined : d.toISOString();
}

export const STATUS_META: Record<PostStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "gray" },
  rendering: { label: "Rendering", tone: "sky" },
  ready: { label: "Waiting for your yes", tone: "amber" },
  changes_requested: { label: "Being remade", tone: "violet" },
  approved: { label: "Approved", tone: "blue" },
  publishing: { label: "Publishing", tone: "sky" },
  posted: { label: "Posted", tone: "green" },
  failed: { label: "Failed", tone: "red" },
};

export type Tone = "gray" | "sky" | "amber" | "violet" | "blue" | "green" | "red" | "pink";

export const TONE_CLASSES: Record<Tone, string> = {
  gray: "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  sky: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-900",
  amber: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900",
  violet: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-900",
  blue: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:ring-blue-900",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900",
  red: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900",
  pink: "bg-pink-50 text-pink-700 ring-pink-200 dark:bg-pink-950/60 dark:text-pink-300 dark:ring-pink-900",
};

/** Solid color for calendar chips. */
export const STATUS_CHIP: Record<PostStatus, string> = {
  posted: "bg-emerald-500 text-white",
  approved: "bg-blue-500 text-white",
  publishing: "bg-sky-500 text-white",
  ready: "bg-amber-400 text-amber-950",
  changes_requested: "bg-violet-400 text-white",
  rendering: "bg-sky-300 text-sky-950",
  draft: "bg-zinc-300 text-zinc-800 dark:bg-zinc-600 dark:text-zinc-100",
  failed: "bg-rose-500 text-white",
};

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

/** Deterministic gradient for things without a preview. */
export function hashGradient(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = h % 360;
  const b = (a + 40 + (h % 80)) % 360;
  return `linear-gradient(135deg, hsl(${a} 80% 55%), hsl(${b} 85% 45%))`;
}

export function isReelType(t: string) {
  return t === "reel" || t === "story";
}
