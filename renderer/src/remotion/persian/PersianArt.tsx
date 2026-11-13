// Persian art cards (static, any size): five layouts drawn from Persian/Iranian art traditions.
//  - mihrab: pointed arch window (media or shamseh) with eslimi arabesque vines in the spandrels
//  - toranj: carpet — lobed central medallion with pendants, scroll border bands, lachak corners, floral field
//  - tazhib: illuminated manuscript page — ivory paper, lapis/gold header panel (sarlowh), jadval margin rules
//  - kashi: tile-mosaic wall (8-point stars + crosses in turquoise/lapis/ivory) with a lobed plaque
//  - shab: night sky — gold star field, rising shamseh sunburst, dome silhouettes
//  - kaghaz: kraft paper poster — black calligraphy, line-art eslimi medallion, red hand seal
// Used by ImagePost (style "persian") and PinImage (layout "persian"). Arabic/Urdu text renders RTL in Naskh/Nastaliq.
import React from "react";
import { AbsoluteFill, Img } from "remotion";
import type { BrandStyleRef, MediaRef } from "../../../../shared/types.ts";
import { darken, isDark, lighten, mix, rgba, type Palette } from "../lib/color.ts";
import { FONTS } from "../lib/fonts.ts";
import { fitText, isUrdu, urduStyle } from "../lib/text.ts";

export const PERSIAN_VARIANTS = ["mihrab", "toranj", "tazhib", "kashi", "shab", "kaghaz"] as const;
export type PersianVariant = (typeof PERSIAN_VARIANTS)[number];

const GOLD = "#D4AF64";
const TURQ = "#1F9C98";
const LAPIS = "#1B3168";
const IVORY = "#F6ECD6";
const PAPER = "#F1E6CC";
const INK = "#2A1A12";
const CRIMSON = "#8E1F1B";

export function persianPalette(pal: Palette) {
  const field = isDark(pal.primary) ? pal.primary : darken(pal.primary, 0.55);
  return { field, deep: darken(field, 0.45), gold: mix(pal.secondary, GOLD, 0.6), turq: TURQ, lapis: LAPIS, ivory: IVORY, paper: PAPER, ink: INK, crimson: CRIMSON };
}

// ------------------------------------------------------------------ geometry helpers
export function star(cx: number, cy: number, n: number, R: number, r: number, rot = -90): string {
  const p: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const rad = i % 2 ? r : R;
    p.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return `M${p.join("L")}Z`;
}
export function arch(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const sp = y + w * 0.62;
  const hc = sp - y;
  return `M${x},${y + h} L${x},${sp} C${x},${sp - hc * 0.55} ${cx - w * 0.2},${y + hc * 0.3} ${cx},${y} C${cx + w * 0.2},${y + hc * 0.3} ${x + w},${sp - hc * 0.55} ${x + w},${sp} L${x + w},${y + h} Z`;
}
/** Lobed (scalloped) circle: n bumps. */
function lobed(cx: number, cy: number, r: number, n: number, depth = 0.08): string {
  const pts: string[] = [];
  const steps = n * 12;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r * (1 - depth + depth * Math.abs(Math.cos((a * n) / 2)));
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}
/** Lobed ellipse-ish medallion (toranj) with rx, ry. */
function toranjPath(cx: number, cy: number, rx: number, ry: number, n = 16, depth = 0.07): string {
  const pts: string[] = [];
  const steps = n * 14;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const k = 1 - depth + depth * Math.abs(Math.cos((a * n) / 2));
    // pointed top/bottom (almond) via superellipse-like exponent
    const x = rx * k * Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.9);
    const y = ry * k * Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 1.25);
    pts.push(`${(cx + x).toFixed(1)},${(cy + y).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}
/** Teardrop leaf pointing along -y, base at origin. */
const LEAF = (s: number) => `M0,0 C${s * 0.42},${-s * 0.25} ${s * 0.38},${-s * 0.75} 0,${-s} C${-s * 0.38},${-s * 0.75} ${-s * 0.42},${-s * 0.25} 0,0 Z`;

/** Eslimi: an inward spiral vine with leaves along it. */
const Spiral: React.FC<{ cx: number; cy: number; r: number; turns?: number; dir?: 1 | -1; rot?: number; color: string; leaf?: string; sw?: number }> = ({ cx, cy, r, turns = 1.6, dir = 1, rot = 0, color, leaf, sw = 3 }) => {
  const pts: [number, number][] = [];
  const N = 70;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * turns * Math.PI * 2;
    const rr = r * Math.exp(-0.32 * t);
    const a = dir * t + (rot * Math.PI) / 180;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  const d = `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}`;
  const leaves = [8, 22, 38].map((i) => {
    const [x, y] = pts[i];
    const [x2, y2] = pts[i + 1];
    const ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI + (dir > 0 ? -60 : 60) + 90;
    return { x, y, ang, s: r * (0.42 - i * 0.006) };
  });
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {leaves.map((l, i) => (
        <path key={i} d={LEAF(l.s)} transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.ang.toFixed(1)})`} fill={leaf ?? color} stroke={color} strokeWidth={1.2} />
      ))}
      <circle cx={pts[N][0]} cy={pts[N][1]} r={sw * 1.4} fill={color} />
    </g>
  );
};

/** Horizontal scroll band: alternating eslimi spirals along a strip. */
const ScrollBand: React.FC<{ x: number; y: number; w: number; h: number; color: string; leaf?: string; bg: string; edge: string }> = ({ x, y, w, h, color, leaf, bg, edge }) => {
  const step = h * 1.25;
  const n = Math.max(1, Math.floor(w / step));
  const pad = (w - n * step) / 2;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={bg} stroke={edge} strokeWidth={2} />
      {Array.from({ length: n }, (_, i) => {
        const cx = x + pad + step * (i + 0.5);
        const up = i % 2 === 0;
        return (
          <g key={i}>
            <path d={`M${cx - step / 2},${y + h / 2} Q${cx - step / 4},${y + (up ? h * 0.15 : h * 0.85)} ${cx},${y + h / 2} T${cx + step / 2},${y + h / 2}`} fill="none" stroke={color} strokeWidth={2} />
            <Spiral cx={cx - step * 0.18} cy={y + (up ? h * 0.36 : h * 0.64)} r={h * 0.26} turns={1.3} dir={up ? 1 : -1} color={color} leaf={leaf} sw={2} />
          </g>
        );
      })}
    </g>
  );
};

/** Girih tile pattern definition. */
const Girih: React.FC<{ id: string; T: number; stroke: string; fill?: string; fill2?: string; sw?: number }> = ({ id, T, stroke, fill = "none", fill2 = "none", sw = 1.6 }) => {
  const c = T / 2;
  return (
    <pattern id={id} width={T} height={T} patternUnits="userSpaceOnUse">
      <path d={star(c, c, 8, T * 0.42, T * 0.27)} fill={fill} stroke={stroke} strokeWidth={sw} />
      <path d={star(c, c, 8, T * 0.18, T * 0.1, -67.5)} fill={fill2} stroke={stroke} strokeWidth={sw * 0.8} />
      {[
        [0, 0],
        [T, 0],
        [0, T],
        [T, T],
      ].map(([x, y], i) => (
        <path key={i} d={star(x, y, 4, T * 0.2, T * 0.07, -45)} fill={fill2} stroke={stroke} strokeWidth={sw * 0.9} />
      ))}
    </pattern>
  );
};

/** Shamseh sunburst medallion. */
const ShamsehSvg: React.FC<{ cx: number; cy: number; r: number; gold: string; turq: string; core: string; rays?: number }> = ({ cx, cy, r, gold, turq, core, rays = 16 }) => (
  <g>
    <path d={star(cx, cy, rays * 2, r, r * 0.8)} fill={rgba(gold, 0.55)} />
    <path d={star(cx, cy, rays, r * 0.88, r * 0.66)} fill={gold} />
    <path d={star(cx, cy, rays, r * 0.74, r * 0.58, -90 + 180 / rays / 2 * 1)} fill={turq} />
    <circle cx={cx} cy={cy} r={r * 0.56} fill={core} stroke={gold} strokeWidth={r * 0.03} />
    <path d={star(cx, cy, 8, r * 0.46, r * 0.28)} fill="none" stroke={gold} strokeWidth={r * 0.025} />
    <circle cx={cx} cy={cy} r={r * 0.1} fill={gold} />
  </g>
);

/** Lachak quarter medallion at a corner (rotation 0 = top-left). */
const Lachak: React.FC<{ x: number; y: number; R: number; rot: number; a: string; b: string; gold: string }> = ({ x, y, R, rot, a, b, gold }) => (
  <g transform={`translate(${x} ${y}) rotate(${rot})`}>
    <path d={`M0,0 L${R},0 A${R},${R} 0 0 1 0,${R} Z`} fill={a} stroke={gold} strokeWidth={3} />
    <path d={`M0,0 L${R * 0.7},0 A${R * 0.7},${R * 0.7} 0 0 1 0,${R * 0.7} Z`} fill={b} stroke={gold} strokeWidth={2} />
    <Spiral cx={R * 0.36} cy={R * 0.36} r={R * 0.26} turns={1.4} color={gold} sw={2} />
    {[18, 45, 72].map((d) => (
      <circle key={d} cx={R * 0.85 * Math.cos((d * Math.PI) / 180)} cy={R * 0.85 * Math.sin((d * Math.PI) / 180)} r={R * 0.05} fill={gold} />
    ))}
  </g>
);

// ------------------------------------------------------------------ text block
export interface PersianCardProps {
  W: number;
  H: number;
  pal: Palette;
  brand: BrandStyleRef;
  variant: PersianVariant;
  eyebrow?: string;
  title: string;
  body?: string;
  bullets?: string[];
  cta?: string;
  badge?: string;
  price?: string;
  media?: MediaRef;
  footer?: string;
}

const PhotoOrPhone: React.FC<{ media: MediaRef; bg: string }> = ({ media, bg }) =>
  media.frame === "phone" ? (
    <div style={{ position: "absolute", inset: 0, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ height: "86%", aspectRatio: "1080 / 2300", background: "#111", borderRadius: 34, padding: 7, boxShadow: "0 18px 50px rgba(0,0,0,0.45)" }}>
        <Img src={media.src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", borderRadius: 28, display: "block" }} />
      </div>
    </div>
  ) : (
    <Img src={media.src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
  );

const TextBlock: React.FC<{
  x: number; y: number; w: number; h: number; color: string; muted: string; accent: string; accentFg: string; p: PersianCardProps; align?: "center"; titleMax?: number; ink?: boolean; titleStyle?: React.CSSProperties; ctaBg?: string; eyebrowColor?: string;
}> = ({ x, y, w, h, color, muted, accent, accentFg, p, titleMax = 96, titleStyle, ctaBg, eyebrowColor }) => {
  const rtl = isUrdu(p.title);
  const bullets = (p.bullets ?? []).slice(0, 4);
  const reserve = (p.eyebrow ? 70 : 0) + (p.body ? 120 : 0) + bullets.length * 64 + 40;
  const size = fitText(p.title, { maxW: w, maxH: Math.max(110, h - reserve), max: titleMax, min: 40, charW: 0.52, lineH: 1.1 });
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 18, direction: rtl ? "rtl" : "ltr" }}>
      {p.eyebrow ? (
        <div style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize: 24, letterSpacing: isUrdu(p.eyebrow) ? 0 : 5, textTransform: isUrdu(p.eyebrow) ? "none" : "uppercase", color: eyebrowColor ?? accent, ...urduStyle(p.eyebrow, 1.6) }}>
          ✦ {p.eyebrow} ✦
        </div>
      ) : null}
      <div style={{ fontFamily: FONTS.display, fontSize: size, lineHeight: 1.1, color, ...titleStyle, ...urduStyle(p.title, 1.75) }}>{p.title}</div>
      {p.body ? <div style={{ fontFamily: FONTS.sans, fontWeight: 500, fontSize: Math.min(36, size * 0.42), lineHeight: 1.4, color: muted, maxWidth: w * 0.92, ...urduStyle(p.body, 1.9) }}>{p.body}</div> : null}
      {bullets.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: rtl ? "flex-end" : "flex-start", marginTop: 4 }}>
          {bullets.map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, flexDirection: rtl ? "row-reverse" : "row" }}>
              <svg width={30} height={30} viewBox="0 0 30 30" style={{ flexShrink: 0 }}>
                <path d={star(15, 15, 8, 14, 8)} fill={accent} />
              </svg>
              <div style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize: 32, color, lineHeight: 1.3, textAlign: rtl ? "right" : "left", ...urduStyle(b, 1.8) }}>{b}</div>
            </div>
          ))}
        </div>
      ) : null}
      {p.cta ? (
        <div style={{ marginTop: 10, background: ctaBg ?? accent, color: accentFg, fontFamily: FONTS.sans, fontWeight: 800, fontSize: 28, padding: "14px 34px", borderRadius: 999, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", ...urduStyle(p.cta, 1.7) }}>
          {p.cta}
          {p.price ? ` · ${p.price}` : ""}
        </div>
      ) : null}
    </div>
  );
};

const BrandChip: React.FC<{ p: PersianCardProps; y: number; color: string; pill?: string }> = ({ p, y, color, pill }) => (
  <div style={{ position: "absolute", top: y, left: "50%", transform: "translateX(-50%)", display: "flex", justifyContent: "center", alignItems: "center", gap: 14, whiteSpace: "nowrap", ...(pill ? { background: pill, padding: "8px 26px 8px 10px", borderRadius: 999 } : {}) }}>
    {p.brand.logoUrl ? <Img src={p.brand.logoUrl} style={{ width: 52, height: 52, borderRadius: 26, background: "#fff", objectFit: "contain", padding: 3 }} /> : null}
    <div style={{ fontFamily: FONTS.display, fontSize: 32, color, letterSpacing: 1 }}>{p.footer || p.brand.name}</div>
  </div>
);

// ------------------------------------------------------------------ variants
// Palettes follow contemporary Iranian design: one paper/ground colour, one or two craft colours, calligraphy-led
// type and plenty of space — never the whole jewel box at once.
const PAL = {
  mihrab: { ground: "#ECE2CF", ink: "#24201C", accent: "#9A3B26", soft: "#C9B48F" },
  toranj: { madder: "#7B2D26", madderDark: "#5F211C", indigo: "#1E2940", ivory: "#EBDFC6", camel: "#B89064", ink: "#2A1F1A" },
  tazhib: { paper: "#EEE2C6", ink: "#231A13", blue: "#27407E", gold: "#B8914E" },
  kashi: { cream: "#F2ECDF", blue: "#1F4F91", white: "#FBF8F1", saffron: "#DB9B2E", ink: "#1B2F55" },
  shab: { top: "#0B1229", bottom: "#1A2850", gold: "#C9A462", cream: "#EFE6D2", dome: "#080E21" },
  kaghaz: { kraft: "#C49A63", ink: "#1B1612", seal: "#8C2A1E" },
};

/** Fine paper grain (multiply). */
const Grain: React.FC<{ W: number; H: number; id: string; opacity?: number; freq?: number }> = ({ W, H, id, opacity = 0.18, freq = 0.9 }) => (
  <svg width={W} height={H} style={{ position: "absolute", inset: 0, mixBlendMode: "multiply", opacity, pointerEvents: "none" }}>
    <filter id={id}>
      <feTurbulence type="fractalNoise" baseFrequency={freq} numOctaves={3} stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" />
    </filter>
    <rect width={W} height={H} filter={`url(#${id})`} />
  </svg>
);

function Mihrab(p: PersianCardProps) {
  const { W, H } = p;
  const c = PAL.mihrab;
  const hasMedia = !!p.media;
  const aw = W * 0.62;
  const ah = H * (hasMedia ? 0.5 : 0.62);
  const ax = (W - aw) / 2;
  const ay = H * 0.1;
  const a = arch(ax, ay, aw, ah);
  return (
    <AbsoluteFill style={{ background: c.ground }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <rect x={W * 0.04} y={W * 0.04} width={W * 0.92} height={H - W * 0.08} fill="none" stroke={c.ink} strokeWidth={2.5} />
        <rect x={W * 0.055} y={W * 0.055} width={W * 0.89} height={H - W * 0.11} fill="none" stroke={c.ink} strokeWidth={1} />
        {/* rust eslimi around the arch shoulders */}
        <Spiral cx={ax - aw * 0.1} cy={ay + aw * 0.42} r={aw * 0.13} turns={1.8} dir={1} rot={200} color={c.accent} leaf={c.accent} sw={2.5} />
        <Spiral cx={ax + aw * 1.1} cy={ay + aw * 0.42} r={aw * 0.13} turns={1.8} dir={-1} rot={-20} color={c.accent} leaf={c.accent} sw={2.5} />
        <Spiral cx={ax - aw * 0.05} cy={ay + aw * 0.12} r={aw * 0.07} turns={1.5} dir={-1} rot={90} color={c.accent} leaf={c.accent} sw={2} />
        <Spiral cx={ax + aw * 1.05} cy={ay + aw * 0.12} r={aw * 0.07} turns={1.5} dir={1} rot={90} color={c.accent} leaf={c.accent} sw={2} />
        <path d={a} fill={c.ink} />
        <path d={arch(ax + 16, ay + 22, aw - 32, ah - 22)} fill="none" stroke={c.soft} strokeWidth={1.5} opacity={0.55} />
        <path d={star(W / 2, ay - 34, 8, 20, 9)} fill={c.accent} />
      </svg>
      {hasMedia ? (
        <div style={{ position: "absolute", inset: 0, clipPath: `path('${arch(ax + 16, ay + 22, aw - 32, ah - 22)}')` }}>
          <div style={{ position: "absolute", left: ax, top: ay, width: aw, height: ah }}>
            <PhotoOrPhone media={p.media!} bg={c.ink} />
          </div>
        </div>
      ) : null}
      {hasMedia ? (
        <TextBlock x={W * 0.11} y={ay + ah + 30} w={W * 0.78} h={H - (ay + ah + 30) - H * 0.15} color={c.ink} muted={rgba(c.ink, 0.72)} accent={c.accent} accentFg={c.ground} p={p} titleMax={96} />
      ) : (
        <>
          <TextBlock x={ax + aw * 0.12} y={ay + aw * 0.4} w={aw * 0.76} h={ah - aw * 0.4 - 40} color={c.ground} muted={rgba(c.ground, 0.8)} accent={c.soft} accentFg={c.ink} p={{ ...p, cta: undefined }} titleMax={100} />
          {p.cta ? (
            <div style={{ position: "absolute", left: 0, right: 0, top: ay + ah + 40, display: "flex", justifyContent: "center" }}>
              <div style={{ background: c.accent, color: c.ground, fontFamily: FONTS.sans, fontWeight: 700, fontSize: 28, padding: "14px 34px", borderRadius: 999, ...urduStyle(p.cta, 1.7) }}>{p.cta}</div>
            </div>
          ) : null}
        </>
      )}
      <Grain W={W} H={H} id="g-mihrab" />
      <BrandChip p={p} y={H - W * 0.055 - 84} color={c.ink} />
    </AbsoluteFill>
  );
}

function Toranj(p: PersianCardProps) {
  const { W, H } = p;
  const c = PAL.toranj;
  const b = W * 0.07;
  const o = W * 0.035;
  const inner = { x: o + b + 12, y: o + b + 12, w: W - 2 * (o + b + 12), h: H - 2 * (o + b + 12) };
  const cx = W / 2;
  const cy = H / 2;
  const rx = inner.w * 0.43;
  const ry = Math.min(inner.h * 0.37, rx * 1.4);
  const R = inner.w * 0.17;
  return (
    <AbsoluteFill style={{ background: c.indigo }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <pattern id="tf" width={W * 0.09} height={W * 0.09} patternUnits="userSpaceOnUse">
            {(() => {
              const t = W * 0.09;
              const m = t / 2;
              return (
                <g>
                  {[45, 135, 225, 315].map((r) => (
                    <path key={r} d={LEAF(t * 0.28)} transform={`translate(${m} ${m}) rotate(${r})`} fill={c.madderDark} />
                  ))}
                  <circle cx={m} cy={m} r={t * 0.05} fill={rgba(c.camel, 0.55)} />
                </g>
              );
            })()}
          </pattern>
        </defs>
        <rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} fill={c.madder} />
        <rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} fill="url(#tf)" />
        <ScrollBand x={o} y={o} w={W - 2 * o} h={b} color={c.camel} leaf={c.camel} bg={c.indigo} edge={c.camel} />
        <ScrollBand x={o} y={H - o - b} w={W - 2 * o} h={b} color={c.camel} leaf={c.camel} bg={c.indigo} edge={c.camel} />
        <g transform={`translate(${o + b} ${o + b}) rotate(90)`}>
          <ScrollBand x={0} y={0} w={H - 2 * (o + b)} h={b} color={c.camel} leaf={c.camel} bg={c.indigo} edge={c.camel} />
        </g>
        <g transform={`translate(${W - o} ${o + b}) rotate(90)`}>
          <ScrollBand x={0} y={0} w={H - 2 * (o + b)} h={b} color={c.camel} leaf={c.camel} bg={c.indigo} edge={c.camel} />
        </g>
        <rect x={inner.x - 6} y={inner.y - 6} width={inner.w + 12} height={inner.h + 12} fill="none" stroke={c.ivory} strokeWidth={2} />
        <Lachak x={inner.x} y={inner.y} R={R} rot={0} a={c.indigo} b={c.madderDark} gold={c.camel} />
        <Lachak x={inner.x + inner.w} y={inner.y} R={R} rot={90} a={c.indigo} b={c.madderDark} gold={c.camel} />
        <Lachak x={inner.x + inner.w} y={inner.y + inner.h} R={R} rot={180} a={c.indigo} b={c.madderDark} gold={c.camel} />
        <Lachak x={inner.x} y={inner.y + inner.h} R={R} rot={270} a={c.indigo} b={c.madderDark} gold={c.camel} />
        {[-1, 1].map((s) => (
          <g key={s}>
            <path d={lobed(cx, cy + s * (ry + R * 0.3), R * 0.36, 10, 0.12)} fill={c.indigo} stroke={c.camel} strokeWidth={2.5} />
            <path d={star(cx, cy + s * (ry + R * 0.3), 8, R * 0.2, R * 0.11)} fill={c.camel} />
          </g>
        ))}
        <path d={toranjPath(cx, cy, rx + 14, ry + 14, 18, 0.06)} fill={c.indigo} />
        <path d={toranjPath(cx, cy, rx, ry, 18, 0.06)} fill={c.ivory} stroke={c.camel} strokeWidth={3} />
        <path d={toranjPath(cx, cy, rx - 18, ry - 18, 18, 0.06)} fill="none" stroke={rgba(c.camel, 0.8)} strokeWidth={2} strokeDasharray="1 10" strokeLinecap="round" />
      </svg>
      {p.media ? (
        <div style={{ position: "absolute", left: cx - rx * 0.52, top: cy - ry * 0.84, width: rx * 1.04, height: ry * 0.6, borderRadius: 18, overflow: "hidden", border: `3px solid ${c.indigo}` }}>
          <PhotoOrPhone media={p.media} bg={c.indigo} />
        </div>
      ) : null}
      <TextBlock
        x={cx - rx * 0.76}
        y={p.media ? cy - ry * 0.2 : cy - ry * 0.74}
        w={rx * 1.52}
        h={p.media ? ry * 0.98 : ry * 1.48}
        color={c.ink}
        muted={rgba(c.ink, 0.72)}
        accent={c.madder}
        accentFg={c.ivory}
        p={p}
        titleMax={86}
      />
      <Grain W={W} H={H} id="g-toranj" opacity={0.14} />
      <BrandChip p={p} y={o + b + 30} color={c.ivory} />
    </AbsoluteFill>
  );
}

function Tazhib(p: PersianCardProps) {
  const { W, H } = p;
  const c = PAL.tazhib;
  const m = W * 0.075;
  const panelH = H * 0.17;
  const rtl = isUrdu(p.title);
  const mediaH = H * 0.32;
  const textTop = p.media ? m + panelH + 36 + mediaH + 28 : m + panelH + 40;
  return (
    <AbsoluteFill style={{ background: c.paper }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <rect x={m * 0.5} y={m * 0.5} width={W - m} height={H - m} fill="none" stroke={c.gold} strokeWidth={4} />
        <rect x={m * 0.66} y={m * 0.66} width={W - m * 1.32} height={H - m * 1.32} fill="none" stroke={c.blue} strokeWidth={1.2} />
        <rect x={m * 0.78} y={m * 0.78} width={W - m * 1.56} height={H - m * 1.56} fill="none" stroke={c.gold} strokeWidth={1.2} />
        <rect x={m} y={m} width={W - 2 * m} height={panelH} fill={c.blue} />
        {[0.12, 0.3, 0.7, 0.88].map((f, i) => (
          <Spiral key={i} cx={m + (W - 2 * m) * f} cy={m + panelH / 2} r={panelH * 0.27} turns={1.7} dir={i % 2 ? -1 : 1} rot={i * 90} color={c.gold} leaf={c.gold} sw={2.2} />
        ))}
        <rect x={m} y={m} width={W - 2 * m} height={panelH} fill="none" stroke={c.gold} strokeWidth={3} />
        <path d={lobed(W / 2, m + panelH / 2, panelH * 0.4, 12, 0.1)} fill={c.paper} stroke={c.gold} strokeWidth={3} />
        <path d={star(W / 2, m + panelH / 2, 8, panelH * 0.24, panelH * 0.14)} fill={c.gold} />
        <circle cx={W / 2} cy={m + panelH / 2} r={panelH * 0.06} fill={c.blue} />
        {Array.from({ length: 5 }, (_, i) => (
          <path key={i} d={star(W / 2 + (i - 2) * 40, H - m - 26, 8, 10, 5)} fill={c.gold} />
        ))}
      </svg>
      {p.media ? (
        <div style={{ position: "absolute", left: W * 0.22, top: m + panelH + 36, width: W * 0.56, height: mediaH, border: `2px solid ${c.gold}`, overflow: "hidden" }}>
          <PhotoOrPhone media={p.media} bg={rgba(c.blue, 0.1)} />
        </div>
      ) : null}
      <TextBlock x={m * 1.5} y={textTop} w={W - m * 3} h={H - textTop - m - 150} color={c.ink} muted={rgba(c.ink, 0.7)} accent={c.blue} accentFg={c.paper} p={p} titleMax={rtl ? 92 : 100} />
      <Grain W={W} H={H} id="g-tazhib" opacity={0.2} />
      <BrandChip p={p} y={H - m - 112} color={c.ink} />
    </AbsoluteFill>
  );
}

// ---- shared craft helpers (iwan + night) ----
const FOIL_CSS = "linear-gradient(100deg, #8A672C 0%, #E8CD86 28%, #A47D39 52%, #F6E4A8 74%, #8A672C 100%)";
const foilText: React.CSSProperties = { background: FOIL_CSS, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" };

/** Arch outline as an open path (left foot → apex → right foot) for text on a path. */
function archOpen(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const sp = y + w * 0.62;
  const hc = sp - y;
  return `M${x},${y + h} L${x},${sp} C${x},${sp - hc * 0.55} ${cx - w * 0.2},${y + hc * 0.3} ${cx},${y} C${cx + w * 0.2},${y + hc * 0.3} ${x + w},${sp - hc * 0.55} ${x + w},${sp} L${x + w},${y + h}`;
}

const TiltedPhone: React.FC<{ media: MediaRef; left: number; top: number; width: number; height: number; tilt?: number; glow?: string }> = ({ media, left, top, width, height, tilt = -5, glow }) => (
  <div style={{ position: "absolute", left, top, width, height, transform: `rotate(${tilt}deg)`, filter: `drop-shadow(0 30px 40px rgba(0,0,0,0.45))${glow ? ` drop-shadow(0 0 30px ${glow})` : ""}` }}>
    <PhotoOrPhone media={media} bg="transparent" />
  </div>
);

// ------------------------------------------------------------------ KASHI: an Isfahan iwan
function Kashi(p: PersianCardProps) {
  const { W, H } = p;
  const C = { plaster: "#EFE7D6", blue: "#1A4A8E", deep: "#0F2C5C", glazeHi: "#2E6BB8", white: "#FBF8F1", turq: "#2A9FA0", saffron: "#E0A030", ink: "#14294F" };
  const has = !!p.media;
  const px = W * 0.06;
  const py = H * 0.035;
  const pw = W - 2 * px;
  const ph = H * (has ? 0.63 : 0.6);
  const band = W * 0.05; // portal tile frame
  // outer arch (inscription band) and inner tiled arch
  const ax = px + band * 1.5;
  const aw = pw - band * 3;
  const ay = py + band * 1.3;
  const ah = ph - band * 1.3;
  const ib = W * 0.052; // inscription band width
  const ix = ax + ib;
  const iw = aw - 2 * ib;
  const iy = ay + ib * 1.05;
  const ih = ah - ib * 1.05;
  const apex = iy;
  const springIn = iy + iw * 0.62;
  const inscription = (p.eyebrow || p.brand.name || "").trim();
  const insText = Array.from({ length: 14 }, () => inscription).join("   ✦   ");
  const textArch = archOpen(ax + ib / 2, ay + ib / 2, aw - ib, ah);
  // muqarnas rows under the apex
  const mq = has ? 0.62 : 1; // with a phone: a shallower vault, deeper alcove
  const rows = [
    { n: 1, y: apex + iw * 0.08 * mq, w: iw * 0.26 },
    { n: 3, y: apex + iw * 0.2 * mq, w: iw * 0.24 },
    { n: 5, y: apex + iw * 0.33 * mq, w: iw * 0.2 },
  ];
  const alcoveTop = apex + iw * 0.46 * mq;
  return (
    <AbsoluteFill style={{ background: C.plaster }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <radialGradient id="glaze" cx="45%" cy="40%" r="75%">
            <stop offset="0%" stopColor={C.glazeHi} />
            <stop offset="70%" stopColor={C.blue} />
            <stop offset="100%" stopColor={C.deep} />
          </radialGradient>
          {/* main glazed tile: 8-point stars, white strapwork, turquoise + saffron centres */}
          <pattern id="kg" width={W * 0.16} height={W * 0.16} patternUnits="userSpaceOnUse">
            {(() => {
              const T = W * 0.16;
              const c = T / 2;
              return (
                <g>
                  <rect width={T} height={T} fill="url(#glaze)" />
                  <path d={star(c, c, 8, T * 0.43, T * 0.3)} fill="none" stroke={C.white} strokeWidth={T * 0.035} />
                  <path d={star(c, c, 8, T * 0.24, T * 0.15, -67.5)} fill={C.turq} stroke={C.white} strokeWidth={T * 0.02} />
                  <circle cx={c} cy={c} r={T * 0.05} fill={C.saffron} />
                  {[
                    [0, 0],
                    [T, 0],
                    [0, T],
                    [T, T],
                  ].map(([x, y], i) => (
                    <path key={i} d={star(x, y, 4, T * 0.18, T * 0.07, -45)} fill={C.white} />
                  ))}
                </g>
              );
            })()}
          </pattern>
          {/* frame tile: white ground, small blue stars */}
          <pattern id="kf" width={band} height={band} patternUnits="userSpaceOnUse">
            <rect width={band} height={band} fill={C.white} />
            <path d={star(band / 2, band / 2, 8, band * 0.36, band * 0.2)} fill={C.blue} />
            <circle cx={band / 2} cy={band / 2} r={band * 0.07} fill={C.saffron} />
            <path d={star(0, 0, 4, band * 0.16, band * 0.06, -45)} fill={C.turq} />
          </pattern>
          <clipPath id="innerArch">
            <path d={arch(ix, iy, iw, ih)} />
          </clipPath>
          <linearGradient id="alcove" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#081A3A" />
            <stop offset="100%" stopColor={C.deep} />
          </linearGradient>
          <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="10" stdDeviation="14" floodColor="#000" floodOpacity="0.28" />
          </filter>
        </defs>
        {/* pishtaq: portal with tile frame */}
        <g filter="url(#soft)">
          <rect x={px} y={py} width={pw} height={ph} fill="url(#kf)" />
        </g>
        <rect x={px + band} y={py + band} width={pw - 2 * band} height={ph - band} fill={C.deep} />
        <rect x={px} y={py} width={pw} height={ph} fill="none" stroke={C.deep} strokeWidth={3} />
        <rect x={px + band} y={py + band} width={pw - 2 * band} height={ph - band} fill="none" stroke={C.saffron} strokeWidth={2} />
        {/* spandrel arabesques */}
        <Spiral cx={px + band + (ax - px - band) + aw * 0.08} cy={py + band + aw * 0.12} r={aw * 0.1} turns={1.8} dir={1} rot={180} color={C.white} leaf={C.turq} sw={2.5} />
        <Spiral cx={px + band + aw * 0.02} cy={py + band + aw * 0.36} r={aw * 0.07} turns={1.6} dir={-1} color={C.white} leaf={C.turq} sw={2} />
        <Spiral cx={ax + aw * 0.92} cy={py + band + aw * 0.12} r={aw * 0.1} turns={1.8} dir={-1} color={C.white} leaf={C.turq} sw={2.5} />
        <Spiral cx={ax + aw * 0.98 + band * 0.4} cy={py + band + aw * 0.36} r={aw * 0.07} turns={1.6} dir={1} rot={180} color={C.white} leaf={C.turq} sw={2} />
        {/* inscription band (katibeh) */}
        <path d={arch(ax, ay, aw, ah)} fill={C.deep} stroke={C.saffron} strokeWidth={2} />
        <path id="insPath" d={textArch} fill="none" />
        <text fill={C.white} fontFamily={isUrdu(inscription) ? "'Noto Naskh Arabic', serif" : "'DM Serif Display', serif"} fontSize={ib * 0.5} letterSpacing={isUrdu(inscription) ? 0 : 3} dominantBaseline="central">
          <textPath href="#insPath" startOffset="0">
            {insText}
          </textPath>
        </text>
        {/* inner tiled arch */}
        <path d={arch(ix, iy, iw, ih)} fill="url(#kg)" stroke={C.white} strokeWidth={3} />
        <g clipPath="url(#innerArch)">
          {/* muqarnas vault */}
          {rows.map((r, k) =>
            Array.from({ length: r.n }, (_, i) => {
              const cx = ix + iw / 2 + (i - (r.n - 1) / 2) * r.w;
              const cw = r.w * 0.96;
              const chh = iw * 0.13 * mq;
              return (
                <g key={`${k}-${i}`}>
                  <path d={arch(cx - cw / 2, r.y, cw, chh)} fill={k % 2 ? "#DCE6F3" : C.white} stroke={C.blue} strokeWidth={2} />
                  <path d={arch(cx - cw * 0.3, r.y + chh * 0.25, cw * 0.6, chh * 0.75)} fill={k % 2 ? C.turq : C.blue} opacity={0.9} />
                </g>
              );
            }),
          )}
          {/* alcove */}
          <rect x={ix} y={alcoveTop} width={iw} height={iy + ih - alcoveTop} fill="url(#alcove)" />
          <path d={`M${ix},${alcoveTop} H${ix + iw}`} stroke={C.saffron} strokeWidth={3} />
          {!has ? (
            <g>
              {Array.from({ length: 12 }, (_, k) => {
                const a = (k / 12) * Math.PI * 2;
                const r0 = iw * 0.4;
                return <path key={k} d={star(ix + iw / 2 + r0 * Math.cos(a), alcoveTop + (iy + ih - alcoveTop) / 2 + r0 * Math.sin(a), 8, iw * 0.035, iw * 0.018)} fill={k % 2 ? C.turq : C.saffron} />;
              })}
              <circle cx={ix + iw / 2} cy={alcoveTop + (iy + ih - alcoveTop) / 2} r={iw * 0.345} fill="none" stroke={C.white} strokeWidth={2} strokeDasharray="2 9" strokeLinecap="round" />
              <path d={lobed(ix + iw / 2, alcoveTop + (iy + ih - alcoveTop) / 2, iw * 0.3, 12, 0.1)} fill={C.white} />
              <path d={lobed(ix + iw / 2, alcoveTop + (iy + ih - alcoveTop) / 2, iw * 0.27, 12, 0.1)} fill="none" stroke={C.blue} strokeWidth={2} />
              <path d={star(ix + iw / 2, alcoveTop + (iy + ih - alcoveTop) / 2, 8, iw * 0.24, iw * 0.15)} fill={C.blue} />
              <path d={star(ix + iw / 2, alcoveTop + (iy + ih - alcoveTop) / 2, 8, iw * 0.12, iw * 0.07, -67.5)} fill={C.turq} />
              <circle cx={ix + iw / 2} cy={alcoveTop + (iy + ih - alcoveTop) / 2} r={iw * 0.035} fill={C.saffron} />
            </g>
          ) : null}
        </g>
        {/* dado under the portal */}
        <rect x={px} y={py + ph} width={pw} height={10} fill={C.turq} />
        <rect x={px} y={py + ph + 10} width={pw} height={4} fill={C.saffron} />
      </svg>
      {has ? <TiltedPhone media={p.media!} left={ix + iw * 0.1} top={alcoveTop + (iy + ih - alcoveTop) * 0.04} width={iw * 0.8} height={(iy + ih - alcoveTop) * 0.92} tilt={-4} /> : null}
      <TextBlock x={W * 0.09} y={py + ph + 30} w={W * 0.82} h={H - (py + ph + 30) - H * 0.11} color={C.ink} muted={rgba(C.ink, 0.72)} accent={C.blue} accentFg={C.white} p={{ ...p, eyebrow: undefined }} titleMax={96} />
      <Grain W={W} H={H} id="g-kashi" opacity={0.12} />
      <BrandChip p={p} y={H - H * 0.085} color={C.ink} />
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ SHAB: an illustrated Persian night
function skyline(base: number, W: number, seed: number, scale: number, fill: string, windows?: string) {
  const rnd = (i: number) => {
    const r = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    return r - Math.floor(r);
  };
  const items: React.ReactNode[] = [];
  const domes = 5;
  for (let i = 0; i < domes; i++) {
    const x = W * (0.08 + (i / (domes - 1)) * 0.84) + (rnd(i) - 0.5) * W * 0.08;
    const w = W * (0.1 + rnd(i + 9) * 0.07) * scale;
    const h = w * (1.15 + rnd(i + 4) * 0.45);
    const drum = h * 0.42;
    items.push(
      <g key={`d${i}`}>
        <rect x={x - w * 0.42} y={base - drum} width={w * 0.84} height={drum} />
        <path d={`M${x - w / 2},${base - drum} C${x - w / 2},${base - drum - h * 0.62} ${x - w * 0.1},${base - drum - h * 0.72} ${x},${base - drum - h} C${x + w * 0.1},${base - drum - h * 0.72} ${x + w / 2},${base - drum - h * 0.62} ${x + w / 2},${base - drum} Z`} />
        <rect x={x - 2.5 * scale} y={base - drum - h - 34 * scale} width={5 * scale} height={34 * scale} />
        <circle cx={x} cy={base - drum - h - 38 * scale} r={6 * scale} />
        {windows
          ? [-1, 0, 1].map((k) => <path key={k} d={arch(x + k * w * 0.24 - w * 0.035, base - drum * 0.78, w * 0.07, drum * 0.42)} fill={windows} filter="url(#winGlow)" />)
          : null}
      </g>,
    );
    if (rnd(i + 20) > 0.45) {
      const mx = x + (rnd(i + 30) > 0.5 ? 1 : -1) * w * 0.75;
      const mh = h * (1.9 + rnd(i + 40) * 0.7);
      const mw = 13 * scale;
      items.push(
        <g key={`m${i}`}>
          <rect x={mx - mw / 2} y={base - mh} width={mw} height={mh} />
          <rect x={mx - mw * 0.9} y={base - mh * 0.78} width={mw * 1.8} height={7 * scale} />
          <path d={`M${mx - mw * 0.7},${base - mh} L${mx},${base - mh - 40 * scale} L${mx + mw * 0.7},${base - mh} Z`} />
          {windows ? <rect x={mx - mw * 0.2} y={base - mh * 0.6} width={mw * 0.4} height={14 * scale} fill={windows} filter="url(#winGlow)" /> : null}
        </g>,
      );
    }
  }
  return (
    <g fill={fill}>
      {items}
      <rect x={0} y={base} width={W} height={2000} />
    </g>
  );
}

const Lantern: React.FC<{ x: number; top: number; drop: number; s: number }> = ({ x, top, drop, s }) => {
  const y = top + drop;
  const bw = 54 * s;
  const bh = 92 * s;
  return (
    <g>
      <line x1={x} y1={top} x2={x} y2={y - 26 * s} stroke="url(#foil)" strokeWidth={2.5} strokeDasharray="6 4" />
      <circle cx={x} cy={y + bh * 0.45} r={bw * 1.4} fill="url(#lampHalo)" />
      <path d={`M${x - bw * 0.35},${y - 6 * s} Q${x},${y - 34 * s} ${x + bw * 0.35},${y - 6 * s} Z`} fill="url(#foil)" />
      <path d={`M${x - bw / 2},${y} H${x + bw / 2} L${x + bw * 0.62},${y + bh * 0.2} V${y + bh * 0.82} L${x + bw / 2},${y + bh} H${x - bw / 2} L${x - bw * 0.62},${y + bh * 0.82} V${y + bh * 0.2} Z`} fill="url(#foil)" />
      {[-1, 0, 1].map((k) => (
        <path key={k} d={arch(x + k * bw * 0.32 - bw * 0.11, y + bh * 0.24, bw * 0.22, bh * 0.52)} fill="#FFD88A" filter="url(#winGlow)" />
      ))}
      <path d={`M${x - bw * 0.3},${y + bh} L${x},${y + bh + 26 * s} L${x + bw * 0.3},${y + bh} Z`} fill="url(#foil)" />
      <circle cx={x} cy={y + bh + 30 * s} r={4 * s} fill="url(#foil)" />
    </g>
  );
};

function Shab(p: PersianCardProps) {
  const { W, H } = p;
  const C = { top: "#050A1A", mid: "#0F1A3B", low: "#1C2B57", cream: "#F1E7D0", far: "#1A2750", near: "#060B1C", midSky: "#0E1734" };
  const has = !!p.media;
  const baseNear = H * (has ? 0.93 : 0.9);
  const textY = has ? H * 0.05 : H * 0.15;
  const textH = has ? H * 0.3 : H * 0.42;
  const stars = Array.from({ length: 55 }, (_, i) => {
    const r = Math.sin(i * 12.9898) * 43758.5453;
    const f = r - Math.floor(r);
    const g = Math.sin(i * 78.233) * 12345.678;
    const h = g - Math.floor(g);
    return { x: f * W, y: h * H * 0.55, s: 2.5 + ((i * 7) % 6), big: i % 7 === 0 };
  });
  const moon = has ? { x: W * 0.84, y: H * 0.47, r: W * 0.06 } : { x: W * 0.7, y: H * 0.075, r: W * 0.05 };
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${C.top} 0%, ${C.mid} 55%, ${C.low} 100%)` }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="foil" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8A672C" />
            <stop offset="30%" stopColor="#E8CD86" />
            <stop offset="55%" stopColor="#A47D39" />
            <stop offset="78%" stopColor="#F6E4A8" />
            <stop offset="100%" stopColor="#8A672C" />
          </linearGradient>
          <radialGradient id="lampHalo">
            <stop offset="0%" stopColor="rgba(255,205,120,0.35)" />
            <stop offset="100%" stopColor="rgba(255,205,120,0)" />
          </radialGradient>
          <radialGradient id="moonHalo">
            <stop offset="0%" stopColor="rgba(232,205,134,0.22)" />
            <stop offset="100%" stopColor="rgba(232,205,134,0)" />
          </radialGradient>
          <filter id="winGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="starGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <pattern id="skyGirih" width={W * 0.14} height={W * 0.14} patternUnits="userSpaceOnUse">
            <path d={star(W * 0.07, W * 0.07, 8, W * 0.06, W * 0.04)} fill="none" stroke="#E8CD86" strokeWidth={1.2} />
            <path d={star(0, 0, 4, W * 0.025, W * 0.01, -45)} fill="none" stroke="#E8CD86" strokeWidth={1} />
          </pattern>
          <linearGradient id="fadeDown" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity={1} />
            <stop offset="45%" stopColor="#fff" stopOpacity={0} />
          </linearGradient>
          <mask id="skyMask">
            <rect width={W} height={H} fill="url(#fadeDown)" />
          </mask>
          <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(40,60,110,0)" />
            <stop offset="100%" stopColor="rgba(40,60,110,0.55)" />
          </linearGradient>
          <mask id="crescent">
            <circle cx={moon.x} cy={moon.y} r={moon.r} fill="#fff" />
            <circle cx={moon.x + moon.r * 0.42} cy={moon.y - moon.r * 0.2} r={moon.r * 0.86} fill="#000" />
          </mask>
        </defs>
        <rect width={W} height={H} fill="url(#skyGirih)" opacity={0.12} mask="url(#skyMask)" />
        <circle cx={moon.x} cy={moon.y} r={moon.r * 3.2} fill="url(#moonHalo)" />
        <rect x={moon.x - moon.r} y={moon.y - moon.r} width={moon.r * 2} height={moon.r * 2} fill="url(#foil)" mask="url(#crescent)" />
        <g filter="url(#starGlow)">
          {stars.map((s, i) => (
            <path key={i} d={star(s.x, s.y, s.big ? 8 : 4, s.big ? s.s * 2.2 : s.s, s.big ? s.s * 0.8 : s.s * 0.3)} fill={s.big ? "url(#foil)" : "rgba(240,220,160,0.75)"} />
          ))}
        </g>
        <Lantern x={W * 0.1} top={0} drop={H * (has ? 0.36 : 0.1)} s={W / 1080} />
        <Lantern x={W * 0.9} top={0} drop={H * (has ? 0.2 : 0.2)} s={(W / 1080) * 0.8} />
        {skyline(baseNear - H * 0.09, W, 3, 0.8, C.far)}
        <rect x={0} y={baseNear - H * 0.2} width={W} height={H * 0.2} fill="url(#mist)" />
        {skyline(baseNear - H * 0.04, W, 7, 1.0, C.midSky)}
        <rect x={0} y={baseNear - H * 0.12} width={W} height={H * 0.12} fill="url(#mist)" />
        {skyline(baseNear, W, 11, 1.25, C.near, "#F3C46A")}
      </svg>
      {has ? (
        <>
          <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
            <path d={arch(W * 0.29, H * 0.37, W * 0.42, H * 0.43)} fill="rgba(5,10,26,0.65)" stroke="url(#foil)" strokeWidth={5} />
          </svg>
          <TiltedPhone media={p.media!} left={W * 0.31} top={H * 0.43} width={W * 0.38} height={H * 0.36} tilt={0} glow="rgba(232,205,134,0.35)" />
        </>
      ) : null}
      <TextBlock
        x={W * 0.08}
        y={textY}
        w={W * 0.84}
        h={textH}
        color={C.cream}
        muted={rgba(C.cream, 0.85)}
        accent="#E8CD86"
        accentFg="#1A1206"
        eyebrowColor="#E8CD86"
        ctaBg={FOIL_CSS}
        titleStyle={foilText}
        p={p}
        titleMax={108}
      />
      <Grain W={W} H={H} id="g-shab" opacity={0.07} />
      <BrandChip p={p} y={H - 90} color={C.cream} />
    </AbsoluteFill>
  );
}

function Kaghaz(p: PersianCardProps) {
  const { W, H } = p;
  const c = PAL.kaghaz;
  const r = W * 0.2;
  const ox = W * 0.5;
  const oy = p.media ? H * 0.27 : H * 0.3;
  return (
    <AbsoluteFill style={{ background: c.kraft }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        {/* black line-art ornament: lobed medallion with eslimi spirals inside */}
        {!p.media ? (
          <g>
            <path d={lobed(ox, oy, r, 14, 0.1)} fill="none" stroke={c.ink} strokeWidth={4} />
            <path d={lobed(ox, oy, r * 0.84, 14, 0.1)} fill="none" stroke={c.ink} strokeWidth={1.5} />
            {[0, 90, 180, 270].map((a) => (
              <Spiral key={a} cx={ox + r * 0.42 * Math.cos((a * Math.PI) / 180)} cy={oy + r * 0.42 * Math.sin((a * Math.PI) / 180)} r={r * 0.3} turns={1.6} dir={a % 180 ? 1 : -1} rot={a} color={c.ink} leaf={c.ink} sw={2.5} />
            ))}
            <path d={star(ox, oy, 8, r * 0.16, r * 0.09)} fill={c.ink} />
            <line x1={ox} x2={ox} y1={oy - r - 70} y2={oy - r} stroke={c.ink} strokeWidth={2} />
            <circle cx={ox} cy={oy - r - 74} r={6} fill={c.ink} />
          </g>
        ) : null}
        <line x1={W * 0.08} x2={W * 0.92} y1={H * 0.93} y2={H * 0.93} stroke={c.ink} strokeWidth={1.5} />
      </svg>
      {p.media ? (
        <div style={{ position: "absolute", left: W * 0.24, top: H * 0.07, width: W * 0.52, height: H * 0.42, overflow: "hidden" }}>
          <PhotoOrPhone media={p.media} bg={rgba(c.ink, 0.12)} />
        </div>
      ) : null}
      <TextBlock x={W * 0.1} y={p.media ? H * 0.52 : oy + r + 40} w={W * 0.8} h={p.media ? H * 0.32 : H * 0.84 - (oy + r + 40)} color={c.ink} muted={rgba(c.ink, 0.75)} accent={c.ink} accentFg={c.kraft} p={p} titleMax={110} />
      {/* hand-stamp seal */}
      <div style={{ position: "absolute", right: W * 0.08, top: W * 0.08, width: 92, height: 92, background: c.seal, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", transform: "rotate(-6deg)", boxShadow: "inset 0 0 0 4px rgba(255,255,255,0.15)" }}>
        <svg width={56} height={56} viewBox="0 0 56 56">
          <path d={star(28, 28, 8, 26, 13)} fill="none" stroke={c.kraft} strokeWidth={3} />
          <circle cx={28} cy={28} r={6} fill={c.kraft} />
        </svg>
      </div>
      <Grain W={W} H={H} id="g-kaghaz" opacity={0.3} freq={0.75} />
      <BrandChip p={p} y={H * 0.94} color={c.ink} />
    </AbsoluteFill>
  );
}

export const PersianCard: React.FC<PersianCardProps> = (p) => {
  switch (p.variant) {
    case "toranj":
      return <Toranj {...p} />;
    case "tazhib":
      return <Tazhib {...p} />;
    case "kashi":
      return <Kashi {...p} />;
    case "shab":
      return <Shab {...p} />;
    case "kaghaz":
      return <Kaghaz {...p} />;
    default:
      return <Mihrab {...p} />;
  }
};

/** Pick a variant: explicit, else stable by text (so re-renders keep the same look). */
export function pickPersianVariant(v: string | undefined, seed: string): PersianVariant {
  if (v && (PERSIAN_VARIANTS as readonly string[]).includes(v)) return v as PersianVariant;
  let h = 7;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PERSIAN_VARIANTS[h % PERSIAN_VARIANTS.length];
}
