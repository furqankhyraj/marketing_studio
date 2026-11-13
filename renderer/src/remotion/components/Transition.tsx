import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import type { TransitionKind } from "../styles/types.ts";

/**
 * Entrance transition for a scene. Scenes are layered: the incoming scene sits on top of the
 * previous one (which keeps rendering for `frames` extra frames), so every transition covers cleanly.
 */
export const EnterTransition: React.FC<{ kind: TransitionKind; frames: number; enabled: boolean; children: React.ReactNode; accent?: string }> = ({
  kind,
  frames,
  enabled,
  children,
  accent = "#ffffff",
}) => {
  const frame = useCurrentFrame();
  if (!enabled || kind === "cut" || frames <= 0) return <AbsoluteFill>{children}</AbsoluteFill>;
  const t = interpolate(frame, [0, frames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.65, 0, 0.35, 1),
  });
  if (t >= 1) return <AbsoluteFill>{children}</AbsoluteFill>;

  let style: React.CSSProperties = {};
  let overlay: React.ReactNode = null;
  switch (kind) {
    case "fade":
      style = { opacity: t };
      break;
    case "slide-up":
      style = { transform: `translateY(${(1 - t) * 100}%)` };
      break;
    case "slide-left":
      style = { transform: `translateX(${(1 - t) * 100}%)`, boxShadow: "-40px 0 80px rgba(0,0,0,0.35)" };
      break;
    case "whip": {
      const blur = Math.sin(t * Math.PI) * 28;
      style = { transform: `translateX(${(1 - t) * 110}%) skewX(${(1 - t) * -12}deg)`, filter: `blur(${blur}px)` };
      break;
    }
    case "zoom":
      style = { transform: `scale(${interpolate(t, [0, 1], [1.6, 1])})`, opacity: interpolate(t, [0, 0.5], [0, 1], { extrapolateRight: "clamp" }) };
      break;
    case "wipe":
      style = { clipPath: `inset(${(1 - t) * 100}% 0 0 0)` };
      break;
    case "iris":
      style = { clipPath: `circle(${t * 75}% at 50% 50%)` };
      break;
    case "flash":
      style = { opacity: t > 0.35 ? 1 : 0 };
      overlay = <AbsoluteFill style={{ background: accent, opacity: Math.max(0, 1 - Math.abs(t - 0.35) * 3) }} />;
      break;
  }
  return (
    <AbsoluteFill>
      <AbsoluteFill style={style}>{children}</AbsoluteFill>
      {overlay}
    </AbsoluteFill>
  );
};
