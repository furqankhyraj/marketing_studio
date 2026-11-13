// cinematic, bold, paper, neon, magazine
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { StyleDef, SceneProps } from "./types.ts";
import { STYLE_META } from "./meta.ts";
import { MediaFill, MediaBox } from "../components/Media.tsx";
import { Grain, Scrim, Vignette } from "../components/Brand.tsx";
import { FadeUp, WordReveal } from "../components/Kinetic.tsx";
import { FONTS } from "../lib/fonts.ts";
import { fitText, pad2, urduStyle } from "../lib/text.ts";
import { useLayout } from "../lib/layout.ts";
import { darken, ensureContrast, lighten, mix, readable, rgba, isDark } from "../lib/color.ts";

/* ----------------------------- CINEMATIC ----------------------------- */
const CinematicScene: React.FC<SceneProps> = ({ scene, index, pal, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const bars = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });
  const barH = (L.isReel ? 140 : 70) * bars;
  const base = darken(pal.primary, 0.75);
  const drift = interpolate(frame, [0, dur], [0, 1]);
  const gold = ensureContrast(mix(pal.accent, "#e8c27a", 0.4), "#000000", 6);
  const size = fitText(scene.headline, { maxW: L.innerW, maxH: L.isReel ? 560 : 520, max: 118, min: 48, charW: 0.5, lineH: 1.12 });
  const fallback = (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at ${30 + drift * 40}% ${35 + drift * 20}%, ${rgba(lighten(pal.primary, 0.1), 0.95)} 0%, ${base} 55%, #050505 100%)`,
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${80 - drift * 30}% 80%, ${rgba(pal.secondary, 0.5)} 0%, transparent 50%)`,
          mixBlendMode: "screen",
        }}
      />
    </AbsoluteFill>
  );
  return (
    <AbsoluteFill style={{ background: "#050505" }}>
      <MediaFill media={scene.media} dur={dur} kenBurns={index % 2 ? "pan-left" : "in"} strength={0.1} fallback={fallback} filter="saturate(0.85) contrast(1.05)" />
      <Scrim from="bottom" strength={0.85} />
      <Vignette strength={0.6} />
      <Grain opacity={0.16} seed={index + 3} />
      <AbsoluteFill style={{ justifyContent: "flex-end", padding: `0 ${L.side}px ${L.isReel ? L.safeBottom + 10 : 200}px` }}>
        <FadeUp delay={6}>
          <div style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize: 28, letterSpacing: 10, color: gold, textTransform: "uppercase", marginBottom: 26, textAlign: "center" }}>
            Chapter {pad2(index + 1)}
          </div>
        </FadeUp>
        <WordReveal
          text={scene.headline}
          kind="blur"
          delay={10}
          stagger={5}
          style={{ fontFamily: FONTS.serif, fontStyle: "italic", fontWeight: 400, fontSize: size, lineHeight: 1.12, color: "#f6f1e7", textShadow: "0 6px 30px rgba(0,0,0,0.6)" }}
        />
        {scene.subtext ? (
          <FadeUp delay={26}>
            <div style={{ marginTop: 34, fontFamily: FONTS.sans, fontSize: 38, lineHeight: 1.4, color: "rgba(246,241,231,0.85)", textAlign: "center" }}>{scene.subtext}</div>
          </FadeUp>
        ) : null}
        <div style={{ margin: "38px auto 0", width: interpolate(frame, [14, 50], [0, 180], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), height: 3, background: gold }} />
      </AbsoluteFill>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: barH, background: "#000" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: barH, background: "#000" }} />
    </AbsoluteFill>
  );
};

export const cinematic: StyleDef = {
  meta: STYLE_META["cinematic"],
  Scene: CinematicScene,
  transition: "fade",
  transitionFrames: 14,
  darkChrome: () => true,
  cta: (pal) => ({
    background: `radial-gradient(circle at 50% 40%, ${darken(pal.primary, 0.55)} 0%, #050505 75%)`,
    fg: "#f6f1e7",
    keywordBg: ensureContrast(mix(pal.accent, "#e8c27a", 0.4), "#000", 6),
    keywordFg: "#111111",
    headingFont: FONTS.serif,
    bodyFont: FONTS.sans,
    radius: 8,
    Decor: () => <Grain opacity={0.16} seed={9} />,
  }),
};

/* ----------------------------- BOLD ----------------------------- */
const BoldScene: React.FC<SceneProps> = ({ scene, index, pal, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const fills = [pal.primary, pal.accent, pal.secondary];
  const bg = fills[index % 3];
  const block = fills[(index + 1) % 3] === bg ? darken(bg, 0.3) : fills[(index + 1) % 3];
  const fg = readable(bg, [pal.onPrimary, "#ffffff", "#111111"]);
  const blockIn = spring({ frame: frame - 2, fps, config: { damping: 18 } });
  const upper = scene.headline.toUpperCase();
  const size = fitText(upper, { maxW: L.innerW, maxH: L.isReel ? 700 : 640, max: 230, min: 70, charW: 0.43, lineH: 0.95 });
  const hasMedia = !!scene.media;
  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden" }}>
      {hasMedia ? (
        <AbsoluteFill style={{ clipPath: `polygon(0 0, 100% 0, 100% ${42 * blockIn}%, 0 ${58 * blockIn}%)` }}>
          <MediaFill media={scene.media} dur={dur} kenBurns="in" />
        </AbsoluteFill>
      ) : (
        <div
          style={{
            position: "absolute",
            width: L.W * 1.6,
            height: L.H * 0.34,
            left: -L.W * 0.3,
            top: L.H * 0.06,
            background: block,
            transform: `rotate(-12deg) translateX(${(1 - blockIn) * -110}%)`,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          right: -40,
          bottom: L.isReel ? 260 : 20,
          fontFamily: FONTS.condensed,
          fontSize: 560,
          lineHeight: 0.8,
          color: rgba(fg, 0.08),
        }}
      >
        {pad2(index + 1)}
      </div>
      <AbsoluteFill style={{ justifyContent: "flex-end", padding: `0 ${L.side - 10}px ${L.isReel ? L.safeBottom + 30 : 150}px` }}>
        <WordReveal
          text={upper}
          kind="rise"
          delay={6}
          stagger={3}
          align="left"
          gap="0 0.2em"
          style={{ fontFamily: FONTS.condensed, fontSize: size, lineHeight: 0.95, color: fg }}
          wordStyle={(i) => (i === 1 ? { color: ensureContrast(block, "#111111", 4.5), background: "#111111", padding: "0 0.1em" } : undefined)}
        />
        {scene.subtext ? (
          <FadeUp delay={18} distance={30}>
            <div style={{ marginTop: 34, display: "inline-block", background: "#111111", color: "#ffffff", fontFamily: FONTS.heavy, fontWeight: 900, fontSize: 40, padding: "16px 26px", textTransform: "uppercase", lineHeight: 1.25 }}>
              {scene.subtext}
            </div>
          </FadeUp>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const bold: StyleDef = {
  meta: STYLE_META["bold"],
  Scene: BoldScene,
  transition: "wipe",
  transitionFrames: 10,
  darkChrome: (pal) => isDark(pal.primary),
  cta: (pal) => ({
    background: pal.primary,
    fg: pal.onPrimary,
    keywordBg: "#111111",
    keywordFg: ensureContrast(pal.accent, "#111111", 4.5),
    headingFont: FONTS.condensed,
    bodyFont: FONTS.heavy,
    radius: 0,
    uppercase: true,
    Decor: ({ pal: p }) => (
      <div style={{ position: "absolute", width: "160%", height: "26%", left: "-30%", top: "8%", background: p.accent, transform: "rotate(-12deg)" }} />
    ),
  }),
};

/* ----------------------------- PAPER ----------------------------- */
const paperBg = (tint: string) =>
  [
    `radial-gradient(circle at 20% 15%, rgba(255,255,255,0.7) 0%, transparent 40%)`,
    `radial-gradient(circle at 80% 85%, rgba(120,90,50,0.10) 0%, transparent 45%)`,
    `repeating-linear-gradient(3deg, rgba(120,100,70,0.035) 0px, rgba(120,100,70,0.035) 2px, transparent 2px, transparent 7px)`,
    `repeating-linear-gradient(-87deg, rgba(120,100,70,0.03) 0px, rgba(120,100,70,0.03) 1px, transparent 1px, transparent 11px)`,
    `linear-gradient(180deg, ${mix("#f4ecdc", tint, 0.06)}, ${mix("#e9dfca", tint, 0.08)})`,
  ].join(",");

const torn = "polygon(0% 6%, 4% 0%, 9% 5%, 15% 1%, 21% 6%, 28% 2%, 34% 7%, 41% 1%, 48% 5%, 55% 0%, 62% 6%, 69% 2%, 75% 7%, 82% 1%, 89% 6%, 95% 2%, 100% 5%, 100% 95%, 96% 100%, 90% 94%, 84% 99%, 77% 95%, 71% 100%, 64% 94%, 57% 99%, 50% 95%, 43% 100%, 36% 94%, 29% 99%, 22% 95%, 15% 100%, 8% 94%, 3% 99%, 0% 95%)";

const Tape: React.FC<{ style: React.CSSProperties }> = ({ style }) => (
  <div style={{ position: "absolute", width: 210, height: 64, background: "rgba(255,248,220,0.72)", boxShadow: "0 2px 6px rgba(0,0,0,0.12)", ...style }} />
);

const PaperScene: React.FC<SceneProps> = ({ scene, index, pal, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const drop = spring({ frame: frame - 4, fps, config: { damping: 11, mass: 0.9 } });
  const rot = (index % 2 ? 1 : -1) * 2.5;
  const strip = isDark(pal.primary) ? pal.primary : darken(pal.primary, 0.35);
  const stripFg = readable(strip, ["#fffaf0", "#111"]);
  const ink = "#2b2118";
  const size = fitText(scene.headline, { maxW: L.innerW - 120, maxH: L.isReel ? 520 : 440, max: 128, min: 54, charW: 0.42, lineH: 1.0 });
  return (
    <AbsoluteFill style={{ background: paperBg(pal.primary) }}>
      <Grain opacity={0.22} seed={11 + index} frequency={0.65} blend="multiply" />
      {scene.media ? (
        <div
          style={{
            position: "absolute",
            left: 120,
            right: 120,
            top: L.isReel ? 280 : 80,
            height: L.isReel ? 640 : 520,
            background: "#fff",
            padding: 22,
            paddingBottom: 70,
            boxShadow: "0 18px 40px rgba(60,40,20,0.25)",
            transform: `rotate(${-rot * 1.2}deg) translateY(${(1 - drop) * -300}px)`,
          }}
        >
          <MediaBox media={scene.media} dur={dur} kenBurns="in" style={{ width: "100%", height: "100%" }} />
          <Tape style={{ top: -26, left: "40%", transform: "rotate(-4deg)" }} />
        </div>
      ) : null}
      <AbsoluteFill style={{ justifyContent: scene.media ? "flex-end" : "center", alignItems: "center", padding: `0 ${L.side}px ${scene.media ? (L.isReel ? L.safeBottom : 120) : L.isReel ? 280 : 0}px` }}>
        <div
          style={{
            position: "relative",
            background: strip,
            clipPath: torn,
            padding: "60px 70px",
            transform: `rotate(${rot}deg) translateY(${(1 - drop) * 400}px)`,
            boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            maxWidth: L.innerW,
          }}
        >
          <div style={{ fontFamily: FONTS.hand, fontWeight: 700, fontSize: size, lineHeight: 1.0, color: stripFg, textAlign: "center", ...urduStyle(scene.headline) }}>{scene.headline}</div>
        </div>
        {scene.subtext ? (
          <FadeUp delay={16} style={{ marginTop: 50, maxWidth: L.innerW - 60 }}>
            <div style={{ fontFamily: FONTS.soft, fontSize: 42, lineHeight: 1.38, color: ink, textAlign: "center", transform: `rotate(${-rot / 2}deg)` }}>
              {scene.subtext}
            </div>
          </FadeUp>
        ) : null}
      </AbsoluteFill>
      {!scene.media ? (
        <>
          <Tape style={{ top: L.isReel ? 420 : 120, left: 60, transform: `rotate(-24deg) scale(${drop})` }} />
          <Tape style={{ bottom: L.isReel ? 640 : 140, right: 50, transform: `rotate(18deg) scale(${drop})` }} />
        </>
      ) : null}
      <div style={{ position: "absolute", left: 70, top: L.isReel ? 190 : 60, fontFamily: FONTS.hand, fontSize: 56, color: ensureContrast(pal.accent, "#efe6d3", 3), transform: "rotate(-6deg)" }}>
        no. {index + 1}
      </div>
    </AbsoluteFill>
  );
};

export const paper: StyleDef = {
  meta: STYLE_META["paper"],
  Scene: PaperScene,
  transition: "slide-up",
  transitionFrames: 12,
  darkChrome: () => false,
  cta: (pal) => ({
    background: paperBg(pal.primary),
    fg: "#2b2118",
    keywordBg: isDark(pal.primary) ? pal.primary : darken(pal.primary, 0.35),
    keywordFg: readable(isDark(pal.primary) ? pal.primary : darken(pal.primary, 0.35), ["#fffaf0", "#111"]),
    headingFont: FONTS.hand,
    bodyFont: FONTS.soft,
    radius: 6,
    Decor: () => <Grain opacity={0.22} seed={5} frequency={0.65} blend="multiply" />,
  }),
};

/* ----------------------------- NEON ----------------------------- */
const NeonScene: React.FC<SceneProps> = ({ scene, index, pal, dur }) => {
  const frame = useCurrentFrame();
  const L = useLayout();
  const glow = ensureContrast(isDark(pal.accent) ? lighten(pal.accent, 0.3) : pal.accent, "#07060d", 7);
  const glow2 = ensureContrast(isDark(pal.primary) ? lighten(pal.primary, 0.4) : pal.primary, "#07060d", 5);
  // flicker on entrance
  const flick = [0, 1, 0.2, 1, 0.5, 1];
  const on = frame < 18 ? flick[Math.floor(frame / 3) % flick.length] : 1;
  const hum = 0.92 + Math.sin(frame / 3) * 0.04;
  const size = fitText(scene.headline.toUpperCase(), { maxW: L.innerW, maxH: L.isReel ? 560 : 520, max: 150, min: 54, charW: 0.48, lineH: 1.05, uppercase: true });
  const gridShift = (frame * 4) % 120;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 30%, ${mix("#07060d", pal.primary, 0.25)} 0%, #07060d 70%)`, overflow: "hidden" }}>
      {scene.media ? (
        <AbsoluteFill style={{ opacity: 0.45 }}>
          <MediaFill media={scene.media} dur={dur} kenBurns="in" filter="grayscale(0.4) contrast(1.2) brightness(0.7)" />
        </AbsoluteFill>
      ) : null}
      {/* synthwave floor */}
      <div style={{ position: "absolute", left: "-50%", right: "-50%", bottom: -100, height: L.H * 0.48, perspective: 600, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: "rotateX(62deg)",
            transformOrigin: "50% 100%",
            backgroundImage: `linear-gradient(${rgba(glow2, 0.7)} 2px, transparent 2px), linear-gradient(90deg, ${rgba(glow2, 0.7)} 2px, transparent 2px)`,
            backgroundSize: "120px 120px",
            backgroundPosition: `0 ${gridShift}px`,
            maskImage: "linear-gradient(to top, black 30%, transparent 100%)",
          }}
        />
      </div>
      <div style={{ position: "absolute", left: "50%", top: L.H * 0.5, width: 640, height: 640, marginLeft: -320, borderRadius: 999, background: `radial-gradient(circle, ${rgba(glow2, 0.35)} 0%, transparent 65%)` }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: `${L.safeTop}px ${L.side}px ${L.isReel ? L.safeBottom : 90}px` }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 30, letterSpacing: 8, color: glow2, textShadow: `0 0 12px ${glow2}`, marginBottom: 40, opacity: on }}>
          // {pad2(index + 1)}
        </div>
        <div
          style={{
            fontFamily: FONTS.heavy,
            fontWeight: 900,
            fontStyle: "italic",
            fontSize: size,
            lineHeight: 1.05,
            textAlign: "center",
            textTransform: "uppercase",
            color: "#ffffff",
            opacity: on * hum,
            textShadow: `0 0 6px #fff, 0 0 18px ${glow}, 0 0 42px ${glow}, 0 0 80px ${glow}`,
            ...urduStyle(scene.headline),
          }}
        >
          {scene.headline}
        </div>
        {scene.subtext ? (
          <FadeUp delay={18}>
            <div
              style={{
                marginTop: 50,
                border: `3px solid ${glow2}`,
                boxShadow: `0 0 18px ${glow2}, inset 0 0 18px ${rgba(glow2, 0.5)}`,
                borderRadius: 18,
                padding: "20px 34px",
                fontFamily: FONTS.grotesk,
                fontSize: 38,
                lineHeight: 1.35,
                color: "#f1f1ff",
                textAlign: "center",
              }}
            >
              {scene.subtext}
            </div>
          </FadeUp>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const neon: StyleDef = {
  meta: STYLE_META["neon"],
  Scene: NeonScene,
  transition: "flash",
  transitionFrames: 10,
  darkChrome: () => true,
  cta: (pal) => {
    const glow = ensureContrast(isDark(pal.accent) ? lighten(pal.accent, 0.3) : pal.accent, "#07060d", 7);
    return {
      background: `radial-gradient(ellipse at 50% 40%, ${mix("#07060d", pal.primary, 0.3)} 0%, #07060d 70%)`,
      fg: "#ffffff",
      keywordBg: glow,
      keywordFg: readable(glow, ["#07060d", "#fff"]),
      headingFont: FONTS.heavy,
      bodyFont: FONTS.grotesk,
      radius: 22,
    };
  },
};

/* ----------------------------- MAGAZINE ----------------------------- */
const MagazineScene: React.FC<SceneProps> = ({ scene, index, total, brand, pal, dur }) => {
  const frame = useCurrentFrame();
  const L = useLayout();
  const paperC = isDark(pal.background) ? "#f5f1ea" : mix(pal.background, "#ffffff", 0.4);
  const ink = "#141414";
  const red = ensureContrast(pal.primary, paperC, 4.5);
  const rule = interpolate(frame, [0, 24], [0, 1], { extrapolateRight: "clamp" });
  const imgH = L.isReel ? 520 : 480;
  const top = L.isReel ? 260 : 130;
  const size = fitText(scene.headline, { maxW: L.innerW, maxH: L.isReel ? 250 : 330, max: 120, min: 50, charW: 0.55, lineH: 1.02 });
  const first = (scene.subtext || "").charAt(0);
  const rest = (scene.subtext || "").slice(1);
  return (
    <AbsoluteFill style={{ background: paperC }}>
      <div style={{ position: "absolute", top: top - 70, left: L.side, right: L.side, display: "flex", justifyContent: "flex-start", fontFamily: FONTS.sans, fontWeight: 600, fontSize: 24, letterSpacing: 4, color: ink, textTransform: "uppercase" }}>
        <span>
          {brand.name} — Issue {pad2(index + 1)}/{pad2(total)}
        </span>
      </div>
      <div style={{ position: "absolute", top: top - 30, left: L.side, height: 3, width: (L.W - L.side * 2) * rule, background: ink }} />
      <div style={{ position: "absolute", top, left: L.side, right: L.side, height: imgH, overflow: "hidden", clipPath: `inset(0 0 ${(1 - rule) * 100}% 0)` }}>
        <MediaFill
          media={scene.media}
          dur={dur}
          kenBurns="out"
          fallback={
            <AbsoluteFill style={{ background: `linear-gradient(135deg, ${pal.primary}, ${mix(pal.primary, pal.secondary, 0.6)})`, alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontFamily: FONTS.didone, fontSize: imgH * 0.9, lineHeight: 1, color: rgba(readable(pal.primary), 0.9), fontStyle: "italic" }}>{index + 1}</div>
            </AbsoluteFill>
          }
        />
      </div>
      <div style={{ position: "absolute", top: top + imgH + 34, left: L.side, right: L.side }}>
        <WordReveal
          text={scene.headline}
          kind="fade"
          delay={8}
          stagger={3}
          align="left"
          gap="0 0.22em"
          style={{ fontFamily: FONTS.didone, fontWeight: 700, fontSize: size, lineHeight: 1.02, color: ink, letterSpacing: -1 }}
          wordStyle={(i) => (i === 0 ? { fontStyle: "italic", color: red } : undefined)}
        />
        {scene.subtext ? (
          <FadeUp delay={22}>
            <div style={{ display: "flex", gap: 24, marginTop: 28, borderTop: `2px solid ${ink}`, paddingTop: 24 }}>
              <div style={{ fontFamily: FONTS.didone, fontSize: 96, lineHeight: 0.8, color: red }}>{first}</div>
              <div style={{ fontFamily: FONTS.serif, fontSize: L.isReel ? 32 : 34, lineHeight: 1.35, color: "#2a2a2a", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{rest}</div>
            </div>
          </FadeUp>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const magazine: StyleDef = {
  meta: STYLE_META["magazine"],
  Scene: MagazineScene,
  transition: "slide-left",
  transitionFrames: 14,
  darkChrome: () => false,
  cta: (pal) => {
    const paperC = isDark(pal.background) ? "#f5f1ea" : mix(pal.background, "#ffffff", 0.4);
    const red = ensureContrast(pal.primary, paperC, 4.5);
    return {
      background: paperC,
      fg: "#141414",
      keywordBg: red,
      keywordFg: readable(red),
      headingFont: FONTS.didone,
      bodyFont: FONTS.sans,
      radius: 0,
      Decor: () => <div style={{ position: "absolute", inset: 50, border: "3px solid #141414" }} />,
    };
  },
};
