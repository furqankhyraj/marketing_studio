import React, { useState } from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, useCurrentFrame } from "remotion";
import type { MediaRef } from "../../../../shared/types.ts";

export type KenBurns = "in" | "out" | "pan-left" | "pan-right" | "none";

/**
 * Full-bleed media (cover). Images get a Ken Burns move; videos play muted.
 * If the media fails to load, renders `fallback` instead of crashing the render.
 */
export const MediaFill: React.FC<{
  media?: MediaRef;
  dur: number;
  kenBurns?: KenBurns;
  strength?: number;
  fallback?: React.ReactNode;
  filter?: string;
  style?: React.CSSProperties;
  /** phone-frame images: "full" = full-screen scene (phone in the upper half), "box" = framed window (phone centered, large) */
  phoneLayout?: "full" | "box";
  /** phone-frame images: CSS background behind the phone instead of the blurred screenshot */
  phoneBackdrop?: string;
}> = ({ media, dur, kenBurns = "in", strength = 0.12, fallback = null, filter, style, phoneLayout = "full", phoneBackdrop }) => {
  const frame = useCurrentFrame();
  const [failed, setFailed] = useState(false);
  if (!media?.src || failed) return <>{fallback}</>;

  const t = interpolate(frame, [0, Math.max(1, dur)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  let scale = 1;
  let tx = 0;
  if (kenBurns === "in") scale = 1 + strength * t;
  else if (kenBurns === "out") scale = 1 + strength * (1 - t);
  else if (kenBurns === "pan-left") {
    scale = 1 + strength;
    tx = interpolate(t, [0, 1], [3, -3]);
  } else if (kenBurns === "pan-right") {
    scale = 1 + strength;
    tx = interpolate(t, [0, 1], [-3, 3]);
  }
  const common: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    filter,
    ...style,
  };

  if (media.kind === "image" && media.frame === "phone") {
    // App screenshot: blurred copy as backdrop + the whole screen inside a phone frame (gentle zoom only).
    const z = 1 + Math.min(0.05, strength * 0.4) * t;
    return (
      <AbsoluteFill style={{ overflow: "hidden", ...style }}>
        {phoneBackdrop ? (
          <AbsoluteFill style={{ background: phoneBackdrop }} />
        ) : (
          <Img src={media.src} maxRetries={1} delayRenderTimeoutInMilliseconds={20000} onError={() => setFailed(true)}
            style={{ position: "absolute", inset: "-10%", width: "120%", height: "120%", objectFit: "cover", filter: "blur(40px) saturate(1.1) brightness(0.7)" }} />
        )}
        <AbsoluteFill style={{ alignItems: "center", justifyContent: phoneLayout === "box" ? "center" : "flex-start", paddingTop: phoneLayout === "box" ? 0 : "9cqh", containerType: "size" } as React.CSSProperties}>
          <div style={{ height: phoneLayout === "box" ? "84%" : "50%", aspectRatio: "1080 / 2300", maxWidth: "80%", transform: `scale(${z})`, borderRadius: "6cqh", padding: "1.1cqh", background: "#111", boxShadow: "0 3cqh 8cqh rgba(0,0,0,0.45)", boxSizing: "border-box" }}>
            <Img src={media.src} maxRetries={1} delayRenderTimeoutInMilliseconds={20000} onError={() => setFailed(true)}
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", borderRadius: "5cqh", display: "block", filter }} />
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${scale}) translateX(${tx}%)` }}>
        {media.kind === "video" ? (
          <OffthreadVideo
            src={media.src}
            muted
            style={common}
            onError={() => setFailed(true)}
          />
        ) : (
          <Img
            src={media.src}
            style={common}
            maxRetries={1}
            delayRenderTimeoutInMilliseconds={20000}
            onError={() => setFailed(true)}
          />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Media constrained in a box (for framed layouts). */
export const MediaBox: React.FC<{
  media?: MediaRef;
  dur: number;
  kenBurns?: KenBurns;
  strength?: number;
  fallback?: React.ReactNode;
  style?: React.CSSProperties;
  filter?: string;
}> = ({ style, ...rest }) => (
  <div style={{ position: "relative", overflow: "hidden", ...style }}>
    <MediaFill {...rest} />
  </div>
);
