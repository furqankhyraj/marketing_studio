// persian — Persian / Iranian art: girih star tiles, a mihrab arch window, carpet borders with corner medallions
// (lachak), a turning shamseh sunburst, gold and turquoise on a deep field. Text: elegant display serif; Urdu and
// Arabic fall through to Nastaliq / Naskh automatically.
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { StyleDef, SceneProps } from "./types.ts";
import { STYLE_META } from "./meta.ts";
import { MediaFill } from "../components/Media.tsx";
import { FadeUp, WordReveal } from "../components/Kinetic.tsx";
import { FONTS } from "../lib/fonts.ts";
import { fitText, urduStyle } from "../lib/text.ts";
import { useLayout } from "../lib/layout.ts";
import { darken, mix, rgba, type Palette } from "../lib/color.ts";


/** Midnight & gold (contemporary Persian palette: one dark ground, one metal, cream type — no jewel-box mix). */
export function persianColors(_pal: Palette) {
  return {
    field: "#15203F",
    deep: "#0B1229",
    gold: "#C9A462",
    turquoise: "#22325F", // secondary tone (lachak fills, shamseh ring): deep indigo, not bright turquoise
    lapis: "#0F1A38",
    ivory: "#EFE6D2",
  };
}

/** Star polygon with n points (2n vertices) alternating outer / inner radius. */
function starPath(cx: number, cy: number, n: number, R: number, r: number, rot = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const rad = i % 2 ? r : R;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}

/** Pointed Persian (ogee-like) arch: straight sides from the bottom to the springline, curved to a point on top. */
function archPath(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const top = y;
  const spring = y + w * 0.62; // springline: height of the curved part ≈ 0.62 × width
  const b = y + h;
  const hc = spring - top;
  return [
    `M${x},${b}`,
    `L${x},${spring}`,
    `C${x},${spring - hc * 0.55} ${cx - w * 0.2},${top + hc * 0.3} ${cx},${top}`,
    `C${cx + w * 0.2},${top + hc * 0.3} ${x + w},${spring - hc * 0.55} ${x + w},${spring}`,
    `L${x + w},${b}`,
    "Z",
  ].join(" ");
}

/** Girih-style tiling: 8-point stars with small 4-point stars at the tile corners, as an SVG pattern. */
const GirihPattern: React.FC<{ id: string; size: number; color: string; fill?: string }> = ({ id, size: T, color, fill }) => {
  const c = T / 2;
  return (
    <pattern id={id} width={T} height={T} patternUnits="userSpaceOnUse">
      <path d={starPath(c, c, 8, T * 0.42, T * 0.26, -90)} fill={fill ?? "none"} stroke={color} strokeWidth={1.6} />
      <path d={starPath(c, c, 8, T * 0.2, T * 0.12, -90 + 22.5)} fill="none" stroke={color} strokeWidth={1.2} />
      {[
        [0, 0],
        [T, 0],
        [0, T],
        [T, T],
      ].map(([x, y], i) => (
        <path key={i} d={starPath(x, y, 4, T * 0.17, T * 0.06, -45)} fill="none" stroke={color} strokeWidth={1.4} />
      ))}
      <path d={`M${c},0 L${c},${T * 0.08} M${c},${T} L${c},${T * 0.92} M0,${c} L${T * 0.08},${c} M${T},${c} L${T * 0.92},${c}`} stroke={color} strokeWidth={1.4} />
    </pattern>
  );
};

/** Shamseh: 16-ray sunburst medallion with rings. */
export const Shamseh: React.FC<{ size: number; gold: string; turquoise: string; field: string; spin?: number }> = ({ size, gold, turquoise, field, spin = 0 }) => {
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
      <g transform={`rotate(${spin} ${c} ${c})`}>
        <path d={starPath(c, c, 16, c, c * 0.72)} fill={rgba(gold, 0.9)} />
        <path d={starPath(c, c, 16, c * 0.8, c * 0.62, -90 + 11.25)} fill={turquoise} />
      </g>
      <circle cx={c} cy={c} r={c * 0.6} fill={field} stroke={gold} strokeWidth={size * 0.012} />
      <g transform={`rotate(${-spin * 1.5} ${c} ${c})`}>
        <path d={starPath(c, c, 8, c * 0.5, c * 0.3)} fill="none" stroke={gold} strokeWidth={size * 0.01} />
      </g>
      <circle cx={c} cy={c} r={c * 0.14} fill={gold} />
    </svg>
  );
};

/** Carpet frame: double gold rules with a bead line between and turquoise lachak quarter-medallions in the corners. */
const CarpetFrame: React.FC<{ W: number; H: number; gold: string; turquoise: string; field: string; draw: number }> = ({ W, H, gold, turquoise, field, draw }) => {
  const o = 26;
  const i = 50;
  const per = 2 * (W - 2 * o + H - 2 * o);
  const R = Math.min(W, H) * 0.16;
  const corners: [number, number, number][] = [
    [i, i, 0],
    [W - i, i, 90],
    [W - i, H - i, 180],
    [i, H - i, 270],
  ];
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
      <rect x={o} y={o} width={W - 2 * o} height={H - 2 * o} fill="none" stroke={gold} strokeWidth={4} strokeDasharray={per} strokeDashoffset={per * (1 - draw)} />
      <rect x={(o + i) / 2} y={(o + i) / 2} width={W - o - i} height={H - o - i} fill="none" stroke={rgba(gold, 0.85)} strokeWidth={7} strokeLinecap="round" strokeDasharray="0 17" opacity={draw} />
      <rect x={i} y={i} width={W - 2 * i} height={H - 2 * i} fill="none" stroke={rgba(gold, 0.8)} strokeWidth={2} opacity={draw} />
      {corners.map(([x, y, rot], k) => (
        <g key={k} transform={`translate(${x} ${y}) rotate(${rot})`} opacity={draw}>
          <path d={`M0,0 L${R},0 A${R},${R} 0 0 1 0,${R} Z`} fill={turquoise} stroke={gold} strokeWidth={3} />
          <path d={`M0,0 L${R * 0.68},0 A${R * 0.68},${R * 0.68} 0 0 1 0,${R * 0.68} Z`} fill={field} stroke={gold} strokeWidth={2} />
          <path d={starPath(0, 0, 8, R * 0.34, R * 0.2)} fill={rgba(gold, 0.9)} />
          {[15, 45, 75].map((a) => (
            <circle key={a} cx={R * 0.84 * Math.cos((a * Math.PI) / 180)} cy={R * 0.84 * Math.sin((a * Math.PI) / 180)} r={R * 0.06} fill={gold} />
          ))}
        </g>
      ))}
    </svg>
  );
};

/** Gold rule — diamond — rule divider. */
const Divider: React.FC<{ gold: string; width: number; grow: number }> = ({ gold, width, grow }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, margin: "26px auto 0" }}>
    <div style={{ width: (width / 2) * grow, height: 2, background: `linear-gradient(90deg, transparent, ${gold})` }} />
    <svg width={34} height={34} viewBox="0 0 34 34">
      <path d={starPath(17, 17, 4, 16, 6, -90)} fill={gold} />
    </svg>
    <div style={{ width: (width / 2) * grow, height: 2, background: `linear-gradient(90deg, ${gold}, transparent)` }} />
  </div>
);

/** Shared background: deep field, radial glow, girih tiles. */
const PersianBackground: React.FC<{ pal: Palette; W: number; H: number; drift: number; seed: string }> = ({ pal, W, H, drift, seed }) => {
  const k = persianColors(pal);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 38%, ${mix(k.field, "#ffffff", 0.08)} 0%, ${k.field} 45%, ${k.deep} 100%)` }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, opacity: 0.2 }}>
        <defs>
          <GirihPattern id={`girih-${seed}`} size={150} color={k.gold} />
        </defs>
        <rect width={W} height={H} fill={`url(#girih-${seed})`} transform={`translate(${-drift * 30} ${-drift * 45})`} />
      </svg>
    </AbsoluteFill>
  );
};

const PersianScene: React.FC<SceneProps> = ({ scene, index, pal, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const k = persianColors(pal);
  const drift = interpolate(frame, [0, dur], [0, 1]);
  const draw = interpolate(frame, [0, 28], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const open = spring({ frame: frame - 4, fps, config: { damping: 200 }, durationInFrames: 30 });
  const { W, H } = L;
  // Arch window
  const aw = L.isReel ? 780 : 640;
  const ah = L.isReel ? 760 : 560;
  const ax = (W - aw) / 2;
  const ay = L.isReel ? 200 : 120;
  const arch = archPath(ax, ay, aw, ah);
  const archLen = 2 * ah + aw * 1.6;
  const textTop = ay + ah + (L.isReel ? 44 : 30);
  const textBottom = L.isReel ? H - L.safeBottom - 30 : H - 90; // stay above the burned-in caption band
  const size = fitText(scene.headline, { maxW: L.innerW - 40, maxH: Math.max(160, textBottom - textTop - (scene.subtext ? 150 : 70)), max: 104, min: 44, charW: 0.52, lineH: 1.08 });
  const clipId = `arch-${index}`;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <PersianBackground pal={pal} W={W} H={H} drift={drift} seed={String(index)} />
      {/* arch window with the scene media (or a big shamseh when there is none) */}
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <clipPath id={clipId}>
            <path d={arch} />
          </clipPath>
        </defs>
        <path d={arch} fill={k.deep} opacity={0.85} />
      </svg>
      <div style={{ position: "absolute", inset: 0, clipPath: `path('${arch}')`, opacity: open, transform: `scale(${0.96 + 0.04 * open})`, transformOrigin: `${W / 2}px ${ay + ah / 2}px` }}>
        {scene.media ? (
          <div style={{ position: "absolute", left: ax, top: ay, width: aw, height: ah }}>
            <MediaFill media={scene.media} dur={dur} kenBurns="in" strength={0.06} phoneLayout="box" phoneBackdrop={`radial-gradient(circle at 50% 45%, ${mix(k.lapis, k.turquoise, 0.25)} 0%, ${k.lapis} 45%, ${darken(k.lapis, 0.5)} 100%)`} />
          </div>
        ) : (
          <div style={{ position: "absolute", left: ax, top: ay, width: aw, height: ah, display: "flex", alignItems: "center", justifyContent: "center", background: `radial-gradient(circle, ${mix(k.lapis, k.field, 0.4)} 0%, ${k.deep} 75%)` }}>
            <Shamseh size={aw * 0.62} gold={k.gold} turquoise={k.turquoise} field={k.field} spin={frame * 0.25} />
          </div>
        )}
      </div>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <path d={arch} fill="none" stroke={k.gold} strokeWidth={8} strokeDasharray={archLen} strokeDashoffset={archLen * (1 - draw)} />
        <path d={archPath(ax - 18, ay - 18, aw + 36, ah + 18)} fill="none" stroke={rgba(k.gold, 0.55)} strokeWidth={2.5} opacity={draw} />
        {/* finial */}
        <g opacity={draw} transform={`translate(${W / 2} ${ay - 44})`}>
          <path d={starPath(0, 0, 8, 26, 12)} fill={k.gold} />
          <circle r={7} fill={k.turquoise} />
        </g>
      </svg>
      <CarpetFrame W={W} H={H} gold={k.gold} turquoise={k.turquoise} field={k.field} draw={draw} />
      {/* text cartouche */}
      <div style={{ position: "absolute", left: L.side, right: L.side, top: textTop, bottom: H - textBottom, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <WordReveal
          text={scene.headline}
          kind="blur"
          delay={12}
          stagger={4}
          style={{ fontFamily: FONTS.display, fontWeight: 400, fontSize: size, lineHeight: 1.08, color: k.ivory, textShadow: "0 4px 24px rgba(0,0,0,0.45)", ...urduStyle(scene.headline, 1.7) }}
        />
        <Divider gold={k.gold} width={420} grow={interpolate(frame, [16, 44], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
        {scene.subtext ? (
          <FadeUp delay={24}>
            <div style={{ marginTop: 22, fontFamily: FONTS.sans, fontWeight: 500, fontSize: 36, lineHeight: 1.35, color: rgba(k.ivory, 0.85), textAlign: "center", ...urduStyle(scene.subtext, 1.8) }}>{scene.subtext}</div>
          </FadeUp>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const persian: StyleDef = {
  meta: STYLE_META["persian"],
  Scene: PersianScene,
  transition: "fade",
  transitionFrames: 16,
  darkChrome: () => true,
  cta: (pal) => {
    const k = persianColors(pal);
    return {
      background: `radial-gradient(ellipse at 50% 40%, ${mix(k.field, "#ffffff", 0.08)} 0%, ${k.field} 50%, ${k.deep} 100%)`,
      fg: k.ivory,
      keywordBg: k.gold,
      keywordFg: "#1A120C",
      headingFont: FONTS.display,
      bodyFont: FONTS.sans,
      radius: 14,
      Decor: ({ pal: p }) => {
        const { width: W, height: H } = useVideoConfig();
        const frame = useCurrentFrame();
        const kk = persianColors(p);
        return (
          <AbsoluteFill>
            <PersianBackground pal={p} W={W} H={H} drift={0} seed="cta" />
            <div style={{ position: "absolute", left: W / 2 - W * 0.42, top: H * 0.5 - W * 0.42, opacity: 0.22 }}>
              <Shamseh size={W * 0.84} gold={kk.gold} turquoise={kk.turquoise} field={kk.field} spin={frame * 0.2} />
            </div>
            <CarpetFrame W={W} H={H} gold={kk.gold} turquoise={kk.turquoise} field={kk.field} draw={1} />
          </AbsoluteFill>
        );
      },
    };
  },
};
