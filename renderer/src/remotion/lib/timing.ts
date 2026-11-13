import type { ReelSpec } from "../../../../shared/types.ts";

export const DEFAULT_FPS = 30;

export function sceneFrames(spec: ReelSpec, fps: number): number[] {
  return (spec.scenes ?? []).map((s) => Math.max(Math.round(0.5 * fps), Math.round((Number(s.durationSec) || 3) * fps)));
}

/** End card length: 3s with a CTA, 2s brand outro otherwise. */
export function ctaFrames(spec: ReelSpec, fps: number): number {
  return Math.round((spec.cta && (spec.cta.text || spec.cta.keyword) ? 3 : 2) * fps);
}

export function totalFrames(spec: ReelSpec, fps: number): number {
  const total = sceneFrames(spec, fps).reduce((a, b) => a + b, 0) + ctaFrames(spec, fps);
  // if real caption timings / voiceover extend past the scenes, keep the video long enough
  const capEnd = spec.captions?.length ? Math.ceil((Math.max(...spec.captions.map((c) => c.endMs || 0)) / 1000) * fps) : 0;
  return Math.max(fps, total, capEnd);
}
