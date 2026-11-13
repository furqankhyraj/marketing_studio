// product-drop, text-list, blueprint, zine, pulse
import React from "react";
import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { StyleDef, SceneProps } from "./types.ts";
import { STYLE_META } from "./meta.ts";
import { MediaFill, MediaBox } from "../components/Media.tsx";
import { Grain } from "../components/Brand.tsx";
import { FadeUp, WordReveal } from "../components/Kinetic.tsx";
import { FONTS } from "../lib/fonts.ts";
import { fitText, initials, pad2, toItems, splitWords, urduStyle } from "../lib/text.ts";
import { useLayout } from "../lib/layout.ts";
import { darken, ensureContrast, lighten, mix, readable, rgba, isDark } from "../lib/color.ts";

/* ----------------------------- PRODUCT DROP ----------------------------- */
const Ticker: React.FC<{ text: string; bg: string; fg: string; top: number; speed?: number; rotate?: number }> = ({ text, bg, fg, top, speed = 6, rotate = 0 }) => {
  const frame = useCurrentFrame();
  const unit = `${text}  ✦  `;
  const content = unit.repeat(12);
  return (
    <div style={{ position: "absolute", left: -60, right: -60, top, height: 84, background: bg, overflow: "hidden", transform: `rotate(${rotate}deg)`, display: "flex", alignItems: "center", zIndex: 5 }}>
      <div style={{ whiteSpace: "nowrap", fontFamily: FONTS.condensed, fontSize: 52, color: fg, transform: `translateX(${-(frame * speed) % 900}px)`, letterSpacing: 2 }}>{content}</div>
    </div>
  );
};

const ProductDropScene: React.FC<SceneProps> = ({ scene, index, brand, pal, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const zoom = spring({ frame: frame - 2, fps, config: { damping: 13, mass: 1.1 } });
  const tag = spring({ frame: frame - 14, fps, config: { damping: 9, mass: 0.7 } });
  const floatY = Math.sin(frame / 14) * 14;
  const spot = darken(pal.primary, 0.82);
  const tagBg = pal.accent;
  const tagFg = readable(tagBg, ["#111", "#fff"]);
  const prodSize = L.isReel ? 600 : 500;
  const prodTop = L.isReel ? 400 : 280;
  const size = fitText(scene.headline.toUpperCase(), { maxW: L.innerW, maxH: L.isReel ? 220 : 200, max: 110, min: 50, charW: 0.43, lineH: 1, uppercase: true });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 38%, ${mix(spot, pal.secondary, 0.25)} 0%, ${spot} 55%, #040404 100%)`, overflow: "hidden" }}>
      <Ticker text={index === 0 ? "NEW DROP" : "JUST LANDED"} bg={tagBg} fg={tagFg} top={L.isReel ? 290 : 170} rotate={-3} />
      {/* rotating light rays */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: prodTop + prodSize / 2,
          width: 2200,
          height: 2200,
          marginLeft: -1100,
          marginTop: -1100,
          background: `repeating-conic-gradient(from ${frame * 0.6}deg, ${rgba("#ffffff", 0.05)} 0deg 8deg, transparent 8deg 24deg)`,
          maskImage: "radial-gradient(circle, black 0%, transparent 55%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: (L.W - prodSize) / 2,
          top: prodTop + floatY,
          width: prodSize,
          height: prodSize,
          transform: `scale(${interpolate(zoom, [0, 1], [0.3, 1])}) rotate(${interpolate(zoom, [0, 1], [-25, 0])}deg)`,
          borderRadius: scene.media ? 48 : prodSize / 2,
          overflow: "hidden",
          boxShadow: `0 60px 120px rgba(0,0,0,0.6), 0 0 0 10px ${rgba("#ffffff", 0.08)}`,
        }}
      >
        <MediaFill
          media={scene.media}
          dur={dur}
          kenBurns="in"
          strength={0.2}
          fallback={
            <AbsoluteFill style={{ background: `radial-gradient(circle at 35% 30%, ${lighten(pal.primary, 0.45)} 0%, ${pal.primary} 45%, ${darken(pal.primary, 0.5)} 100%)`, alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontFamily: FONTS.didone, fontStyle: "italic", fontSize: prodSize * 0.42, color: rgba(readable(pal.primary), 0.92) }}>{initials(brand.name)}</div>
              <div style={{ position: "absolute", left: "18%", top: "12%", width: "34%", height: "16%", borderRadius: 999, background: "rgba(255,255,255,0.35)", filter: "blur(20px)", transform: "rotate(-30deg)" }} />
            </AbsoluteFill>
          }
        />
      </div>
      {/* price-tag card */}
      {scene.subtext ? (
        <div
          style={{
            position: "absolute",
            right: 70,
            top: prodTop + prodSize - 150,
            transform: `rotate(${interpolate(tag, [0, 1], [40, 8])}deg) scale(${tag})`,
            transformOrigin: "10% 50%",
            display: "flex",
            alignItems: "center",
            zIndex: 6,
          }}
        >
          <div
            style={{
              background: tagBg,
              color: tagFg,
              padding: "26px 40px 26px 70px",
              clipPath: "polygon(12% 0, 100% 0, 100% 100%, 12% 100%, 0 50%)",
              fontFamily: FONTS.heavy,
              fontWeight: 900,
              fontSize: 40,
              maxWidth: 520,
              lineHeight: 1.15,
              position: "relative",
              boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ position: "absolute", left: 30, top: "50%", width: 20, height: 20, marginTop: -10, borderRadius: 99, background: spot }} />
            {scene.subtext}
          </div>
        </div>
      ) : null}
      <div style={{ position: "absolute", left: L.side, right: L.side, top: prodTop + prodSize + (L.isReel ? 50 : 40) }}>
        <WordReveal text={scene.headline.toUpperCase()} kind="stamp" delay={10} stagger={4} style={{ fontFamily: FONTS.condensed, fontSize: size, lineHeight: 1, color: "#ffffff", letterSpacing: 1 }} />
      </div>
    </AbsoluteFill>
  );
};

export const productDrop: StyleDef = {
  meta: STYLE_META["product-drop"],
  Scene: ProductDropScene,
  transition: "zoom",
  transitionFrames: 12,
  darkChrome: () => true,
  cta: (pal) => ({
    background: `radial-gradient(ellipse at 50% 40%, ${darken(pal.primary, 0.6)} 0%, #040404 80%)`,
    fg: "#ffffff",
    keywordBg: pal.accent,
    keywordFg: readable(pal.accent, ["#111", "#fff"]),
    headingFont: FONTS.condensed,
    bodyFont: FONTS.heavy,
    radius: 16,
  }),
};

/* ----------------------------- TEXT LIST ----------------------------- */
const TextListScene: React.FC<SceneProps> = ({ scene, index, pal, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const bg = isDark(pal.background) ? pal.background : mix(pal.background, "#ffffff", 0.3);
  const fg = ensureContrast(pal.text, bg, 7);
  const num = ensureContrast(pal.primary, bg, 3);
  const items = toItems(scene.bullets, scene.subtext);
  const headSize = fitText(scene.headline, { maxW: L.innerW, maxH: items.length ? 300 : 600, max: items.length ? 92 : 130, min: 48, charW: 0.55, lineH: 1.08 });
  const per = items.length ? Math.min(14, Math.max(6, (dur - 30) / items.length)) : 0;
  const itemSize = items.length > 4 ? 40 : 48;
  return (
    <AbsoluteFill style={{ background: bg }}>
      {scene.media ? (
        <AbsoluteFill style={{ opacity: 0.16 }}>
          <MediaFill media={scene.media} dur={dur} kenBurns="in" filter="grayscale(1)" />
        </AbsoluteFill>
      ) : null}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 24, background: num }} />
      <AbsoluteFill style={{ padding: `${L.safeTop}px ${L.side}px ${L.isReel ? L.safeBottom : 110}px`, justifyContent: items.length ? "flex-start" : "center" }}>
        <FadeUp>
          <div style={{ display: "inline-block", fontFamily: FONTS.grotesk, fontWeight: 700, fontSize: 30, color: readable(num), background: num, padding: "8px 18px", borderRadius: 10, marginBottom: 30, letterSpacing: 2 }}>
            {items.length ? `${items.length} THINGS` : `PART ${index + 1}`}
          </div>
        </FadeUp>
        <WordReveal text={scene.headline} kind="slide" delay={4} stagger={2} align="left" gap="0 0.25em" style={{ fontFamily: FONTS.heavy, fontWeight: 900, fontSize: headSize, lineHeight: 1.08, color: fg, letterSpacing: -1 }} />
        <div style={{ marginTop: 50, display: "flex", flexDirection: "column", gap: items.length > 4 ? 22 : 34 }}>
          {items.map((it, i) => {
            const s = spring({ frame: frame - 16 - i * per, fps, config: { damping: 14 } });
            const active = frame >= 16 + i * per && (i === items.length - 1 || frame < 16 + (i + 1) * per);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 28, opacity: s, transform: `translateX(${(1 - s) * 120}px)` }}>
                <div
                  style={{
                    width: itemSize * 1.8,
                    height: itemSize * 1.8,
                    flexShrink: 0,
                    borderRadius: 999,
                    background: active ? num : "transparent",
                    border: `4px solid ${num}`,
                    color: active ? readable(num) : num,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: FONTS.grotesk,
                    fontWeight: 700,
                    fontSize: itemSize * 0.8,
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize: itemSize, lineHeight: 1.2, color: fg }}>{it}</div>
              </div>
            );
          })}
          {!items.length && scene.subtext ? (
            <FadeUp delay={14}>
              <div style={{ fontFamily: FONTS.sans, fontSize: 44, lineHeight: 1.4, color: fg, opacity: 0.85 }}>{scene.subtext}</div>
            </FadeUp>
          ) : null}
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", right: 40, bottom: L.isReel ? 340 : 30, fontFamily: FONTS.heavy, fontWeight: 900, fontSize: 300, color: rgba(num, 0.1), lineHeight: 1 }}>{pad2(index + 1)}</div>
    </AbsoluteFill>
  );
};

export const textList: StyleDef = {
  meta: STYLE_META["text-list"],
  Scene: TextListScene,
  transition: "slide-up",
  transitionFrames: 12,
  darkChrome: (pal) => isDark(pal.background),
  cta: (pal) => {
    const bg = isDark(pal.background) ? pal.background : mix(pal.background, "#ffffff", 0.3);
    const num = ensureContrast(pal.primary, bg, 3);
    return { background: bg, fg: ensureContrast(pal.text, bg, 7), keywordBg: num, keywordFg: readable(num), headingFont: FONTS.heavy, bodyFont: FONTS.sans, radius: 24 };
  },
};

/* ----------------------------- BLUEPRINT ----------------------------- */
const blueprintBg = (pal: { primary: string }) => {
  const base = isDark(pal.primary) ? mix("#0b3d91", pal.primary, 0.45) : mix("#0b3d91", pal.primary, 0.25);
  return darken(base, 0.15);
};

const BlueprintScene: React.FC<SceneProps> = ({ scene, index, pal, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const bg = blueprintBg(pal);
  const line = "rgba(255,255,255,0.14)";
  const line2 = "rgba(255,255,255,0.28)";
  const ink = "#eaf2ff";
  const hi = ensureContrast(pal.accent, bg, 4.5);
  const draw = interpolate(frame, [0, 40], [1, 0], { extrapolateRight: "clamp" });
  const s = spring({ frame: frame - 8, fps, config: { damping: 200 } });
  const boxTop = L.isReel ? 390 : 170;
  const boxH = L.isReel ? 460 : 440;
  const boxW = L.W - L.side * 2;
  const size = fitText(scene.headline, { maxW: L.innerW, maxH: L.isReel ? 300 : 230, max: 96, min: 44, charW: 0.6, lineH: 1.1 });
  return (
    <AbsoluteFill
      style={{
        background: bg,
        backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px), linear-gradient(${line2} 2px, transparent 2px), linear-gradient(90deg, ${line2} 2px, transparent 2px)`,
        backgroundSize: "36px 36px, 36px 36px, 180px 180px, 180px 180px",
        backgroundPosition: `${frame * 0.5}px ${frame * 0.5}px`,
      }}
    >
      <div style={{ position: "absolute", top: L.isReel ? 290 : 60, left: L.side, right: L.side, display: "flex", justifyContent: "space-between", fontFamily: FONTS.mono, fontSize: 26, color: ink, opacity: 0.8 }}>
        <span>FIG. {pad2(index + 1)}</span>
        <span>SCALE 1:1 — REV {String.fromCharCode(65 + (index % 26))}</span>
      </div>
      {/* drafting frame */}
      <svg style={{ position: "absolute", left: L.side, top: boxTop }} width={boxW} height={boxH + 80}>
        <rect x="2" y="2" width={boxW - 4} height={boxH - 4} fill="none" stroke={ink} strokeWidth="3" strokeDasharray={2 * (boxW + boxH)} strokeDashoffset={2 * (boxW + boxH) * draw} />
        <line x1="0" y1={boxH + 40} x2={boxW} y2={boxH + 40} stroke={hi} strokeWidth="2" strokeDasharray={boxW} strokeDashoffset={boxW * draw} />
        <path d={`M 2 ${boxH + 26} L 2 ${boxH + 54} M ${boxW - 2} ${boxH + 26} L ${boxW - 2} ${boxH + 54}`} stroke={hi} strokeWidth="2" />
        <text x={boxW / 2} y={boxH + 30} fill={hi} fontFamily="monospace" fontSize="24" textAnchor="middle" opacity={1 - draw}>
          {Math.round(dur / fps * 10) / 10}s
        </text>
        {[0, 1, 2, 3].map((k) => {
          const x = k % 2 ? boxW - 30 : 30;
          const y = k > 1 ? boxH - 30 : 30;
          return <circle key={k} cx={x} cy={y} r={10} fill="none" stroke={ink} strokeWidth="2" opacity={1 - draw} />;
        })}
      </svg>
      <div style={{ position: "absolute", left: L.side + 24, top: boxTop + 24, width: boxW - 48, height: boxH - 48, overflow: "hidden" }}>
        <MediaFill
          media={scene.media}
          dur={dur}
          kenBurns="pan-right"
          filter="grayscale(1) contrast(1.3) brightness(1.1)"
          style={{ mixBlendMode: "screen", opacity: 0.85 }}
          fallback={
            <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
              <svg width={boxH * 0.8} height={boxH * 0.8} viewBox="0 0 100 100" style={{ opacity: 1 - draw * 0.8 }}>
                <circle cx="50" cy="50" r="40" fill="none" stroke={ink} strokeWidth="0.6" />
                <circle cx="50" cy="50" r="26" fill="none" stroke={hi} strokeWidth="0.8" strokeDasharray="3 2" transform={`rotate(${frame * 1.5} 50 50)`} />
                <path d="M10 50 H90 M50 10 V90" stroke={ink} strokeWidth="0.4" />
                <rect x="38" y="38" width="24" height="24" fill="none" stroke={ink} strokeWidth="0.8" transform={`rotate(${-frame} 50 50)`} />
              </svg>
            </AbsoluteFill>
          }
        />
      </div>
      <div style={{ position: "absolute", left: L.side, right: L.side, top: boxTop + boxH + 110, opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>
        <WordReveal text={scene.headline} kind="type" delay={10} style={{ fontFamily: FONTS.mono, fontWeight: 700, fontSize: size, lineHeight: 1.1, color: ink }} align="left" />
        {scene.subtext ? (
          <FadeUp delay={24}>
            <div style={{ marginTop: 22, fontFamily: FONTS.grotesk, fontSize: 36, lineHeight: 1.4, color: ink, opacity: 0.85, borderLeft: `4px solid ${hi}`, paddingLeft: 22 }}>{scene.subtext}</div>
          </FadeUp>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const blueprint: StyleDef = {
  meta: STYLE_META["blueprint"],
  Scene: BlueprintScene,
  transition: "wipe",
  transitionFrames: 12,
  darkChrome: () => true,
  cta: (pal) => {
    const bg = blueprintBg(pal);
    const hi = ensureContrast(pal.accent, bg, 4.5);
    return {
      background: `${bg}`,
      fg: "#eaf2ff",
      keywordBg: hi,
      keywordFg: readable(hi),
      headingFont: FONTS.mono,
      bodyFont: FONTS.grotesk,
      radius: 4,
      Decor: () => (
        <AbsoluteFill style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.14) 1px, transparent 1px)", backgroundSize: "36px 36px" }} />
      ),
    };
  },
};

/* ----------------------------- ZINE ----------------------------- */
const zineFonts = [FONTS.marker, FONTS.condensed, FONTS.didone, FONTS.mono, FONTS.heavy];

const ZineScene: React.FC<SceneProps> = ({ scene, index, pal, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const words = splitWords(scene.headline);
  const boxColors = [pal.primary, "#111111", "#ffffff", pal.accent, pal.secondary];
  const jitter = Math.floor(frame / 4); // "stop motion" feel
  const size = fitText(scene.headline, { maxW: L.innerW - 80, maxH: L.isReel ? 640 : 520, max: 120, min: 50, charW: 0.75, lineH: 1.45 });
  const st = spring({ frame: frame - 18, fps, config: { damping: 8, mass: 0.6 } });
  return (
    <AbsoluteFill
      style={{
        background: "#ece8df",
        backgroundImage: `radial-gradient(${rgba(pal.primary, 0.22)} 22%, transparent 24%)`,
        backgroundSize: "26px 26px",
        overflow: "hidden",
      }}
    >
      {scene.media ? (
        <div style={{ position: "absolute", left: 60, right: 160, top: L.isReel ? 240 : 60, height: L.isReel ? 620 : 500, transform: "rotate(-4deg)", border: "14px solid #fff", boxShadow: "6px 10px 0 #111" }}>
          <MediaBox media={scene.media} dur={dur} kenBurns="in" filter="grayscale(1) contrast(1.6)" style={{ width: "100%", height: "100%" }} />
          <div style={{ position: "absolute", inset: 0, background: pal.primary, mixBlendMode: "multiply", opacity: 0.55 }} />
        </div>
      ) : (
        <div style={{ position: "absolute", width: 820, height: 820, borderRadius: 999, background: pal.secondary, opacity: 0.55, right: -260, top: L.isReel ? 200 : -200 }} />
      )}
      <AbsoluteFill style={{ justifyContent: scene.media ? "flex-end" : "center", alignItems: "center", padding: `${L.safeTop}px ${L.side - 20}px ${L.isReel ? L.safeBottom : 100}px` }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "18px 14px", maxWidth: L.innerW, ...urduStyle(scene.headline) }}>
          {words.map((w, i) => {
            const delay = i * 3;
            const vis = frame >= delay;
            const bgc = boxColors[(i + index) % boxColors.length];
            const fg = readable(bgc, ["#111", "#fff"]);
            const r = (random(`z-${index}-${i}`) - 0.5) * 10 + (random(`j-${i}-${jitter}`) - 0.5) * 1.6;
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  visibility: vis ? "visible" : "hidden",
                  background: bgc,
                  color: fg,
                  fontFamily: zineFonts[(i + index) % zineFonts.length],
                  fontSize: size * (0.9 + random(`s-${i}`) * 0.25),
                  lineHeight: 1.05,
                  padding: "6px 18px",
                  transform: `rotate(${r}deg)`,
                  boxShadow: "5px 6px 0 rgba(0,0,0,0.85)",
                  textTransform: i % 2 ? "uppercase" : "none",
                  ...urduStyle(w, 1.7),
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
        {scene.subtext ? (
          <div
            style={{
              marginTop: 60,
              background: "#fff9a8",
              padding: "22px 30px",
              fontFamily: FONTS.marker,
              fontSize: 38,
              lineHeight: 1.3,
              color: "#111",
              transform: `rotate(${2 + (1 - st) * 20}deg) scale(${st})`,
              boxShadow: "6px 8px 0 #111",
              maxWidth: L.innerW - 80,
              textAlign: "center",
            }}
          >
            {scene.subtext}
          </div>
        ) : null}
      </AbsoluteFill>
      {/* sticker */}
      <div
        style={{
          position: "absolute",
          right: 70,
          top: L.isReel ? 300 : 170,
          width: 190,
          height: 190,
          borderRadius: 999,
          background: pal.accent,
          color: readable(pal.accent, ["#111", "#fff"]),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONTS.marker,
          fontSize: 40,
          textAlign: "center",
          lineHeight: 1,
          transform: `rotate(${12 + Math.sin(frame / 8) * 4}deg) scale(${st})`,
          border: "6px dashed #111",
          zIndex: 4,
        }}
      >
        #{index + 1}
      </div>
      <Grain opacity={0.25} seed={20 + (jitter % 3)} frequency={1.2} blend="multiply" />
    </AbsoluteFill>
  );
};

export const zine: StyleDef = {
  meta: STYLE_META["zine"],
  Scene: ZineScene,
  transition: "cut",
  transitionFrames: 0,
  darkChrome: () => false,
  cta: (pal) => ({
    background: `radial-gradient(${rgba(pal.primary, 0.22)} 22%, transparent 24%) 0 0 / 26px 26px, #ece8df`,
    fg: "#111111",
    keywordBg: pal.primary,
    keywordFg: readable(pal.primary, ["#fff", "#111"]),
    headingFont: FONTS.marker,
    bodyFont: FONTS.heavy,
    radius: 4,
  }),
};

/* ----------------------------- PULSE ----------------------------- */
const PulseScene: React.FC<SceneProps> = ({ scene, index, pal, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const beatLen = Math.round(fps / 2); // 120 BPM
  const phase = (frame % beatLen) / beatLen;
  const beat = Math.floor(frame / beatLen);
  const kick = Math.exp(-phase * 6); // 1 on the beat, decays
  const cols = [pal.primary, pal.accent, pal.secondary];
  const bg = cols[(index + beat) % 2 === 0 ? 0 : 1] ?? pal.primary;
  const alt = cols[(index + beat) % 2 === 0 ? 1 : 0];
  const fg = readable(bg, ["#ffffff", "#111111"]);
  const words = splitWords(scene.headline.toUpperCase());
  // reveal one more word on each beat
  const shown = Math.min(words.length, 1 + beat);
  const size = fitText(scene.headline.toUpperCase(), { maxW: L.innerW, maxH: L.isReel ? 640 : 560, max: 200, min: 64, charW: 0.45, lineH: 1, uppercase: true });
  const enter = spring({ frame, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden" }}>
      {scene.media ? (
        <AbsoluteFill style={{ transform: `scale(${1 + kick * 0.04})`, opacity: 0.55 }}>
          <MediaFill media={scene.media} dur={dur} kenBurns="none" filter="contrast(1.2)" />
        </AbsoluteFill>
      ) : null}
      {[0, 1, 2, 3].map((k) => {
        const r = ((phase + k) / 4) * 1.8;
        return (
          <div
            key={k}
            style={{
              position: "absolute",
              left: "50%",
              top: "40%",
              width: L.W * r,
              height: L.W * r,
              marginLeft: (-L.W * r) / 2,
              marginTop: (-L.W * r) / 2,
              borderRadius: 9999,
              border: `${18 - k * 3}px solid ${rgba(alt, 0.5 * (1 - (phase + k) / 4))}`,
            }}
          />
        );
      })}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: `${L.safeTop}px ${L.side}px ${L.isReel ? L.safeBottom : 90}px` }}>
        <div style={{ transform: `scale(${(1 + kick * 0.07) * enter})`, textAlign: "center" }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 0.22em", fontFamily: FONTS.condensed, fontSize: size, ...urduStyle(scene.headline) }}>
            {words.map((w, i) => (
              <span key={i} style={{ fontFamily: FONTS.condensed, fontSize: size, lineHeight: 1, ...urduStyle(w), color: i === shown - 1 ? alt === bg ? fg : readable(bg, [alt, fg], 3) : fg, opacity: i < shown ? 1 : 0.12 }}>
                {w}
              </span>
            ))}
          </div>
        </div>
        {scene.subtext ? (
          <FadeUp delay={Math.min(dur * 0.4, beatLen * 2)}>
            <div style={{ marginTop: 50, background: fg, color: bg, fontFamily: FONTS.heavy, fontWeight: 900, fontSize: 40, padding: "16px 30px", borderRadius: 999, textAlign: "center", lineHeight: 1.25 }}>{scene.subtext}</div>
          </FadeUp>
        ) : null}
      </AbsoluteFill>
      {/* beat meter */}
      <div style={{ position: "absolute", left: L.side, right: L.side, top: L.isReel ? 270 : 50, display: "flex", gap: 10 }}>
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 12 + (i === beat % 16 ? 30 * kick : 0), background: fg, opacity: i === beat % 16 ? 1 : 0.25, borderRadius: 4, alignSelf: "flex-end" }} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const pulse: StyleDef = {
  meta: STYLE_META["pulse"],
  Scene: PulseScene,
  transition: "flash",
  transitionFrames: 8,
  darkChrome: (pal) => isDark(pal.primary),
  cta: (pal) => ({
    background: pal.primary,
    fg: pal.onPrimary,
    keywordBg: pal.accent,
    keywordFg: pal.onAccent,
    headingFont: FONTS.condensed,
    bodyFont: FONTS.heavy,
    radius: 999,
    uppercase: true,
  }),
};

void lighten;
