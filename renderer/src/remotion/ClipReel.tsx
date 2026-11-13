// ClipReel: a vertical clip cut from a long video (server/src/clips.ts). The server pre-cuts and reframes the
// segment to 1080x1920 with ffmpeg (fill-blur / center-crop / split); this composition plays it (muted — the server
// masters the clip audio afterwards) and adds animated word captions, a hook title bar, the brand logo bug and a
// progress bar. Urdu text uses the existing Nastaliq / RTL handling.
import React, { useMemo, useState } from "react";
import { AbsoluteFill, Composition, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig, type CalculateMetadataFunction } from "remotion";
import type { ClipReelSpec } from "../../../shared/types.ts";
import { makePalette, ensureContrast } from "./lib/color.ts";
import { Captions, type CaptionWord } from "./components/Captions.tsx";
import { LogoBug } from "./components/Brand.tsx";
import { FONTS, loadUrduFonts } from "./lib/fonts.ts";
import { isUrdu, urduStyle } from "./lib/text.ts";

export type ClipReelInput = ClipReelSpec & { videoSrc: string };
export interface ClipReelProps {
  spec: ClipReelInput;
  [key: string]: unknown;
}

export const clipFrames = (spec: Pick<ClipReelSpec, "startMs" | "endMs">, fps: number) =>
  Math.max(1, Math.round((Math.max(1000, (spec.endMs ?? 0) - (spec.startMs ?? 0)) / 1000) * fps));

/** Hook title bar: white card with a brand-colour accent, springs in, stays on screen. */
const HookTitle: React.FC<{ text: string; accent: string; top: number }> = ({ text, accent, top }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const s = spring({ frame: frame - 3, fps, config: { damping: 14, mass: 0.6 } });
  const urdu = isUrdu(text);
  const len = text.length;
  const size = urdu ? (len > 40 ? 52 : 62) : len > 60 ? 50 : len > 38 ? 58 : 68;
  return (
    <div style={{ position: "absolute", top, left: 60, right: 60, display: "flex", justifyContent: "center", zIndex: 60, opacity: interpolate(s, [0, 0.5], [0, 1], { extrapolateRight: "clamp" }), transform: `translateY(${(1 - s) * -30}px) scale(${interpolate(s, [0, 1], [0.94, 1])})` }}>
      <div style={{ maxWidth: width - 120, background: "#ffffff", borderRadius: 26, padding: urdu ? "6px 34px 14px" : "20px 34px", boxShadow: "0 14px 44px rgba(0,0,0,0.35)", borderBottom: `10px solid ${accent}` }}>
        <div
          dir={urdu ? "rtl" : undefined}
          style={{
            fontFamily: urdu ? FONTS.urdu : FONTS.heavy,
            fontWeight: urdu ? 700 : 900,
            fontSize: size,
            lineHeight: 1.12,
            color: "#111111",
            textAlign: "center",
            letterSpacing: urdu ? 0 : -0.5,
            ...urduStyle(text, 2.0),
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
};

const ProgressBar: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const w = (frame / Math.max(1, durationInFrames - 1)) * width;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, height: 10, width: "100%", background: "rgba(255,255,255,0.18)", zIndex: 80 }}>
      <div style={{ height: "100%", width: w, background: color }} />
    </div>
  );
};

export const ClipReel: React.FC<ClipReelProps> = ({ spec }) => {
  const { fps, height, durationInFrames } = useVideoConfig();
  const pal = useMemo(() => makePalette(spec.brand?.colors), [spec.brand?.colors]);
  const [urdu] = useState(() => {
    const u = isUrdu(JSON.stringify([spec.hookTitle, spec.captions?.slice(0, 40)]));
    if (u) loadUrduFonts(spec.language, JSON.stringify([spec.hookTitle, spec.captions?.slice(0, 40)]));
    return u;
  });
  const [videoFailed, setVideoFailed] = useState(false);
  const words: CaptionWord[] = useMemo(
    () =>
      (spec.captions ?? [])
        .filter((c) => c && typeof c.text === "string" && c.text.trim())
        .map((c) => ({ text: c.text.trim(), start: Math.max(0, (c.startMs / 1000) * fps), end: Math.max((c.startMs / 1000) * fps + 1, (c.endMs / 1000) * fps) }))
        .sort((a, b) => a.start - b.start),
    [spec.captions, fps],
  );
  const accent = ensureContrast(pal.pop, "#ffffff", 2.2);
  const brand = spec.brand ?? { name: "Brand", colors: pal };
  // Layout-aware placement. fill-blur: the 16:9 video sits in the middle third, title above it, captions below it.
  // split: captions on the seam between the two halves. center-crop: title near the top, captions lower third.
  const titleTop = spec.layout === "split" ? Math.round(height * 0.14) : spec.layout === "center-crop" ? Math.round(height * 0.15) : Math.round(height * 0.17);
  const captionShift = spec.layout === "split" ? -(height * 0.69 - height * 0.47) : 0;

  return (
    <AbsoluteFill style={{ background: "#0b0b0f" }} className={urdu ? "smcp-urdu" : undefined}>
      {spec.videoSrc && !videoFailed ? (
        <OffthreadVideo src={spec.videoSrc} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setVideoFailed(true)} />
      ) : (
        <AbsoluteFill style={{ background: `linear-gradient(160deg, ${pal.primary}, ${pal.deep})` }} />
      )}
      {spec.showProgress !== false ? <ProgressBar color={accent} /> : null}
      <LogoBug brand={brand} pal={pal} onDark position="top-left" />
      {spec.hookTitle ? <HookTitle text={spec.hookTitle} accent={accent} top={titleTop} /> : null}
      {spec.captionStyle && words.length ? (
        <AbsoluteFill style={{ transform: captionShift ? `translateY(${captionShift}px)` : undefined }}>
          <Captions words={words} styleId={spec.captionStyle} pal={pal} maxFrame={durationInFrames} />
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

const SAMPLE_CLIP: ClipReelInput = {
  engine: "clip",
  width: 1080,
  height: 1920,
  fps: 30,
  source: { name: "sample.mp4" },
  startMs: 0,
  endMs: 6000,
  layout: "fill-blur",
  captionStyle: "white-pill",
  hookTitle: "The biggest pricing mistake beginners make",
  showProgress: true,
  brand: { name: "Saqqa Academy", handle: "@saqqa.academy", colors: { primary: "#0f766e", secondary: "#0f172a", accent: "#f59e0b", background: "#ffffff", text: "#0f172a" } },
  captions: [
    { text: "Here", startMs: 300, endMs: 600 },
    { text: "is", startMs: 600, endMs: 800 },
    { text: "the", startMs: 800, endMs: 1000 },
    { text: "biggest", startMs: 1000, endMs: 1500 },
    { text: "mistake.", startMs: 1500, endMs: 2200 },
  ],
  videoSrc: "",
};

const clipMetadata: CalculateMetadataFunction<ClipReelProps> = ({ props }) => {
  const fps = Math.max(1, Math.min(60, Math.round(Number(props.spec.fps) || 30)));
  const even = (n: unknown, d: number) => {
    const v = Math.round(Number(n) || d);
    return Math.max(2, v - (v % 2));
  };
  return { fps, width: even(props.spec.width, 1080), height: even(props.spec.height, 1920), durationInFrames: clipFrames(props.spec, fps) };
};

/** Registered in Root.tsx. */
export const ClipReelComposition: React.FC = () => (
  <Composition
    id="ClipReel"
    component={ClipReel}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={180}
    defaultProps={{ spec: SAMPLE_CLIP } as ClipReelProps}
    calculateMetadata={clipMetadata}
  />
);
