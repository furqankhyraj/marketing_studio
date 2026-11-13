import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReelSpec } from "../../../../shared/types.ts";
import { type Palette, ensureContrast } from "../lib/color.ts";
import { FONTS } from "../lib/fonts.ts";
import { splitWords, isUrdu } from "../lib/text.ts";

export { CAPTION_STYLES } from "../styles/meta.ts";

export interface CaptionWord {
  text: string;
  start: number; // frame
  end: number; // frame
}

/** Build the word timeline: real word timings when provided, otherwise evenly spaced per scene. */
export function buildCaptionWords(spec: ReelSpec, fps: number): CaptionWord[] {
  if (spec.captions && spec.captions.length) {
    return spec.captions
      .filter((c) => c && typeof c.text === "string" && c.text.trim())
      .map((c) => ({
        text: c.text.trim(),
        start: Math.max(0, (c.startMs / 1000) * fps),
        end: Math.max((c.startMs / 1000) * fps + 1, (c.endMs / 1000) * fps),
      }))
      .sort((a, b) => a.start - b.start);
  }
  const out: CaptionWord[] = [];
  let cursor = 0;
  for (const scene of spec.scenes) {
    const frames = Math.round(Math.max(0.5, scene.durationSec || 3) * fps);
    const words = splitWords(scene.captionText || scene.voiceoverText);
    if (words.length) {
      // leave a little air at the start/end of each scene; weight by word length
      const lead = Math.min(8, frames * 0.06);
      const usable = frames - lead * 2;
      const weights = words.map((w) => 2 + w.length);
      const total = weights.reduce((a, b) => a + b, 0);
      let t = cursor + lead;
      words.forEach((w, i) => {
        const d = (weights[i] / total) * usable;
        out.push({ text: w, start: t, end: t + d });
        t += d;
      });
    }
    cursor += frames;
  }
  return out;
}

interface Phrase {
  words: CaptionWord[];
  start: number;
  end: number;
}

/** Group words into phrases of 2-4 words, breaking on punctuation or pauses. */
export function groupPhrases(words: CaptionWord[], fps: number): Phrase[] {
  const phrases: Phrase[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (cur.length) phrases.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end > fps * 0.45 && cur.length >= 1) flush();
    cur.push(w);
    const chars = cur.reduce((a, b) => a + b.text.length + 1, 0);
    const punct = /[.!?,;:،؛۔؟]$/.test(w.text); // incl. Urdu ، ؛ ۔ ؟
    if (cur.length >= 4 || chars > 22 || (punct && cur.length >= 2) || (/[.!?۔؟]$/.test(w.text))) flush();
  }
  flush();
  // extend phrase end until the next phrase starts (max 0.6s) so captions don't flicker
  for (let i = 0; i < phrases.length; i++) {
    const next = phrases[i + 1];
    const limit = phrases[i].end + fps * 0.6;
    phrases[i].end = next ? Math.min(next.start, limit) : limit;
  }
  return phrases;
}

// Overrides every caption style's Latin typography for Urdu words (inline styles need !important).
const URDU_CAPTION_CSS = `.smcp-urdu-caption > span {
  font-family: ${FONTS.urdu} !important;
  line-height: 2.2 !important;
  letter-spacing: 0 !important;
  font-style: normal !important;
  text-transform: none !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}`;

export const Captions: React.FC<{ words: CaptionWord[]; styleId: string; pal: Palette; maxFrame: number }> = ({
  words,
  styleId,
  pal,
  maxFrame,
}) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const phrases = React.useMemo(() => groupPhrases(words, fps), [words, fps]);
  const phrase = phrases.find((p) => frame >= p.start && frame < Math.min(p.end, maxFrame));
  if (!phrase) return null;

  const local = frame - phrase.start;
  const pop = spring({ frame: local, fps, config: { damping: 12, mass: 0.5 } });
  const activeIdx = phrase.words.findIndex((w) => frame >= w.start && frame < w.end);
  const lastSpoken = phrase.words.reduce((acc, w, i) => (frame >= w.start ? i : acc), -1);
  const isActive = (i: number) => i === (activeIdx >= 0 ? activeIdx : lastSpoken);
  const top = height > 1500 ? height * 0.69 : height * 0.7;

  const container: React.CSSProperties = {
    position: "absolute",
    left: 60,
    right: 60,
    top,
    display: "flex",
    justifyContent: "center",
    zIndex: 70,
    transform: `scale(${interpolate(pop, [0, 1], [0.86, 1])})`,
    opacity: interpolate(pop, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }),
  };
  const accentOnWhite = ensureContrast(pal.pop, "#ffffff", 3);
  const maxW = width - 120;

  // Urdu phrases: right-to-left word order, Nastaliq font with tall lines. Highlighting stays per whole word
  // (each word is its own span), never per letter, so the joined letters are never split.
  const urdu = phrase.words.some((w) => isUrdu(w.text));
  const wordsEl = (render: (w: CaptionWord, i: number, active: boolean, spoken: boolean) => React.ReactNode, gap = "0 18px") => (
    <div
      className={urdu ? "smcp-urdu-caption" : undefined}
      dir={urdu ? "rtl" : undefined}
      style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: urdu ? "0 14px" : gap, maxWidth: maxW, direction: urdu ? "rtl" : undefined }}
    >
      {urdu ? <style>{URDU_CAPTION_CSS}</style> : null}
      {phrase.words.map((w, i) => (
        <React.Fragment key={i}>{render(w, i, isActive(i), frame >= w.start)}</React.Fragment>
      ))}
    </div>
  );

  switch (styleId) {
    case "black-bar":
      return (
        <div style={container}>
          <div style={{ background: "#000", padding: "14px 30px", fontFamily: FONTS.sans, fontWeight: 700, fontSize: 58, color: "#fff", lineHeight: 1.2, textAlign: "center" }}>
            {wordsEl((w, i, a) => <span style={{ color: a ? ensureContrast(pal.pop, "#000000", 4.5) : "#fff" }}>{w.text}</span>)}
          </div>
        </div>
      );
    case "yellow-didone":
      return (
        <div style={container}>
          {wordsEl((w, i, a, s) => (
            <span
              style={{
                fontFamily: FONTS.didone,
                fontWeight: 700,
                fontStyle: a ? "italic" : "normal",
                fontSize: 82,
                color: "#FFD60A",
                opacity: s ? 1 : 0.55,
                WebkitTextStroke: "5px rgba(20,14,0,0.9)",
                paintOrder: "stroke fill",
                textShadow: "0 4px 18px rgba(0,0,0,0.75)",
                lineHeight: 1.1,
              }}
            >
              {w.text}
            </span>
          ))}
        </div>
      );
    case "subtitle-strip":
      return (
        <div style={{ ...container, left: 0, right: 0, transform: "none" }}>
          <div style={{ width: "100%", background: "rgba(0,0,0,0.62)", padding: "22px 60px", display: "flex", justifyContent: "center" }}>
            {wordsEl((w, i, a) => (
              <span style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize: 52, color: a ? "#ffffff" : "rgba(255,255,255,0.78)", textDecoration: a ? "underline" : "none", textDecorationColor: pal.pop, textUnderlineOffset: 10, textDecorationThickness: 5 }}>
                {w.text}
              </span>
            ))}
          </div>
        </div>
      );
    case "glass-pill":
      return (
        <div style={container}>
          <div style={{ background: "rgba(18,18,24,0.62)", border: "2px solid rgba(255,255,255,0.3)", borderRadius: 999, padding: "18px 40px", boxShadow: "0 10px 40px rgba(0,0,0,0.3)" }}>
            {wordsEl((w, i, a) => (
              <span style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize: 60, color: "#fff", textShadow: a ? `0 0 24px ${pal.pop}, 0 0 8px ${pal.pop}` : "0 2px 8px rgba(0,0,0,0.5)" }}>{w.text}</span>
            ))}
          </div>
        </div>
      );
    case "violet-pop":
      return (
        <div style={container}>
          {wordsEl((w, i, a) => {
            const ws = spring({ frame: frame - w.start, fps, config: { damping: 10, mass: 0.4 } });
            return (
              <span
                style={{
                  fontFamily: FONTS.heavy,
                  fontWeight: 900,
                  fontSize: 72,
                  textTransform: "uppercase",
                  color: "#fff",
                  background: a ? "#7C3AED" : "transparent",
                  padding: "2px 16px",
                  borderRadius: 14,
                  transform: `scale(${a ? interpolate(ws, [0, 1], [0.8, 1.06]) : 1}) rotate(${a ? -2 : 0}deg)`,
                  display: "inline-block",
                  WebkitTextStroke: a ? undefined : "5px rgba(0,0,0,0.9)",
                  paintOrder: "stroke fill",
                  textShadow: a ? "none" : "0 4px 14px rgba(0,0,0,0.8)",
                }}
              >
                {w.text}
              </span>
            );
          }, "8px 4px")}
        </div>
      );
    case "hustle-bold":
      return (
        <div style={container}>
          {wordsEl((w, i, a) => (
            <span
              style={{
                fontFamily: FONTS.condensed,
                fontSize: a ? 104 : 92,
                textTransform: "uppercase",
                color: a ? "#C6FF00" : "#ffffff",
                WebkitTextStroke: "6px #000",
                paintOrder: "stroke fill",
                lineHeight: 1.05,
                textShadow: "0 8px 0 rgba(0,0,0,0.85)",
              }}
            >
              {w.text}
            </span>
          ))}
        </div>
      );
    case "lime-round":
      return (
        <div style={container}>
          {wordsEl((w, i, a) => (
            <span
              style={{
                fontFamily: FONTS.heavy,
                fontWeight: 900,
                fontSize: 64,
                color: a ? "#0B1A00" : "#ffffff",
                background: a ? "#B6F35A" : "transparent",
                borderRadius: 26,
                padding: "4px 18px",
                WebkitTextStroke: a ? undefined : "5px rgba(0,0,0,0.9)",
                paintOrder: "stroke fill",
                textShadow: a ? "none" : "0 3px 12px rgba(0,0,0,0.8)",
              }}
            >
              {w.text.toLowerCase()}
            </span>
          ), "6px 2px")}
        </div>
      );
    case "brand-karaoke": {
      const fill = ensureContrast(pal.pop, "#111111", 7.5);
      return (
        <div style={container}>
          <div style={{ background: "rgba(17,17,17,0.82)", borderRadius: 24, padding: "16px 34px" }}>
            {wordsEl((w, i, a, s) => (
              <span style={{ fontFamily: FONTS.grotesk, fontWeight: 700, fontSize: 60, color: s ? fill : "rgba(255,255,255,0.9)" }}>{w.text}</span>
            ))}
          </div>
        </div>
      );
    }
    case "white-pill":
    default:
      return (
        <div style={container}>
          <div style={{ background: "#ffffff", borderRadius: 28, padding: "16px 36px", boxShadow: "0 12px 40px rgba(0,0,0,0.28)" }}>
            {wordsEl((w, i, a) => (
              <span style={{ fontFamily: FONTS.heavy, fontWeight: 900, fontSize: 60, color: a ? accentOnWhite : "#111111", lineHeight: 1.18 }}>{w.text}</span>
            ))}
          </div>
        </div>
      );
  }
};

