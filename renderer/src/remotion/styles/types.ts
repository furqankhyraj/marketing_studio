import type React from "react";
import type { BrandStyleRef, Scene, StyleMeta } from "../../../../shared/types.ts";
import type { Palette } from "../lib/color.ts";

export type TransitionKind = "fade" | "slide-up" | "slide-left" | "whip" | "zoom" | "wipe" | "flash" | "cut" | "iris";

export interface SceneProps {
  scene: Scene;
  index: number;
  total: number;
  brand: BrandStyleRef;
  pal: Palette;
  /** scene length in frames */
  dur: number;
  mode: "reel" | "carousel";
}

export interface CtaTheme {
  background: string; // CSS background
  fg: string;
  keywordBg: string;
  keywordFg: string;
  headingFont: string;
  bodyFont: string;
  radius: number;
  uppercase?: boolean;
  /** optional decoration rendered behind the card content */
  Decor?: React.FC<{ pal: Palette }>;
}

export interface StyleDef {
  meta: StyleMeta;
  Scene: React.FC<SceneProps>;
  transition: TransitionKind;
  transitionFrames?: number;
  cta: (pal: Palette) => CtaTheme;
  /** whether the logo bug sits on a dark background by default */
  darkChrome: (pal: Palette) => boolean;
}
