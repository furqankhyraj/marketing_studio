import React, { useState } from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { BrandStyleRef } from "../../../../shared/types.ts";
import { type Palette, rgba, isDark, readable } from "../lib/color.ts";
import { initials } from "../lib/text.ts";
import { FONTS } from "../lib/fonts.ts";

/** Brand mark: logo image (if it loads) or an initials monogram. */
export const BrandMark: React.FC<{ brand: BrandStyleRef; pal: Palette; size: number; ring?: boolean }> = ({
  brand,
  pal,
  size,
  ring = true,
}) => {
  const [failed, setFailed] = useState(false);
  const showLogo = !!brand.logoUrl && !failed;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: "hidden",
        background: showLogo ? "#ffffff" : pal.primary,
        boxShadow: ring ? `0 0 0 ${Math.max(2, size * 0.05)}px ${rgba("#ffffff", 0.85)}, 0 ${size * 0.08}px ${size * 0.3}px rgba(0,0,0,0.25)` : undefined,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {showLogo ? (
        <Img
          src={brand.logoUrl!}
          maxRetries={1}
          delayRenderTimeoutInMilliseconds={15000}
          onError={() => setFailed(true)}
          style={{ width: "86%", height: "86%", objectFit: "contain" }}
        />
      ) : (
        <span
          style={{
            fontFamily: FONTS.heavy,
            fontWeight: 900,
            fontSize: size * 0.4,
            color: pal.onPrimary,
            letterSpacing: -0.5,
          }}
        >
          {initials(brand.name)}
        </span>
      )}
    </div>
  );
};

/** Corner bug: logo + handle, top area (inside Instagram safe zone). */
export const LogoBug: React.FC<{
  brand: BrandStyleRef;
  pal: Palette;
  /** background luminance hint for the handle chip */
  onDark?: boolean;
  position?: "top-left" | "top-right";
}> = ({ brand, pal, onDark = true, position = "top-right" }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const s = spring({ frame: frame - 6, fps, config: { damping: 200 } });
  const top = height > 1500 ? 170 : 56;
  const label = brand.handle || brand.name;
  const chipBg = onDark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.82)";
  const chipFg = onDark ? "#ffffff" : "#111111";
  return (
    <div
      style={{
        position: "absolute",
        top,
        [position === "top-right" ? "right" : "left"]: 48,
        display: "flex",
        flexDirection: position === "top-right" ? "row-reverse" : "row",
        alignItems: "center",
        gap: 16,
        opacity: s,
        transform: `translateY(${(1 - s) * -24}px)`,
        zIndex: 50,
      }}
    >
      <BrandMark brand={brand} pal={pal} size={84} />
      <div
        style={{
          background: chipBg,
          color: chipFg,
          fontFamily: FONTS.sans,
          fontWeight: 600,
          fontSize: 30,
          padding: "10px 20px",
          borderRadius: 999,
          whiteSpace: "nowrap",
          maxWidth: 560,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
    </div>
  );
};

/** Film grain / paper noise overlay using an SVG turbulence filter. */
export const Grain: React.FC<{ opacity?: number; seed?: number; frequency?: number; blend?: React.CSSProperties["mixBlendMode"] }> = ({
  opacity = 0.12,
  seed = 1,
  frequency = 0.9,
  blend = "overlay",
}) => {
  const id = `grain-${seed}-${Math.round(frequency * 100)}`;
  return (
    <AbsoluteFill style={{ opacity, mixBlendMode: blend, pointerEvents: "none" }}>
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency={frequency} numOctaves={2} seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${id})`} />
      </svg>
    </AbsoluteFill>
  );
};

export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.55 }) => (
  <AbsoluteFill
    style={{ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${strength}) 100%)`, pointerEvents: "none" }}
  />
);

/** Bottom/top gradient scrim to guarantee text contrast over media. */
export const Scrim: React.FC<{ from?: "bottom" | "top" | "both"; strength?: number; color?: string }> = ({
  from = "bottom",
  strength = 0.75,
  color = "#000000",
}) => {
  const c = rgba(color, strength);
  const z = rgba(color, 0);
  const bg =
    from === "bottom"
      ? `linear-gradient(to top, ${c} 0%, ${rgba(color, strength * 0.6)} 35%, ${z} 70%)`
      : from === "top"
        ? `linear-gradient(to bottom, ${c} 0%, ${z} 55%)`
        : `linear-gradient(to bottom, ${c} 0%, ${z} 35%, ${z} 55%, ${c} 100%)`;
  return <AbsoluteFill style={{ background: bg, pointerEvents: "none" }} />;
};

/** Carousel page counter + swipe hint. */
export const SlideCounter: React.FC<{ index: number; total: number; color: string; font?: string }> = ({
  index,
  total,
  color,
  font = FONTS.sans,
}) => (
  <div
    style={{
      position: "absolute",
      right: 56,
      bottom: 48,
      display: "flex",
      alignItems: "center",
      gap: 14,
      fontFamily: font,
      fontWeight: 600,
      fontSize: 30,
      color: "#ffffff",
      background: "rgba(0,0,0,0.45)",
      padding: "10px 22px",
      borderRadius: 999,
      zIndex: 60,
    }}
  >
    <span style={{ opacity: 0.85 }}>
      {index + 1}/{total}
    </span>
    {index < total - 1 ? (
      <svg width="54" height="30" viewBox="0 0 54 30">
        <path d="M2 15 H48 M36 3 L50 15 L36 27" stroke="#ffffff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ) : null}
  </div>
);

export function chipFor(bg: string) {
  return isDark(bg) ? { bg: "rgba(255,255,255,0.14)", fg: "#ffffff" } : { bg: "rgba(0,0,0,0.08)", fg: readable(bg) };
}

export const useEntrance = (delay = 0, damping = 14, mass = 0.8) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass } });
};

export const fade = (frame: number, a: number, b: number) =>
  interpolate(frame, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
