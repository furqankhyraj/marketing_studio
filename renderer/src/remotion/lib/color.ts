// Color helpers: parsing, mixing and contrast enforcement so text stays readable for any brand palette.
import type { BrandColors } from "../../../../shared/types.ts";

export type RGB = [number, number, number];

export function parseColor(input: string | undefined, fallback: RGB = [0, 0, 0]): RGB {
  if (!input) return fallback;
  let s = input.trim().toLowerCase();
  const rgbM = s.match(/^rgba?\(([^)]+)\)$/);
  if (rgbM) {
    const p = rgbM[1].split(/[ ,/]+/).filter(Boolean).map((x) => parseFloat(x));
    if (p.length >= 3 && p.slice(0, 3).every((n) => Number.isFinite(n))) return [p[0], p[1], p[2]].map(clamp255) as RGB;
    return fallback;
  }
  if (s.startsWith("#")) s = s.slice(1);
  if (/^[0-9a-f]{3,4}$/.test(s)) s = s.slice(0, 3).split("").map((c) => c + c).join("");
  if (/^[0-9a-f]{8}$/.test(s)) s = s.slice(0, 6);
  if (!/^[0-9a-f]{6}$/.test(s)) return fallback;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function hex(c: RGB): string {
  return "#" + c.map((n) => clamp255(n).toString(16).padStart(2, "0")).join("");
}

export function rgba(color: string, alpha: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function mix(a: string, b: string, t: number): string {
  const A = parseColor(a);
  const B = parseColor(b);
  return hex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

export const darken = (c: string, t: number) => mix(c, "#000000", t);
export const lighten = (c: string, t: number) => mix(c, "#ffffff", t);

export function luminance(c: string): number {
  const ch = parseColor(c).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const isDark = (c: string) => luminance(c) < 0.22;

/** Pick the candidate with the best contrast on bg; if none reaches `min`, fall back to white/black. */
export function readable(bg: string, candidates: string[] = [], min = 4.5): string {
  let best = "";
  let bestC = 0;
  for (const c of candidates) {
    if (!c) continue;
    const k = contrast(c, bg);
    if (k >= min) return hex(parseColor(c));
    if (k > bestC) {
      bestC = k;
      best = c;
    }
  }
  const w = contrast("#ffffff", bg);
  const bl = contrast("#111111", bg);
  if (best && bestC >= Math.max(w, bl)) return hex(parseColor(best));
  return w >= bl ? "#ffffff" : "#111111";
}

/** Nudge fg lighter/darker until it reaches the requested contrast on bg (keeps hue where possible). */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrast(fg, bg) >= min) return hex(parseColor(fg));
  const towards = isDark(bg) ? "#ffffff" : "#000000";
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const c = mix(fg, towards, t);
    if (contrast(c, bg) >= min) return c;
  }
  return towards;
}

/** Saturation-ish measure 0..1, used to decide whether a brand color is "colorful" enough to use as a fill. */
export function chroma(c: string): number {
  const [r, g, b] = parseColor(c);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  onPrimary: string;
  onSecondary: string;
  onAccent: string;
  onBackground: string;
  /** a vivid color guaranteed visible on background */
  pop: string;
  /** a deep version of primary, good for dark backgrounds */
  deep: string;
  /** a pale version of primary/background, good for light backgrounds */
  pale: string;
}

export function makePalette(colors: Partial<BrandColors> | undefined): Palette {
  const primary = hex(parseColor(colors?.primary, [30, 58, 138]));
  const secondary = hex(parseColor(colors?.secondary, parseColor(lighten(primary, 0.35))));
  const accent = hex(parseColor(colors?.accent, [245, 158, 11]));
  const background = hex(parseColor(colors?.background, [250, 247, 242]));
  const text = hex(parseColor(colors?.text, isDark(background) ? [255, 255, 255] : [17, 17, 17]));
  const vivid = [accent, primary, secondary].sort((a, b) => chroma(b) - chroma(a));
  const pop = ensureContrast(vivid.find((c) => contrast(c, background) >= 2.2) ?? vivid[0], background, 2.2);
  return {
    primary,
    secondary,
    accent,
    background,
    text,
    onPrimary: readable(primary, [text, background, "#ffffff"]),
    onSecondary: readable(secondary, [text, background, "#ffffff"]),
    onAccent: readable(accent, ["#111111", "#ffffff", text]),
    onBackground: ensureContrast(text, background, 4.5),
    pop,
    deep: isDark(primary) ? darken(primary, 0.25) : darken(primary, 0.72),
    pale: isDark(background) ? lighten(primary, 0.88) : mix(background, primary, 0.06),
  };
}
