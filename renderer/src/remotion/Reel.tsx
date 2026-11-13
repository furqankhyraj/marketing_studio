import React, { useMemo, useState } from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, useVideoConfig } from "remotion";
import type { ReelSpec } from "../../../shared/types.ts";
import { getStyle } from "./styles/index.ts";
import { makePalette } from "./lib/color.ts";
import { sceneFrames, ctaFrames } from "./lib/timing.ts";
import { EnterTransition } from "./components/Transition.tsx";
import { CtaCard } from "./components/CtaCard.tsx";
import { LogoBug } from "./components/Brand.tsx";
import { Captions, buildCaptionWords } from "./components/Captions.tsx";
import { loadUrduFonts } from "./lib/fonts.ts";
import { isUrdu } from "./lib/text.ts";

export interface ReelProps {
  spec: ReelSpec;
  [key: string]: unknown;
}

const SafeAudio: React.FC<{ src: string; volume: number | ((f: number) => number) }> = ({ src, volume }) => {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <Audio src={src} volume={volume} onError={() => setFailed(true)} />;
};

export const Reel: React.FC<ReelProps> = ({ spec }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const style = getStyle(spec.style);
  // Urdu text anywhere (headlines, narration captions, CTA): load Nastaliq/Naskh and wait for them.
  const [urdu] = useState(() => {
    const u = isUrdu(JSON.stringify([spec.scenes, spec.captions, spec.cta]));
    if (u) loadUrduFonts(spec.language, JSON.stringify([spec.scenes, spec.captions]));
    return u;
  });
  const pal = useMemo(() => makePalette(spec.brand?.colors), [spec.brand?.colors]);
  const frames = sceneFrames(spec, fps);
  const endLen = ctaFrames(spec, fps);
  const T = Math.min(style.transitionFrames ?? 12, Math.floor(Math.min(...frames, endLen) / 3));
  const starts: number[] = [];
  frames.reduce((acc, f) => (starts.push(acc), acc + f), 0);
  const ctaStart = frames.reduce((a, b) => a + b, 0);
  const words = useMemo(() => (spec.captionStyle ? buildCaptionWords(spec, fps) : []), [spec, fps]);
  const darkChrome = style.darkChrome(pal);
  const brand = spec.brand ?? { name: "Brand", colors: pal };

  const musicVol = Math.max(0, Math.min(1, spec.music?.volume ?? 0.6)) * (spec.voiceover?.src ? 0.35 : 1);
  const fadeOut = (f: number) =>
    musicVol *
    interpolate(f, [0, 10, durationInFrames - 30, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: pal.deep }} className={urdu ? "smcp-urdu" : undefined}>
      {/* Urdu: each text block takes its direction (and start alignment) from its own content */}
      {urdu ? <style>{".smcp-urdu div, .smcp-urdu span { unicode-bidi: plaintext; }"}</style> : null}
      {spec.scenes.map((scene, i) => (
        <Sequence key={scene.id || i} from={starts[i]} durationInFrames={frames[i] + T} name={`Scene ${i + 1}`}>
          <EnterTransition kind={style.transition} frames={T} enabled={i > 0} accent={pal.accent}>
            <style.Scene scene={scene} index={i} total={spec.scenes.length} brand={brand} pal={pal} dur={frames[i]} mode="reel" />
          </EnterTransition>
        </Sequence>
      ))}
      <Sequence from={0} durationInFrames={ctaStart} name="Logo bug">
        <LogoBug brand={brand} pal={pal} onDark={darkChrome} />
      </Sequence>
      <Sequence from={ctaStart} durationInFrames={endLen} name="CTA">
        <EnterTransition kind={style.transition === "cut" ? "cut" : style.transition} frames={T} enabled={spec.scenes.length > 0} accent={pal.accent}>
          <CtaCard cta={spec.cta} brand={brand} pal={pal} theme={style.cta(pal)} />
        </EnterTransition>
      </Sequence>
      {spec.captionStyle && words.length ? <Captions words={words} styleId={spec.captionStyle} pal={pal} maxFrame={durationInFrames} /> : null}
      {spec.music?.src ? <SafeAudio src={spec.music.src} volume={fadeOut} /> : null}
      {spec.voiceover?.src ? <SafeAudio src={spec.voiceover.src} volume={1} /> : null}
    </AbsoluteFill>
  );
};
