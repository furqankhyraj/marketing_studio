// Pinterest pins (2:3, 1000x1500): three layouts tuned for the Pinterest feed — a big photo with a bold title band,
// a 3-photo collage with the title in the middle, and a text-first "tips" pin. Static (frame 0).
import React, { useState } from "react";
import { AbsoluteFill, Composition, Img, type CalculateMetadataFunction } from "remotion";
import type { MediaRef, PinImageSpec } from "../../../shared/types.ts";
import { makePalette, rgba, mix, readable, ensureContrast, type Palette } from "./lib/color.ts";
import { fitText, isUrdu, urduStyle } from "./lib/text.ts";
import { FONTS, brandFont, loadUrduFonts } from "./lib/fonts.ts";
import { BrandMark } from "./components/Brand.tsx";
import { PersianCard, pickPersianVariant } from "./persian/PersianArt.tsx";

export interface PinImageProps {
  spec: PinImageSpec;
  [key: string]: unknown;
}

const W = 1000;
const H = 1500;

const Photo: React.FC<{ media?: MediaRef; style?: React.CSSProperties; pal: Palette }> = ({ media, style, pal }) => {
  const [failed, setFailed] = useState(false);
  if (!media?.src || failed)
    return <div style={{ width: "100%", height: "100%", background: `linear-gradient(135deg, ${pal.pale}, ${mix(pal.secondary, "#ffffff", 0.4)})`, ...style }} />;
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

const Title: React.FC<{ text: string; font: string; color: string; maxW: number; maxH: number; max: number; min?: number; align?: "center" | "left" }> = ({
  text,
  font,
  color,
  maxW,
  maxH,
  max,
  min = 44,
  align = "center",
}) => {
  const size = fitText(text, { maxW, maxH, max, min, charW: 0.56, lineH: 1.04 });
  return (
    <div
      style={{
        fontFamily: font,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 1.04,
        color,
        textAlign: align,
        letterSpacing: -0.5,
        maxWidth: maxW,
        overflowWrap: "break-word",
        ...urduStyle(text, 1.7),
      }}
    >
      {text}
    </div>
  );
};

const Badge: React.FC<{ text: string; bg: string; fg: string; size?: number }> = ({ text, bg, fg, size = 30 }) => (
  <div
    style={{
      background: bg,
      color: fg,
      fontFamily: FONTS.heavy,
      fontWeight: 900,
      fontSize: size,
      letterSpacing: 2,
      textTransform: "uppercase",
      padding: `${size * 0.45}px ${size * 0.9}px`,
      borderRadius: 999,
      boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
      whiteSpace: "nowrap",
    }}
  >
    {text}
  </div>
);

const PricePill: React.FC<{ price: string; pal: Palette }> = ({ price, pal }) => (
  <span style={{ background: pal.accent, color: pal.onAccent, fontFamily: FONTS.heavy, fontWeight: 900, fontSize: 34, padding: "6px 22px", borderRadius: 999, marginRight: 14, whiteSpace: "nowrap" }}>{price}</span>
);

const Footer: React.FC<{ spec: PinImageSpec; pal: Palette; color: string; bg?: string }> = ({ spec, pal, color, bg }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: 96,
      background: bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 18,
    }}
  >
    <BrandMark brand={spec.brand} pal={pal} size={54} ring={false} />
    <div style={{ fontFamily: FONTS.sans, fontWeight: 700, fontSize: 30, color, letterSpacing: 0.5 }}>{spec.footer || spec.brand.name}</div>
  </div>
);

function PhotoLayout({ spec, pal, heading }: { spec: PinImageSpec; pal: Palette; heading: string }) {
  const photoH = 940;
  const band = pal.primary;
  const fg = readable(band, ["#ffffff", pal.text]);
  return (
    <AbsoluteFill style={{ background: band }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: photoH, overflow: "hidden" }}>
        <Photo media={spec.photos[0]} pal={pal} />
      </div>
      {spec.badge ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: photoH - 40, display: "flex", justifyContent: "center" }}>
          <Badge text={spec.badge} bg={pal.accent} fg={pal.onAccent} />
        </div>
      ) : null}
      <div style={{ position: "absolute", left: 60, right: 60, top: photoH + 50, bottom: 110, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
        <Title text={spec.title} font={heading} color={fg} maxW={W - 120} maxH={spec.subtitle ? 270 : 330} max={112} />
        {spec.subtitle || spec.price ? (
          <div style={{ display: "flex", alignItems: "center", fontFamily: FONTS.sans, fontWeight: 600, fontSize: 34, color: rgba(fg, 0.85), textAlign: "center", ...urduStyle(spec.subtitle, 1.8) }}>
            {spec.price ? <PricePill price={spec.price} pal={pal} /> : null}
            {spec.subtitle}
          </div>
        ) : null}
      </div>
      <Footer spec={spec} pal={pal} color={rgba(fg, 0.9)} bg={rgba("#000000", 0.12)} />
    </AbsoluteFill>
  );
}

function CollageLayout({ spec, pal, heading }: { spec: PinImageSpec; pal: Palette; heading: string }) {
  const ph = spec.photos.length ? spec.photos : [undefined];
  const p = (i: number) => ph[i % ph.length];
  const bg = pal.background;
  const fg = ensureContrast(pal.text, bg, 7);
  const midTop = 540;
  const midH = 400;
  const gap = 10;
  return (
    <AbsoluteFill style={{ background: bg }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: midTop - gap, overflow: "hidden" }}>
        <Photo media={p(0)} pal={pal} />
      </div>
      <div style={{ position: "absolute", left: 0, top: midTop, width: W, height: midH, background: pal.primary, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 60px" }}>
        {spec.badge ? <Badge text={spec.badge} bg={pal.accent} fg={pal.onAccent} size={26} /> : null}
        <Title text={spec.title} font={heading} color={readable(pal.primary, ["#ffffff", pal.text])} maxW={W - 120} maxH={spec.badge ? 250 : 320} max={100} />
        {spec.subtitle || spec.price ? (
          <div style={{ display: "flex", alignItems: "center", fontFamily: FONTS.sans, fontWeight: 600, fontSize: 30, color: rgba(readable(pal.primary, ["#ffffff", pal.text]), 0.85), textAlign: "center" }}>
            {spec.price ? <PricePill price={spec.price} pal={pal} /> : null}
            {spec.subtitle}
          </div>
        ) : null}
      </div>
      <div style={{ position: "absolute", left: 0, top: midTop + midH + gap, width: W / 2 - gap / 2, height: H - 96 - (midTop + midH + gap) - gap, overflow: "hidden" }}>
        <Photo media={p(1)} pal={pal} />
      </div>
      <div style={{ position: "absolute", left: W / 2 + gap / 2, top: midTop + midH + gap, width: W / 2 - gap / 2, height: H - 96 - (midTop + midH + gap) - gap, overflow: "hidden" }}>
        <Photo media={p(2)} pal={pal} />
      </div>
      <Footer spec={spec} pal={pal} color={fg} bg={bg} />
    </AbsoluteFill>
  );
}

function TextLayout({ spec, pal, heading }: { spec: PinImageSpec; pal: Palette; heading: string }) {
  const bg = pal.pale;
  const fg = ensureContrast(pal.text, bg, 7);
  const bullets = (spec.bullets ?? []).slice(0, 3);
  const photo = spec.photos[0];
  const rtl = isUrdu(spec.title);
  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 760, height: 760, borderRadius: 380, background: rgba(pal.secondary, 0.35), right: -300, top: -260 }} />
      <div style={{ position: "absolute", width: 520, height: 520, borderRadius: 260, background: rgba(pal.accent, 0.25), left: -220, bottom: 120 }} />
      <div style={{ position: "absolute", left: 70, right: 70, top: 90, display: "flex", flexDirection: "column", alignItems: rtl ? "flex-end" : "flex-start", gap: 34, direction: rtl ? "rtl" : "ltr" }}>
        {spec.badge ? <Badge text={spec.badge} bg={pal.primary} fg={pal.onPrimary} size={28} /> : null}
        <Title text={spec.title} font={heading} color={fg} maxW={W - 140} maxH={photo ? 420 : 520} max={124} align={rtl ? "center" : "left"} />
        {spec.subtitle ? <div style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize: 38, color: rgba(fg, 0.75), ...urduStyle(spec.subtitle, 1.8) }}>{spec.subtitle}</div> : null}
        {bullets.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 22, width: "100%" }}>
            {bullets.map((b, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 24, background: "#ffffff", borderRadius: 26, padding: "22px 28px", boxShadow: "0 12px 30px rgba(0,0,0,0.08)" }}>
                <div style={{ width: 58, height: 58, borderRadius: 29, background: pal.accent, color: pal.onAccent, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONTS.heavy, fontWeight: 900, fontSize: 30, flexShrink: 0 }}>
                  {i + 1}
                </div>
                <div style={{ fontFamily: FONTS.sans, fontWeight: 700, fontSize: fitText(b, { maxW: 700, maxH: 110, max: 40, min: 26, lineH: 1.25 }), color: ensureContrast(pal.text, "#ffffff", 7), lineHeight: 1.25, ...urduStyle(b, 1.8) }}>{b}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {photo ? (
        <div style={{ position: "absolute", left: 70, right: 70, bottom: 130, height: bullets.length ? 360 : 520, borderRadius: 32, overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,0.18)" }}>
          <Photo media={photo} pal={pal} />
        </div>
      ) : null}
      <Footer spec={spec} pal={pal} color={fg} />
    </AbsoluteFill>
  );
}

export const PinImage: React.FC<PinImageProps> = ({ spec }) => {
  useState(() => {
    if (isUrdu(JSON.stringify(spec ?? {}))) loadUrduFonts((spec as { language?: string }).language, JSON.stringify(spec ?? {}));
    return null;
  });
  const pal = makePalette(spec.brand?.colors);
  const heading = brandFont(spec.brand?.fonts?.heading, FONTS.heavy);
  const s: PinImageSpec = { ...spec, photos: (spec.photos ?? []).filter((m) => m?.kind === "image") };
  if (s.layout === "persian")
    return (
      <PersianCard W={W} H={H} pal={pal} brand={s.brand} variant={pickPersianVariant(s.variant, s.title)} eyebrow={s.badge} title={s.title} body={s.subtitle} bullets={s.bullets} cta={s.price ? `${s.price}` : undefined} media={s.photos[0]} footer={s.footer} />
    );
  const unique = new Set(s.photos.map((m) => m.src)).size;
  if (s.layout === "collage" && unique >= 2) return <CollageLayout spec={s} pal={pal} heading={heading} />;
  if (s.layout === "text" || !s.photos.length) return <TextLayout spec={s} pal={pal} heading={heading} />;
  return <PhotoLayout spec={s} pal={pal} heading={heading} />;
};

export const SAMPLE_PIN: PinImageSpec = {
  kind: "pin",
  width: W,
  height: H,
  layout: "text",
  brand: { name: "Mindora", colors: { primary: "#7A3E48", secondary: "#D9A5A0", accent: "#E8B04B", background: "#FBF6F0", text: "#2B1D1F" } },
  title: "Christmas Party Games Everyone Will Love",
  subtitle: "Print at home in minutes",
  badge: "Instant download",
  bullets: ["10 games for all ages", "Print on A4 or US Letter", "No prep, just print and play"],
  footer: "etsy.com/shop/Mindora",
  photos: [],
};

const pinMetadata: CalculateMetadataFunction<PinImageProps> = ({ props }) => {
  const even = (n: unknown, d: number) => {
    const v = Math.round(Number(n) || d);
    return Math.max(2, v - (v % 2));
  };
  return { width: even(props.spec?.width, W), height: even(props.spec?.height, H) };
};

/** <Composition id="PinImage"> — one frame, rendered with renderStill. */
export const PinImageComposition: React.FC = () => (
  <Composition
    id="PinImage"
    component={PinImage}
    width={W}
    height={H}
    fps={30}
    durationInFrames={1}
    defaultProps={{ spec: SAMPLE_PIN } as PinImageProps}
    calculateMetadata={pinMetadata}
  />
);
