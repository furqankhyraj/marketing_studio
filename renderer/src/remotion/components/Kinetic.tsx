import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { splitWords, isUrdu, urduStyle } from "../lib/text.ts";

export type RevealKind = "rise" | "pop" | "fade" | "slide" | "drop" | "blur" | "type" | "stamp";

/**
 * Kinetic headline: each word animates in with a stagger. Urdu text animates whole words only (never per
 * letter, which would break the joined letters), flows right-to-left and gets Nastaliq-friendly line height.
 */
export const WordReveal: React.FC<{
  text: string;
  kind?: RevealKind;
  delay?: number;
  stagger?: number;
  style?: React.CSSProperties;
  wordStyle?: (i: number, word: string) => React.CSSProperties | undefined;
  align?: "left" | "center" | "right";
  gap?: string;
}> = ({ text, kind: kind0 = "rise", delay = 0, stagger = 4, style, wordStyle, align: align0 = "center", gap = "0 0.24em" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = splitWords(text);
  const urdu = isUrdu(text);
  // Urdu: "type" reveals letters and "rise" clips Nastaliq's tall glyphs, so both become a whole-word fade;
  // left-aligned layouts mirror to the right.
  const kind: RevealKind = urdu && (kind0 === "type" || kind0 === "rise") ? "fade" : kind0;
  const align = urdu && align0 === "left" ? "right" : align0;
  const ur = urduStyle(text);

  if (kind === "type") {
    const chars = Math.floor(interpolate(frame - delay, [0, Math.max(1, text.length * 1.2)], [0, text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
    const caret = Math.floor(frame / 8) % 2 === 0 && chars < text.length + 1;
    return (
      <div style={{ textAlign: align, ...style }}>
        {text.slice(0, chars)}
        <span style={{ opacity: caret ? 1 : 0 }}>▌</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        // in an rtl container flex-start is the right edge
        justifyContent: align === "center" ? "center" : urdu ? "flex-start" : align === "right" ? "flex-end" : "flex-start",
        gap,
        ...style,
        ...ur,
      }}
    >
      {words.map((w, i) => {
        const s = spring({ frame: frame - delay - i * stagger, fps, config: kind === "stamp" ? { damping: 9, mass: 0.6 } : { damping: 15, mass: 0.7 } });
        let inner: React.CSSProperties = {};
        let outer: React.CSSProperties = { display: "inline-block" };
        switch (kind) {
          case "rise":
            outer = { display: "inline-block", overflow: "hidden", paddingBottom: "0.06em", marginBottom: "-0.06em" };
            inner = { transform: `translateY(${(1 - s) * 105}%)` };
            break;
          case "pop":
            inner = { transform: `scale(${s})`, opacity: Math.min(1, s * 2) };
            break;
          case "fade":
            inner = { opacity: s, transform: `translateY(${(1 - s) * 24}px)` };
            break;
          case "slide":
            inner = { opacity: Math.min(1, s * 1.5), transform: `translateX(${(1 - s) * (urdu ? 80 : -80)}px)` };
            break;
          case "drop":
            inner = { opacity: Math.min(1, s * 2), transform: `translateY(${(1 - s) * -120}px) rotate(${(1 - s) * 10}deg)` };
            break;
          case "blur":
            inner = { opacity: s, filter: `blur(${(1 - s) * 18}px)`, transform: `scale(${1 + (1 - s) * 0.15})` };
            break;
          case "stamp":
            inner = { opacity: s > 0.05 ? 1 : 0, transform: `scale(${interpolate(s, [0, 1], [2.2, 1])}) rotate(${interpolate(s, [0, 1], [-6, 0])}deg)` };
            break;
        }
        return (
          <span key={i} style={outer}>
            <span style={{ display: "inline-block", ...inner, ...(wordStyle?.(i, w) ?? {}) }}>{w}</span>
          </span>
        );
      })}
    </div>
  );
};

/** Simple fade-up block for subtext. */
export const FadeUp: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties; distance?: number }> = ({
  delay = 0,
  children,
  style,
  distance = 40,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return <div style={{ opacity: s, transform: `translateY(${(1 - s) * distance}px)`, ...style }}>{children}</div>;
};
