// clarity, ember, velocity, story
import React from "react";
import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { StyleDef, SceneProps } from "./types.ts";
import { STYLE_META } from "./meta.ts";
import { MediaFill, MediaBox } from "../components/Media.tsx";
import { Grain, Scrim } from "../components/Brand.tsx";
import { FadeUp, WordReveal } from "../components/Kinetic.tsx";
import { FONTS } from "../lib/fonts.ts";
import { fitText, pad2, urduStyle } from "../lib/text.ts";
import { useLayout } from "../lib/layout.ts";
import { darken, ensureContrast, lighten, mix, readable, rgba, isDark } from "../lib/color.ts";

/* ----------------------------- CLARITY ----------------------------- */
const clarityBg = (bg: string) => (isDark(bg) ? "#fbfbfa" : mix(bg, "#ffffff", 0.55));

const ClarityScene: React.FC<SceneProps> = ({ scene, index, total, pal, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const bg = clarityBg(pal.background);
  const fg = ensureContrast(isDark(pal.text) ? pal.text : "#111111", bg, 10);
  const accent = ensureContrast(pal.primary, bg, 3.5);
  const line = spring({ frame: frame - 4, fps, config: { damping: 200 } });
  const size = fitText(scene.headline, { maxW: L.innerW, maxH: scene.media ? 360 : 520, max: 104, min: 46, charW: 0.55, lineH: 1.12 });
  return (
    <AbsoluteFill style={{ background: bg }}>
      <AbsoluteFill style={{ padding: `${L.safeTop}px ${L.side}px ${L.isReel ? L.safeBottom : 110}px`, justifyContent: "center" }}>
        {scene.media ? (
          <FadeUp distance={20}>
            <MediaBox media={scene.media} dur={dur} kenBurns="in" strength={0.06} style={{ width: "100%", height: L.isReel ? 520 : 440, borderRadius: 28, marginBottom: 56 }} />
          </FadeUp>
        ) : null}
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 36 }}>
          <div style={{ width: 90 * line, height: 6, borderRadius: 3, background: accent }} />
          <FadeUp delay={6} distance={10}>
            <div style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize: 28, color: rgba(fg, 0.55), letterSpacing: 3 }}>
              {pad2(index + 1)} — {pad2(total)}
            </div>
          </FadeUp>
        </div>
        <WordReveal text={scene.headline} kind="fade" delay={6} stagger={2} align="left" gap="0 0.26em" style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize: size, lineHeight: 1.12, color: fg, letterSpacing: -2 }} />
        {scene.subtext ? (
          <FadeUp delay={18} distance={20}>
            <div style={{ marginTop: 36, fontFamily: FONTS.sans, fontWeight: 400, fontSize: 40, lineHeight: 1.45, color: rgba(fg, 0.68) }}>{scene.subtext}</div>
          </FadeUp>
        ) : null}
        {scene.bullets?.length ? (
          <div style={{ marginTop: 34, display: "flex", flexDirection: "column", gap: 18 }}>
            {scene.bullets.slice(0, 5).map((b, i) => (
              <FadeUp key={i} delay={22 + i * 6} distance={16}>
                <div style={{ display: "flex", gap: 18, alignItems: "baseline", fontFamily: FONTS.sans, fontSize: 38, color: fg }}>
                  <span style={{ color: accent, fontWeight: 800 }}>→</span>
                  {b}
                </div>
              </FadeUp>
            ))}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const clarity: StyleDef = {
  meta: STYLE_META["clarity"],
  Scene: ClarityScene,
  transition: "fade",
  transitionFrames: 10,
  darkChrome: () => false,
  cta: (pal) => {
    const bg = clarityBg(pal.background);
    const accent = ensureContrast(pal.primary, bg, 3.5);
    return { background: bg, fg: ensureContrast("#111111", bg, 10), keywordBg: accent, keywordFg: readable(accent), headingFont: FONTS.sans, bodyFont: FONTS.sans, radius: 20 };
  },
};

/* ----------------------------- EMBER ----------------------------- */
const Particles: React.FC<{ count: number; color: string; seed: string }> = ({ count, color, seed }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: count }).map((_, i) => {
        const x0 = random(`${seed}-x-${i}`) * width;
        const speed = 1.5 + random(`${seed}-v-${i}`) * 4;
        const size = 4 + random(`${seed}-s-${i}`) * 12;
        const offset = random(`${seed}-o-${i}`) * height;
        const y = height - ((frame * speed + offset) % (height + 100));
        const x = x0 + Math.sin((frame + i * 20) / 22) * 30;
        const life = y / height;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: 99,
              background: color,
              boxShadow: `0 0 ${size * 2}px ${color}`,
              opacity: 0.25 + life * 0.75,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const emberColors = (pal: { primary: string; accent: string }) => {
  const hot = mix(pal.accent, "#ff7a1a", 0.45);
  const deep = darken(mix(pal.primary, "#5a0e0e", 0.5), 0.45);
  return { hot, deep };
};

const EmberScene: React.FC<SceneProps> = ({ scene, index, pal, dur }) => {
  const frame = useCurrentFrame();
  const L = useLayout();
  const { hot, deep } = emberColors(pal);
  const t = frame / Math.max(1, dur);
  const glowText = ensureContrast(lighten(hot, 0.55), "#1a0505", 8);
  const size = fitText(scene.headline, { maxW: L.innerW, maxH: L.isReel ? 560 : 500, max: 128, min: 50, charW: 0.5, lineH: 1.08 });
  return (
    <AbsoluteFill style={{ background: `linear-gradient(${170 + t * 20}deg, ${deep} 0%, ${mix(deep, hot, 0.35)} 55%, ${hot} 120%)`, overflow: "hidden" }}>
      {scene.media ? (
        <AbsoluteFill style={{ mixBlendMode: "luminosity", opacity: 0.6 }}>
          <MediaFill media={scene.media} dur={dur} kenBurns="in" />
        </AbsoluteFill>
      ) : null}
      <div style={{ position: "absolute", left: "50%", bottom: -L.W * 0.55, width: L.W * 1.6, height: L.W * 1.1, marginLeft: -L.W * 0.8, borderRadius: 9999, background: `radial-gradient(circle, ${rgba(hot, 0.85)} 0%, ${rgba(hot, 0)} 65%)`, filter: "blur(30px)", opacity: 0.8 + Math.sin(frame / 10) * 0.15 }} />
      <Particles count={36} color={lighten(hot, 0.3)} seed={`ember-${index}`} />
      {scene.media ? <Scrim from="both" strength={0.55} color="#1a0505" /> : null}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: `${L.safeTop}px ${L.side}px ${L.isReel ? L.safeBottom : 100}px` }}>
        <WordReveal text={scene.headline} kind="blur" delay={4} stagger={4} style={{ fontFamily: FONTS.display, fontSize: size, lineHeight: 1.08, color: glowText, textShadow: `0 0 30px ${rgba(hot, 0.8)}, 0 4px 20px rgba(0,0,0,0.5)` }} />
        {scene.subtext ? (
          <FadeUp delay={22}>
            <div style={{ marginTop: 44, fontFamily: FONTS.soft, fontStyle: "italic", fontSize: 42, lineHeight: 1.4, color: "#fff3e6", textAlign: "center", textShadow: "0 2px 12px rgba(0,0,0,0.5)" }}>{scene.subtext}</div>
          </FadeUp>
        ) : null}
      </AbsoluteFill>
      <Grain opacity={0.12} seed={30 + index} />
    </AbsoluteFill>
  );
};

export const ember: StyleDef = {
  meta: STYLE_META["ember"],
  Scene: EmberScene,
  transition: "fade",
  transitionFrames: 16,
  darkChrome: () => true,
  cta: (pal) => {
    const { hot, deep } = emberColors(pal);
    const kw = lighten(hot, 0.15);
    return {
      background: `linear-gradient(170deg, ${deep} 0%, ${mix(deep, hot, 0.45)} 100%)`,
      fg: "#fff3e6",
      keywordBg: kw,
      keywordFg: readable(kw, ["#1a0505", "#fff"]),
      headingFont: FONTS.display,
      bodyFont: FONTS.soft,
      radius: 30,
      Decor: () => <Particles count={30} color={lighten(hot, 0.3)} seed="ember-cta" />,
    };
  },
};

/* ----------------------------- VELOCITY ----------------------------- */
const VelocityScene: React.FC<SceneProps> = ({ scene, index, pal, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const dark = "#0a0a0c";
  const hi = ensureContrast(isDark(pal.accent) ? lighten(pal.accent, 0.3) : pal.accent, dark, 6);
  const s = spring({ frame, fps, config: { damping: 16, mass: 0.6 } });
  const dir = index % 2 ? 1 : -1;
  const upper = scene.headline.toUpperCase();
  const size = fitText(upper, { maxW: L.innerW, maxH: L.isReel ? 620 : 520, max: 190, min: 60, charW: 0.46, lineH: 0.98, uppercase: true });
  const blur = (1 - s) * 30;
  return (
    <AbsoluteFill style={{ background: dark, overflow: "hidden" }}>
      {scene.media ? (
        <AbsoluteFill style={{ opacity: 0.6, transform: `translateX(${dir * (1 - s) * 30}%)`, filter: `blur(${blur * 0.5}px)` }}>
          <MediaFill media={scene.media} dur={dur} kenBurns={dir > 0 ? "pan-left" : "pan-right"} strength={0.2} />
        </AbsoluteFill>
      ) : null}
      {/* speed lines */}
      {Array.from({ length: 22 }).map((_, i) => {
        const y = random(`vy-${index}-${i}`) * L.H;
        const len = 200 + random(`vl-${i}`) * 700;
        const sp = 40 + random(`vs-${i}`) * 50;
        const x = ((frame * sp + random(`vx-${i}`) * 3000) % (L.W + len * 2)) - len;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: y,
              left: dir > 0 ? L.W - x : x,
              width: len,
              height: 3 + random(`vh-${i}`) * 5,
              background: `linear-gradient(90deg, transparent, ${i % 4 === 0 ? hi : "rgba(255,255,255,0.5)"}, transparent)`,
              opacity: 0.6,
            }}
          />
        );
      })}
      <div style={{ position: "absolute", left: -100, right: -100, top: L.H * 0.33, height: L.H * 0.3, background: hi, transform: `skewY(-8deg) translateX(${dir * (1 - s) * 120}%)`, opacity: 0.95 }} />
      <AbsoluteFill style={{ justifyContent: "center", padding: `${L.safeTop}px ${L.side}px ${L.isReel ? L.safeBottom : 90}px` }}>
        <div style={{ transform: `skewX(-10deg) translateX(${dir * (1 - s) * -600}px)`, filter: `blur(${blur}px)` }}>
          <div style={{ fontFamily: FONTS.condensed, fontSize: size, lineHeight: 0.98, color: "#ffffff", textShadow: `${-dir * 18}px 0 0 ${rgba(hi, 0.0)}`, WebkitTextStroke: `8px ${dark}`, paintOrder: "stroke fill", filter: "drop-shadow(0 6px 0 rgba(0,0,0,0.6))", ...urduStyle(upper) }}>
            {upper}
          </div>
        </div>
        {scene.subtext ? (
          <FadeUp delay={12} distance={20}>
            <div style={{ marginTop: 40, fontFamily: FONTS.heavy, fontStyle: "italic", fontWeight: 900, fontSize: 42, color: "#fff", background: dark, display: "inline-block", padding: "14px 24px", transform: "skewX(-10deg)", borderLeft: `10px solid ${hi}` }}>
              {scene.subtext}
            </div>
          </FadeUp>
        ) : null}
      </AbsoluteFill>
      <div style={{ position: "absolute", left: L.side, top: L.isReel ? 270 : 50, fontFamily: FONTS.mono, fontWeight: 700, fontSize: 30, color: hi }}>
        {`>> ${pad2(index + 1)}`}
      </div>
    </AbsoluteFill>
  );
};

export const velocity: StyleDef = {
  meta: STYLE_META["velocity"],
  Scene: VelocityScene,
  transition: "whip",
  transitionFrames: 9,
  darkChrome: () => true,
  cta: (pal) => {
    const hi = ensureContrast(isDark(pal.accent) ? lighten(pal.accent, 0.3) : pal.accent, "#0a0a0c", 6);
    return { background: "#0a0a0c", fg: "#ffffff", keywordBg: hi, keywordFg: readable(hi, ["#0a0a0c", "#fff"]), headingFont: FONTS.condensed, bodyFont: FONTS.heavy, radius: 0, uppercase: true };
  },
};

/* ----------------------------- STORY ----------------------------- */
const storyBg = (pal: { primary: string; secondary: string; background: string }) => {
  const base = isDark(pal.background) ? "#f7efe6" : mix(pal.background, "#fff6ec", 0.5);
  return { base, blobA: mix(pal.primary, "#ffffff", 0.55), blobB: mix(pal.secondary, "#ffd9b8", 0.5) };
};

const StoryScene: React.FC<SceneProps> = ({ scene, index, pal, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const { base, blobA, blobB } = storyBg(pal);
  const ink = "#3a2a22";
  const accent = ensureContrast(pal.primary, "#ffffff", 3);
  const card = spring({ frame: frame - 2, fps, config: { damping: 18, mass: 1 } });
  const t = frame / fps;
  const size = fitText(scene.headline, { maxW: L.innerW - 140, maxH: L.isReel ? 460 : 400, max: 92, min: 44, charW: 0.5, lineH: 1.2 });
  return (
    <AbsoluteFill style={{ background: base, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 900, height: 900, borderRadius: 999, background: blobA, filter: "blur(90px)", left: -300 + Math.sin(t * 0.6) * 60, top: -200 + Math.cos(t * 0.5) * 60, opacity: 0.85 }} />
      <div style={{ position: "absolute", width: 800, height: 800, borderRadius: 999, background: blobB, filter: "blur(90px)", right: -280 + Math.cos(t * 0.7) * 60, bottom: 100 + Math.sin(t * 0.4) * 60, opacity: 0.85 }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: `${L.safeTop - 40}px ${L.side - 20}px ${L.isReel ? L.safeBottom - 40 : 90}px` }}>
        <div
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.86)",
            borderRadius: 48,
            padding: scene.media ? "40px 50px 60px" : "80px 70px",
            boxShadow: "0 30px 80px rgba(80,50,30,0.18)",
            transform: `translateY(${(1 - card) * 120}px) rotate(${(1 - card) * (index % 2 ? 3 : -3)}deg)`,
            opacity: card,
          }}
        >
          {scene.media ? <MediaBox media={scene.media} dur={dur} kenBurns="in" strength={0.08} style={{ width: "100%", height: L.isReel ? 460 : 340, borderRadius: 30, marginBottom: 40 }} /> : null}
          <div style={{ fontFamily: FONTS.soft, fontSize: 200, lineHeight: 0.6, height: 90, color: accent }}>“</div>
          <WordReveal text={scene.headline} kind="fade" delay={10} stagger={2} align="left" gap="0 0.24em" style={{ fontFamily: FONTS.soft, fontStyle: "italic", fontSize: size, lineHeight: 1.2, color: ink }} />
          {scene.subtext ? (
            <FadeUp delay={24} distance={16}>
              <div style={{ marginTop: 34, display: "flex", alignItems: "center", gap: 18 }}>
                <div style={{ width: 50, height: 4, background: accent, borderRadius: 2 }} />
                <div style={{ fontFamily: FONTS.sans, fontSize: 34, lineHeight: 1.4, color: rgba(ink, 0.8) }}>{scene.subtext}</div>
              </div>
            </FadeUp>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const story: StyleDef = {
  meta: STYLE_META["story"],
  Scene: StoryScene,
  transition: "slide-up",
  transitionFrames: 16,
  darkChrome: () => false,
  cta: (pal) => {
    const { base, blobA } = storyBg(pal);
    const accent = ensureContrast(pal.primary, "#ffffff", 3);
    return {
      background: `radial-gradient(circle at 30% 20%, ${blobA} 0%, ${base} 60%)`,
      fg: "#3a2a22",
      keywordBg: accent,
      keywordFg: readable(accent),
      headingFont: FONTS.soft,
      bodyFont: FONTS.sans,
      radius: 40,
    };
  },
};

void interpolate;
