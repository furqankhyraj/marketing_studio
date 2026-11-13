import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { Reel, type ReelProps } from "./Reel.tsx";
import { CarouselSlide, SLIDE_FRAMES, type CarouselSlideProps } from "./CarouselSlide.tsx";
import { totalFrames, DEFAULT_FPS } from "./lib/timing.ts";
import { SAMPLE_CAROUSEL, SAMPLE_REEL } from "./samples.ts";
import { ImagePostComposition } from "./ImagePost.tsx"; // single-image feed posts (autopost agent)
import { ClipReelComposition } from "./ClipReel.tsx"; // clips from long videos (clips agent)
import { PinImageComposition } from "./PinImage.tsx"; // Pinterest 2:3 pins

const even = (n: unknown, d: number) => {
  const v = Math.round(Number(n) || d);
  return Math.max(2, v - (v % 2));
};

const reelMetadata: CalculateMetadataFunction<ReelProps> = ({ props }) => {
  const spec = props.spec;
  const fps = Math.max(1, Math.min(60, Math.round(Number(spec.fps) || DEFAULT_FPS)));
  return {
    fps,
    width: even(spec.width, 1080),
    height: even(spec.height, 1920),
    durationInFrames: totalFrames(spec, fps),
  };
};

const slideMetadata: CalculateMetadataFunction<CarouselSlideProps> = ({ props }) => ({
  width: even(props.spec.width, 1080),
  height: even(props.spec.height, 1350),
});

export const Root: React.FC = () => (
  <>
    <Composition
      id="Reel"
      component={Reel}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={{ spec: SAMPLE_REEL } as ReelProps}
      calculateMetadata={reelMetadata}
    />
    <Composition
      id="CarouselSlide"
      component={CarouselSlide}
      width={1080}
      height={1350}
      fps={30}
      durationInFrames={SLIDE_FRAMES}
      defaultProps={{ spec: SAMPLE_CAROUSEL, index: 0 } as CarouselSlideProps}
      calculateMetadata={slideMetadata}
    />
    <ImagePostComposition />
    <ClipReelComposition />
    <PinImageComposition />
  </>
);
