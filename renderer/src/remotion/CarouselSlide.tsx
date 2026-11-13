import React, { useMemo, useState } from "react";
import { loadUrduFonts } from "./lib/fonts.ts";
import { isUrdu } from "./lib/text.ts";
import { AbsoluteFill } from "remotion";
import type { CarouselSpec, Scene } from "../../../shared/types.ts";
import { getStyle } from "./styles/index.ts";
import { makePalette, isDark } from "./lib/color.ts";
import { LogoBug, SlideCounter } from "./components/Brand.tsx";

export interface CarouselSlideProps {
  spec: CarouselSpec;
  index: number;
  [key: string]: unknown;
}

/** Slides are rendered as a still at SLIDE_STILL_FRAME of a short composition so entrance animations have settled. */
export const SLIDE_FRAMES = 90;
export const SLIDE_STILL_FRAME = 75;

/** A single carousel slide: the style's scene frozen at its fully-animated state. */
export const CarouselSlide: React.FC<CarouselSlideProps> = ({ spec, index }) => {
  const style = getStyle(spec.style);
  useState(() => {
    if (isUrdu(JSON.stringify(spec.slides ?? []))) loadUrduFonts((spec as { language?: string }).language, JSON.stringify(spec.slides ?? []));
    return null;
  });
  const pal = useMemo(() => makePalette(spec.brand?.colors), [spec.brand?.colors]);
  const slides = spec.slides ?? [];
  const i = Math.max(0, Math.min(slides.length - 1, index | 0));
  const slide = slides[i] ?? { headline: spec.brand?.name ?? "" };
  const scene: Scene = { id: `slide-${i}`, durationSec: 4, headline: slide.headline, subtext: slide.body, media: slide.media };
  const brand = spec.brand ?? { name: "Brand", colors: pal };
  const dark = style.darkChrome(pal);
  return (
    <AbsoluteFill>
        <style.Scene scene={scene} index={i} total={slides.length} brand={brand} pal={pal} dur={120} mode="carousel" />
        {i === 0 ? <LogoBug brand={brand} pal={pal} onDark={dark} position="top-right" /> : null}
      <SlideCounter index={i} total={slides.length} color={dark ? "#ffffff" : isDark(pal.text) ? pal.text : "#111111"} />
    </AbsoluteFill>
  );
};
