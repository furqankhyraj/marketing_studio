// Heuristic text fitting (no DOM measuring needed, deterministic across frames).
import type React from "react";

// ---- Urdu / RTL ----
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
/** True when the text contains Arabic-script (Urdu) letters. */
export const isUrdu = (text: string | undefined | null): boolean => ARABIC_SCRIPT.test(text ?? "");
/** Nastaliq needs tall lines: its stacked letters and dots overlap the next line below ~1.9. */
export const URDU_LINE_HEIGHT = 2.3;
/** Arabic posts (spec.language "ar") use Naskh, which needs far less line height than Nastaliq. Set by loadUrduFonts. */
let arabicMode = false;
export function setArabicMode(v: boolean) {
  arabicMode = v;
}
export const isArabicMode = () => arabicMode;
/** Arabic vs Urdu from the letters themselves (for specs without a language): Urdu-only letters (ٹ ڈ ڑ ں ے ھ گ چ پ ژ ک ی ہ) → "ur"; Arabic-only (ة ي ك ى) → "ar". */
export function scriptLang(text: string): "ar" | "ur" | undefined {
  if (/[ٹڈڑںےھگچپژکیہ]/.test(text)) return "ur";
  if (/[ةيكى]/.test(text)) return "ar";
  return undefined;
}
const scriptLineHeight = (lh: number) => (arabicMode ? Math.min(lh, 1.65) : lh);

/**
 * Style overrides that make a headline/text block render Urdu correctly: right-to-left, tall line height,
 * no letter-spacing (it breaks the joins between letters), no faux italics. Empty for non-Urdu text, so it
 * can be spread into any style: style={{ ...base, ...urduStyle(text) }}.
 */
export function urduStyle(text: string | undefined | null, lineHeight = URDU_LINE_HEIGHT): React.CSSProperties {
  if (!isUrdu(text)) return {};
  return { direction: "rtl", unicodeBidi: "plaintext", lineHeight: scriptLineHeight(lineHeight), letterSpacing: 0, fontStyle: "normal", textTransform: "none" };
}

/**
 * Choose a font size so `text` fits roughly inside maxW x maxH.
 * charW: average glyph width as a fraction of font size (condensed ~0.45, regular sans ~0.55, wide ~0.62).
 */
export function fitText(
  text: string,
  opts: { maxW: number; maxH: number; max: number; min?: number; charW?: number; lineH?: number; uppercase?: boolean },
): number {
  const { maxW, maxH, max } = opts;
  const urdu = isUrdu(text);
  const min = opts.min ?? 28;
  // Nastaliq glyphs are narrower per character but need much taller lines (see urduStyle).
  const charW = urdu ? (arabicMode ? 0.5 : 0.42) : (opts.charW ?? 0.55) * (opts.uppercase ? 1.12 : 1);
  const lineH = urdu ? scriptLineHeight(URDU_LINE_HEIGHT) : opts.lineH ?? 1.1;
  const words = (text || " ").split(/\s+/).filter(Boolean);
  const longest = Math.max(1, ...words.map((w) => w.length));
  for (let size = max; size > min; size -= 4) {
    if (longest * charW * size > maxW) continue;
    // simulate greedy line wrapping
    const perLine = Math.max(1, Math.floor(maxW / (charW * size)));
    let lines = 1;
    let cur = 0;
    for (const w of words) {
      const add = cur === 0 ? w.length : w.length + 1;
      if (cur + add > perLine) {
        lines++;
        cur = w.length;
      } else cur += add;
    }
    if (lines * lineH * size <= maxH) return size;
  }
  return min;
}

export function splitWords(text: string | undefined): string[] {
  return (text ?? "").split(/\s+/).filter(Boolean);
}

/** Turn subtext into list items when a scene has no bullets. */
export function toItems(bullets: string[] | undefined, subtext: string | undefined): string[] {
  if (bullets && bullets.length) return bullets.slice(0, 6);
  if (!subtext) return [];
  const parts = subtext
    .split(/(?:\s*[•|;]\s*|\.\s+|\n+)/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean);
  return parts.length > 1 ? parts.slice(0, 6) : [];
}

export function initials(name: string): string {
  const w = splitWords(name.replace(/[^\p{L}\p{N} ]/gu, " "));
  if (!w.length) return "•";
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
