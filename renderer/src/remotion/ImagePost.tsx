// Single-image feed posts (4:5, 1080x1350): eight branded designs rendered as one Remotion still.
// Each design reuses the chosen reel/carousel style's end-card theme (background, fonts, accent chip, decoration)
// so image posts match the brand's reels and carousels. Everything is static (frame 0): no entrance animations.
import React, { useState } from "react";
import { AbsoluteFill, Composition, Img, type CalculateMetadataFunction } from "remotion";
import type { ImageSpec, MediaRef } from "../../../shared/types.ts";
import { getStyle } from "./styles/index.ts";
import { makePalette, isDark, rgba, ensureContrast, mix, readable, type Palette } from "./lib/color.ts";
import { fitText, isUrdu, urduStyle, initials } from "./lib/text.ts";
import { FONTS, loadUrduFonts } from "./lib/fonts.ts";
import { BrandMark } from "./components/Brand.tsx";
import { PersianCard, pickPersianVariant } from "./persian/PersianArt.tsx";

export interface ImagePostProps {
  spec: ImageSpec;
  [key: string]: unknown;
}

const M = 84; // side margin (safe for the 3:4 profile-grid crop)

interface Theme {
  background: string;
  fg: string;
  muted: string;
  accent: string;
  onAccent: string;
  heading: string;
  body: string;
  radius: number;
  uppercase: boolean;
  dark: boolean;
  card: string;
  cardFg: string;
  cardMuted: string;
  line: string;
  Decor?: React.FC<{ pal: Palette }>;
  headingWeight: number;
}

function themeFor(spec: ImageSpec, pal: Palette): Theme {
  const st = getStyle(spec.style || "clarity");
  const t = st.cta(pal);
  const dark = !isDark(t.fg); // light text → dark background
  const card = dark ? "rgba(255,255,255,0.09)" : "#ffffff";
  const cardFg = dark ? t.fg : ensureContrast(pal.text, "#ffffff", 7);
  const serif = /Playfair|Bodoni|DM Serif|Fraunces/.test(t.headingFont);
  return {
    background: t.background,
    fg: t.fg,
    muted: rgba(t.fg, 0.74),
    accent: t.keywordBg,
    onAccent: t.keywordFg,
    heading: t.headingFont,
    body: t.bodyFont,
    radius: Math.min(36, Math.max(0, t.radius)),
    uppercase: !!t.uppercase,
    dark,
    card,
    cardFg,
    cardMuted: rgba(cardFg, 0.7),
    line: rgba(t.fg, dark ? 0.22 : 0.16),
    Decor: t.Decor,
    headingWeight: serif ? 700 : /Anton|Bebas|Caveat|Permanent/.test(t.headingFont) ? 400 : 800,
  };
}

/** Average glyph width (fraction of font size) per heading font, with a little safety margin. */
function charW(font: string): number {
  if (/Anton|Bebas/.test(font)) return 0.46;
  if (/Montserrat/.test(font)) return 0.64;
  if (/Caveat|Permanent/.test(font)) return 0.5;
  if (/Playfair|Bodoni|DM Serif|Fraunces/.test(font)) return 0.53;
  if (/JetBrains/.test(font)) return 0.62;
  return 0.57;
}

const fit = (text: string, font: string, maxW: number, maxH: number, max: number, min = 30, uppercase = false, lineH = 1.12) =>
  fitText(text, { maxW, maxH, max, min, charW: charW(font), lineH, uppercase });

// ---------------------------------------------------------------- small pieces

const Photo: React.FC<{ media?: MediaRef; style?: React.CSSProperties; fallback: React.ReactNode }> = ({ media, style, fallback }) => {
  const [failed, setFailed] = useState(false);
  if (!media?.src || media.kind !== "image" || failed) return <>{fallback}</>;
  return (
    <Img
      src={media.src}
      maxRetries={1}
      delayRenderTimeoutInMilliseconds={20000}
      onError={() => setFailed(true)}
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", ...style }}
    />
  );
};

const Text: React.FC<{ text: string; font: string; size: number; color: string; weight?: number; upper?: boolean; lh?: number; style?: React.CSSProperties }> = ({
  text,
  font,
  size,
  color,
  weight = 800,
  upper,
  lh = 1.1,
  style,
}) => (
  <div
    style={{
      fontFamily: font,
      fontSize: size,
      fontWeight: weight,
      color,
      lineHeight: lh,
      textTransform: upper ? "uppercase" : "none",
      overflowWrap: "break-word",
      ...style,
      ...urduStyle(text),
    }}
  >
    {text}
  </div>
);

const Pill: React.FC<{ text: string; th: Theme; bg?: string; fg?: string; size?: number }> = ({ text, th, bg, fg, size = 28 }) => (
  <div
    style={{
      alignSelf: "flex-start",
      display: "inline-flex",
      background: bg ?? th.accent,
      color: fg ?? th.onAccent,
      fontFamily: th.body,
      fontWeight: 800,
      fontSize: size,
      letterSpacing: isUrdu(text) ? 0 : 3,
      textTransform: isUrdu(text) ? "none" : "uppercase",
      padding: `${size * 0.36}px ${size * 0.8}px`,
      borderRadius: th.radius >= 14 ? 999 : th.radius,
      lineHeight: isUrdu(text) ? 1.9 : 1.15,
      whiteSpace: "nowrap",
      maxWidth: 1080 - 2 * M,
      overflow: "hidden",
    }}
  >
    {text}
  </div>
);

const Header: React.FC<{ spec: ImageSpec; pal: Palette; th: Theme; color?: string }> = ({ spec, pal, th, color }) => {
  const label = spec.brand.handle || spec.brand.name;
  return (
    <div style={{ position: "absolute", top: 60, left: M, right: M, display: "flex", alignItems: "center", gap: 18, zIndex: 5 }}>
      <BrandMark brand={spec.brand} pal={pal} size={68} ring={th.dark} />
      <div style={{ fontFamily: th.body, fontWeight: 700, fontSize: 30, color: color ?? th.fg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...urduStyle(label, 1.6) }}>
        {label}
      </div>
    </div>
  );
};

const Arrow: React.FC<{ color: string; size?: number; flip?: boolean }> = ({ color, size = 34, flip }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, transform: flip ? "scaleX(-1)" : undefined }}>
    <path d="M4 12h15M13 6l6 6-6 6" stroke={color} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Footer: React.FC<{ spec: ImageSpec; th: Theme; color?: string }> = ({ spec, th, color }) => {
  const text = spec.cta?.trim();
  if (!text) return null;
  const c = color ?? th.fg;
  const size = fit(text, th.body, 1080 - 2 * M - 60, 50, 34, 22);
  const rtl = isUrdu(text);
  return (
    <div style={{ position: "absolute", bottom: 58, left: M, right: M, display: "flex", alignItems: "center", gap: 14, zIndex: 5, flexDirection: rtl ? "row-reverse" : "row" }}>
      <div style={{ fontFamily: th.body, fontWeight: 700, fontSize: size, color: c, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...urduStyle(text, 1.7) }}>{text}</div>
      <Arrow color={c} flip={rtl} />
    </div>
  );
};

const Stars: React.FC<{ n: number; color: string; size?: number }> = ({ n, color, size = 46 }) => (
  <div style={{ display: "flex", gap: 8 }}>
    {Array.from({ length: 5 }, (_, i) => (
      <svg key={i} width={size} height={size} viewBox="0 0 24 24">
        <path
          d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.3l-5.8 3.1 1.2-6.5L2.6 9.4l6.5-.8z"
          fill={i < n ? color : "none"}
          stroke={color}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ))}
  </div>
);

const Button: React.FC<{ text: string; th: Theme; size?: number }> = ({ text, th, size = 34 }) => (
  <div
    style={{
      background: th.accent,
      color: th.onAccent,
      fontFamily: th.body,
      fontWeight: 800,
      fontSize: size,
      padding: `${size * 0.55}px ${size * 1.1}px`,
      borderRadius: th.radius >= 14 ? 999 : th.radius,
      whiteSpace: "nowrap",
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      boxShadow: "0 14px 34px rgba(0,0,0,0.18)",
      ...urduStyle(text, 1.7),
    }}
  >
    {text}
    <Arrow color={th.onAccent} size={size} flip={isUrdu(text)} />
  </div>
);

// content box between header and footer
const TOP = 170;
const BOTTOM = 140;
const CW = 1080 - 2 * M;

const Content: React.FC<{ children: React.ReactNode; justify?: React.CSSProperties["justifyContent"]; rtl?: boolean; gap?: number }> = ({ children, justify = "center", rtl, gap = 34 }) => (
  <div
    style={{
      position: "absolute",
      top: TOP,
      bottom: BOTTOM,
      left: M,
      right: M,
      display: "flex",
      flexDirection: "column",
      justifyContent: justify,
      alignItems: "flex-start", // with direction rtl, flex-start = right
      textAlign: rtl ? "right" : "left",
      direction: rtl ? "rtl" : "ltr",
      gap,
      zIndex: 4,
    }}
  >
    {children}
  </div>
);

// ---------------------------------------------------------------- designs

type DesignProps = { spec: ImageSpec; pal: Palette; th: Theme; rtl: boolean };

const QuoteDesign: React.FC<DesignProps> = ({ spec, th, rtl }) => {
  const size = fit(spec.headline, th.heading, CW, 620, 96, 40, th.uppercase);
  return (
    <Content rtl={rtl} gap={26}>
      <div style={{ fontFamily: FONTS.serif, fontWeight: 700, fontSize: 280, lineHeight: 0.62, height: 150, color: th.accent, marginBottom: -10 }}>{rtl ? "”" : "“"}</div>
      <Text text={spec.headline} font={th.heading} size={size} color={th.fg} weight={th.headingWeight} upper={th.uppercase} lh={1.12} />
      {spec.author ? (
        <div style={{ display: "flex", alignItems: "center", gap: 22, marginTop: 14 }}>
          <div style={{ width: 70, height: 6, background: th.accent, borderRadius: 3 }} />
          <Text text={spec.author} font={th.body} size={36} color={th.muted} weight={600} />
        </div>
      ) : null}
    </Content>
  );
};

const TipDesign: React.FC<DesignProps> = ({ spec, th, rtl }) => {
  const bullets = (spec.bullets ?? []).filter(Boolean).slice(0, 4);
  const headMax = bullets.length ? 300 : 520;
  const size = fit(spec.headline, th.heading, CW, headMax, bullets.length ? 84 : 104, 40, th.uppercase);
  const rowH = bullets.length ? Math.min(150, (1350 - TOP - BOTTOM - headMax - 140) / bullets.length) : 0;
  return (
    <Content rtl={rtl} gap={30}>
      <Pill text={spec.eyebrow || "Tip"} th={th} />
      <Text text={spec.headline} font={th.heading} size={size} color={th.fg} weight={th.headingWeight} upper={th.uppercase} lh={1.08} />
      {bullets.length ? (
        <div style={{ width: "100%", background: th.card, borderRadius: Math.max(18, th.radius), padding: "26px 34px", display: "flex", flexDirection: "column", boxShadow: th.dark ? "none" : "0 18px 50px rgba(0,0,0,0.10)" }}>
          {bullets.map((b, i) => {
            const bs = fit(b, th.body, CW - 68 - 96, rowH - 24, 40, 24);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 26, minHeight: rowH, borderTop: i ? `2px solid ${rgba(th.cardFg, 0.1)}` : "none" }}>
                <div style={{ width: 64, height: 64, borderRadius: 32, background: th.accent, color: th.onAccent, fontFamily: th.body, fontWeight: 800, fontSize: 32, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {i + 1}
                </div>
                <Text text={b} font={th.body} size={bs} color={th.cardFg} weight={600} lh={1.22} />
              </div>
            );
          })}
        </div>
      ) : spec.body ? (
        <Text text={spec.body} font={th.body} size={fit(spec.body, th.body, CW, 300, 42, 26)} color={th.muted} weight={500} lh={1.35} />
      ) : null}
    </Content>
  );
};

const PricePair: React.FC<{ spec: ImageSpec; th: Theme; color: string; size?: number }> = ({ spec, th, color, size = 76 }) =>
  spec.price ? (
    <div style={{ display: "flex", alignItems: "baseline", gap: 22 }}>
      <div style={{ fontFamily: th.heading, fontWeight: th.headingWeight, fontSize: size, color, lineHeight: 1 }}>{spec.price}</div>
      {spec.oldPrice ? (
        <div style={{ fontFamily: th.body, fontWeight: 600, fontSize: size * 0.48, color: rgba(color, 0.6), textDecoration: "line-through" }}>{spec.oldPrice}</div>
      ) : null}
    </div>
  ) : null;

const ProductDesign: React.FC<DesignProps> = ({ spec, pal, th, rtl }) => {
  const panelH = 600;
  const nameSize = fit(spec.headline, th.heading, CW, 170, 78, 36, th.uppercase);
  const fallback = (
    <div style={{ width: "100%", height: "100%", background: `linear-gradient(135deg, ${pal.primary}, ${mix(pal.primary, pal.secondary, 0.7)})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <BrandMark brand={spec.brand} pal={pal} size={220} />
    </div>
  );
  return (
    <Content rtl={rtl} justify="flex-start" gap={26}>
      <div style={{ position: "relative", width: "100%", height: panelH, borderRadius: Math.max(20, th.radius), overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.22)", flexShrink: 0 }}>
        <Photo media={spec.media} fallback={fallback} />
        {spec.badge ? (
          <div style={{ position: "absolute", top: 26, [rtl ? "right" : "left"]: 26 }}>
            <Pill text={spec.badge} th={th} size={26} />
          </div>
        ) : null}
      </div>
      {spec.eyebrow ? <Text text={spec.eyebrow} font={th.body} size={28} color={th.muted} weight={700} upper style={{ letterSpacing: isUrdu(spec.eyebrow) ? 0 : 3 }} /> : null}
      <Text text={spec.headline} font={th.heading} size={nameSize} color={th.fg} weight={th.headingWeight} upper={th.uppercase} lh={1.06} />
      {spec.body ? <Text text={spec.body} font={th.body} size={fit(spec.body, th.body, CW, 92, 34, 24)} color={th.muted} weight={500} lh={1.3} /> : null}
      <div style={{ marginTop: "auto", width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
        <PricePair spec={spec} th={th} color={th.fg} size={70} />
        {spec.cta ? <Button text={spec.cta} th={th} size={30} /> : null}
      </div>
    </Content>
  );
};

const Burst: React.FC<{ text: string; th: Theme; d?: number }> = ({ text, th, d = 300 }) => {
  const pts = 18;
  const path = Array.from({ length: pts * 2 }, (_, i) => {
    const r = i % 2 ? 0.86 : 1;
    const a = (Math.PI * i) / pts;
    return `${50 + 50 * r * Math.cos(a)},${50 + 50 * r * Math.sin(a)}`;
  }).join(" ");
  const words = text.split(/\s+/);
  const size = fitText(text, { maxW: d * 0.62, maxH: d * 0.5, max: 92, min: 26, charW: charW(th.heading), lineH: 1.0, uppercase: true });
  return (
    <div style={{ position: "relative", width: d, height: d, transform: "rotate(-10deg)", flexShrink: 0 }}>
      <svg width={d} height={d} viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, filter: "drop-shadow(0 14px 24px rgba(0,0,0,0.25))" }}>
        <polygon points={path} fill={th.accent} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontFamily: th.heading, fontWeight: th.headingWeight, fontSize: size, lineHeight: 1, color: th.onAccent, textTransform: isUrdu(text) ? "none" : "uppercase", padding: d * 0.18, ...urduStyle(text, 1.6) }}>
        {words.length > 1 ? text : text}
      </div>
    </div>
  );
};

const OfferDesign: React.FC<DesignProps> = ({ spec, th, rtl }) => {
  const hasPhoto = spec.media?.kind === "image";
  const fg = hasPhoto ? "#ffffff" : th.fg;
  const muted = hasPhoto ? "rgba(255,255,255,0.86)" : th.muted;
  const hs = fit(spec.headline, th.heading, CW, spec.badge ? 400 : 520, 124, 44, th.uppercase, 1.04);
  return (
    <>
      {hasPhoto ? (
        <AbsoluteFill>
          <Photo media={spec.media} fallback={null} />
          <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.35) 100%)" }} />
        </AbsoluteFill>
      ) : null}
      {spec.badge ? (
        <div style={{ position: "absolute", top: 150, [rtl ? "left" : "right"]: M - 20, zIndex: 6 }}>
          <Burst text={spec.badge} th={th} d={300} />
        </div>
      ) : null}
      <Content rtl={rtl} justify="flex-end" gap={28}>
        {spec.eyebrow ? <Pill text={spec.eyebrow} th={th} bg={hasPhoto ? "rgba(255,255,255,0.16)" : rgba(th.fg, 0.08)} fg={fg} /> : null}
        <Text text={spec.headline} font={th.heading} size={hs} color={fg} weight={th.headingWeight} upper={th.uppercase} lh={1.04} />
        {spec.body ? <Text text={spec.body} font={th.body} size={fit(spec.body, th.body, CW, 130, 40, 24)} color={muted} weight={500} lh={1.3} /> : null}
        <PricePair spec={spec} th={th} color={fg} size={88} />
        {spec.cta ? <Button text={spec.cta} th={th} size={34} /> : null}
      </Content>
    </>
  );
};

const TestimonialDesign: React.FC<DesignProps> = ({ spec, pal, th, rtl }) => {
  const starC = ensureContrast(th.accent, th.dark ? "#202020" : "#ffffff", 2.4);
  const qs = fit(spec.headline, th.heading, CW - 100, 470, 66, 30, false, 1.22);
  const name = spec.author || "Happy customer";
  return (
    <Content rtl={rtl} gap={30}>
      {spec.eyebrow ? <Pill text={spec.eyebrow} th={th} /> : null}
      <div style={{ width: "100%", background: th.card, borderRadius: Math.max(24, th.radius), padding: "54px 50px", boxShadow: th.dark ? "none" : "0 24px 70px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: 30, alignItems: "flex-start" }}>
        <Stars n={Math.max(1, Math.min(5, Math.round(spec.rating ?? 5)))} color={starC} />
        <Text text={`“${spec.headline}”`} font={th.heading} size={qs} color={th.cardFg} weight={th.headingWeight === 400 ? 400 : 600} lh={1.22} />
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 76, height: 76, borderRadius: 38, background: pal.primary, color: pal.onPrimary, fontFamily: th.body, fontWeight: 800, fontSize: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {initials(name)}
          </div>
          <div>
            <Text text={name} font={th.body} size={32} color={th.cardFg} weight={700} lh={1.2} />
            {spec.body ? <Text text={spec.body} font={th.body} size={26} color={th.cardMuted} weight={500} lh={1.3} /> : null}
          </div>
        </div>
      </div>
    </Content>
  );
};

const QuestionDesign: React.FC<DesignProps> = ({ spec, th, rtl }) => {
  const opts = (spec.options?.length ? spec.options : [{ label: "A", text: "Option A" }, { label: "B", text: "Option B" }]).slice(0, 3);
  const anyPhoto = opts.some((o) => o.media?.kind === "image");
  const gap = 24;
  const tileW = (CW - gap * (opts.length - 1)) / opts.length;
  const tileH = anyPhoto ? 560 : 430;
  const hs = fit(spec.headline, th.heading, CW, 1350 - TOP - BOTTOM - tileH - 150, 92, 40, th.uppercase, 1.08);
  return (
    <Content rtl={rtl} gap={34}>
      <Pill text={spec.eyebrow || "Your turn"} th={th} />
      <Text text={spec.headline} font={th.heading} size={hs} color={th.fg} weight={th.headingWeight} upper={th.uppercase} lh={1.08} />
      <div style={{ display: "flex", gap, width: "100%" }}>
        {opts.map((o, i) => {
          const ts = fit(o.text, th.body, tileW - 50, anyPhoto ? 120 : 220, 46, 24, false, 1.2);
          return (
            <div key={i} style={{ width: tileW, height: tileH, background: th.card, borderRadius: Math.max(20, th.radius), overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: th.dark ? "none" : "0 18px 44px rgba(0,0,0,0.12)", border: th.dark ? `2px solid ${rgba(th.fg, 0.14)}` : "none" }}>
              {anyPhoto ? (
                <div style={{ height: tileH * 0.62, position: "relative", background: rgba(th.cardFg, 0.06) }}>
                  <Photo media={o.media} fallback={null} />
                </div>
              ) : null}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 24, textAlign: "center" }}>
                <div style={{ width: 92, height: 92, borderRadius: 46, background: th.accent, color: th.onAccent, fontFamily: th.heading, fontWeight: th.headingWeight, fontSize: 50, display: "flex", alignItems: "center", justifyContent: "center", marginTop: anyPhoto ? -70 : 0, boxShadow: "0 8px 20px rgba(0,0,0,0.2)", flexShrink: 0, ...urduStyle(o.label, 1.4) }}>
                  {o.label || String.fromCharCode(65 + i)}
                </div>
                <Text text={o.text} font={th.body} size={ts} color={th.cardFg} weight={700} lh={1.2} style={{ textAlign: "center" }} />
              </div>
            </div>
          );
        })}
      </div>
    </Content>
  );
};

const BeforeAfterDesign: React.FC<DesignProps> = ({ spec, pal, th, rtl }) => {
  const o = spec.options ?? [];
  const before = o[0] ?? { label: "Before", text: "" };
  const after = o[1] ?? { label: "After", text: "" };
  const gap = 28;
  const pw = (CW - gap) / 2;
  const ph = 620;
  const hs = fit(spec.headline, th.heading, CW, 230, 84, 36, th.uppercase, 1.06);
  const panel = (x: typeof before, isAfter: boolean) => {
    const bg = isAfter ? th.accent : th.dark ? "rgba(255,255,255,0.1)" : mix("#ffffff", pal.text, 0.07);
    const fg = isAfter ? th.onAccent : th.dark ? th.fg : readable(bg);
    const label = x.label || (isAfter ? "After" : "Before");
    const hasPhoto = x.media?.kind === "image";
    return (
      <div style={{ width: pw, height: ph, borderRadius: Math.max(20, th.radius), overflow: "hidden", position: "relative", background: bg, boxShadow: th.dark ? "none" : "0 18px 44px rgba(0,0,0,0.12)" }}>
        {hasPhoto ? (
          <>
            <Photo media={x.media} fallback={null} style={{ filter: isAfter ? undefined : "saturate(0.55)" }} />
            <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0) 55%)" }} />
          </>
        ) : null}
        <div style={{ position: "absolute", top: 24, left: 24, right: 24, display: "flex", justifyContent: "flex-start" }}>
          <Pill text={label} th={th} size={24} bg={isAfter ? (hasPhoto ? th.accent : "rgba(0,0,0,0.18)") : "rgba(0,0,0,0.55)"} fg={isAfter ? (hasPhoto ? th.onAccent : fg) : "#ffffff"} />
        </div>
        {x.text ? (
          <div style={{ position: "absolute", left: 34, right: 34, [isAfter !== rtl ? "left" : "right"]: 64, bottom: 34, top: hasPhoto ? undefined : 110, display: "flex", alignItems: hasPhoto ? "flex-end" : "center" }}>
            <Text text={x.text} font={hasPhoto ? th.body : th.heading} size={fit(x.text, hasPhoto ? th.body : th.heading, pw - 98, hasPhoto ? 170 : 420, hasPhoto ? 40 : 60, 24, false, 1.15)} color={hasPhoto ? "#ffffff" : fg} weight={hasPhoto ? 700 : th.headingWeight} lh={1.15} />
          </div>
        ) : null}
      </div>
    );
  };
  return (
    <Content rtl={rtl} gap={34}>
      {spec.eyebrow ? <Pill text={spec.eyebrow} th={th} /> : null}
      <Text text={spec.headline} font={th.heading} size={hs} color={th.fg} weight={th.headingWeight} upper={th.uppercase} lh={1.06} />
      <div style={{ position: "relative", display: "flex", gap }}>
        {panel(before, false)}
        {panel(after, true)}
        <div style={{ position: "absolute", left: "50%", top: ph / 2, transform: "translate(-50%,-50%)", width: 84, height: 84, borderRadius: 42, background: th.dark ? "#ffffff" : pal.text, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 26px rgba(0,0,0,0.3)" }}>
          <Arrow color={th.dark ? "#111111" : "#ffffff"} size={44} flip={rtl} />
        </div>
      </div>
    </Content>
  );
};

const FactDesign: React.FC<DesignProps> = ({ spec, th, rtl }) => {
  const hs = fit(spec.headline, th.heading, CW, spec.body ? 520 : 700, 132, 44, th.uppercase, 1.04);
  return (
    <>
      <div style={{ position: "absolute", [rtl ? "left" : "right"]: -30, bottom: 60, fontFamily: FONTS.serif, fontWeight: 700, fontSize: 760, lineHeight: 1, color: rgba(th.fg, th.dark ? 0.07 : 0.05), zIndex: 1 }}>?</div>
      <Content rtl={rtl} gap={32}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
            <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z" stroke={th.accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <Pill text={spec.eyebrow || "Did you know?"} th={th} />
        </div>
        <Text text={spec.headline} font={th.heading} size={hs} color={th.fg} weight={th.headingWeight} upper={th.uppercase} lh={1.04} />
        <div style={{ width: 120, height: 10, background: th.accent, borderRadius: 5 }} />
        {spec.body ? <Text text={spec.body} font={th.body} size={fit(spec.body, th.body, CW, 220, 42, 26, false, 1.35)} color={th.muted} weight={500} lh={1.35} /> : null}
      </Content>
    </>
  );
};

const DESIGNS: Record<string, React.FC<DesignProps>> = {
  quote: QuoteDesign,
  tip: TipDesign,
  product: ProductDesign,
  offer: OfferDesign,
  testimonial: TestimonialDesign,
  question: QuestionDesign,
  "before-after": BeforeAfterDesign,
  fact: FactDesign,
};

export const ImagePost: React.FC<ImagePostProps> = ({ spec }) => {
  useState(() => {
    if (isUrdu(JSON.stringify(spec ?? {}))) loadUrduFonts(spec.language, JSON.stringify(spec ?? {}));
    return null;
  });
  const pal = makePalette(spec.brand?.colors);
  if (spec.style === "persian") {
    const lang = spec.language ?? "";
    const factEyebrow = /^ar/.test(lang) ? "هل تعلم؟" : /^ur/.test(lang) ? "کیا آپ جانتے ہیں؟" : "Did you know?";
    return (
      <PersianCard
        W={spec.width || 1080}
        H={spec.height || 1350}
        pal={pal}
        brand={spec.brand}
        variant={pickPersianVariant(spec.variant, spec.headline)}
        eyebrow={spec.eyebrow ?? (spec.design === "fact" ? factEyebrow : undefined)}
        title={spec.headline}
        body={spec.design === "testimonial" && spec.author ? `${spec.body ? spec.body + " — " : "— "}${spec.author}` : spec.body}
        bullets={spec.bullets ?? (spec.options?.length ? spec.options.map((o) => `${o.label}: ${o.text}`) : undefined)}
        cta={spec.cta}
        badge={spec.badge}
        price={spec.price}
        media={spec.media}
      />
    );
  }
  const th = themeFor(spec, pal);
  const Design = DESIGNS[spec.design] ?? TipDesign;
  const rtl = isUrdu(spec.headline);
  const photoBg = spec.design === "offer" && spec.media?.kind === "image";
  const { Decor } = th;
  return (
    <AbsoluteFill style={{ background: th.background, overflow: "hidden" }}>
      {Decor && !photoBg ? (
        <AbsoluteFill style={{ opacity: 0.55 }}>
          <Decor pal={pal} />
        </AbsoluteFill>
      ) : null}
      <Design spec={spec} pal={pal} th={th} rtl={rtl} />
      <Header spec={spec} pal={pal} th={th} color={photoBg ? "#ffffff" : undefined} />
      {spec.design === "product" || (spec.design === "offer" && spec.cta) ? null : <Footer spec={spec} th={th} color={photoBg ? "#ffffff" : undefined} />}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- composition (registered from Root.tsx)

export const SAMPLE_IMAGE: ImageSpec = {
  kind: "image",
  width: 1080,
  height: 1350,
  design: "tip",
  style: "clarity",
  brand: { name: "Luna & Thread", handle: "@lunaandthread", colors: { primary: "#7A3E48", secondary: "#D9A5A0", accent: "#E8B04B", background: "#FBF6F0", text: "#2B1D1F" } },
  eyebrow: "Care tip",
  headline: "Keep silver shining for years",
  bullets: ["Store each piece in its pouch", "Take rings off before washing up", "Polish with a soft cloth monthly"],
  cta: "Save this for later",
};

const imageMetadata: CalculateMetadataFunction<ImagePostProps> = ({ props }) => {
  const even = (n: unknown, d: number) => {
    const v = Math.round(Number(n) || d);
    return Math.max(2, v - (v % 2));
  };
  return { width: even(props.spec?.width, 1080), height: even(props.spec?.height, 1350) };
};

/** <Composition id="ImagePost"> — one frame, rendered with renderStill. */
export const ImagePostComposition: React.FC = () => (
  <Composition
    id="ImagePost"
    component={ImagePost}
    width={1080}
    height={1350}
    fps={30}
    durationInFrames={1}
    defaultProps={{ spec: SAMPLE_IMAGE } as ImagePostProps}
    calculateMetadata={imageMetadata}
  />
);
