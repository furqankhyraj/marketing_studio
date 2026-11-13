// Shared helpers for HyperFrames HTML templates.
// Every template produces a single self-contained HyperFrames composition (index.html):
//   - root <div id="root" data-composition-id="reel" data-start="0" data-duration=.. data-width="1080" data-height="1920">
//   - one <section class="clip"> per scene + a CTA end card, timed with data-start / data-duration
//   - one paused GSAP timeline registered as window.__timelines["reel"]
// GSAP is loaded from ./gsap.min.js (copied from node_modules at render time -> renders offline).
import type { BrandStyleRef, HtmlReelSpec, Scene } from "../../../shared/types.ts";

export const W = 1080;
export const H = 1920;
export const FPS = 30;
export const COMPOSITION_ID = "reel";
export const GSAP_SRC = "./gsap.min.js";

/** Instagram Reels safe zone (px). Top: status/"Reels" header. Bottom: caption + audio row. Right: like/comment/share rail. */
export const SAFE = { top: 250, bottom: 440, left: 90, right: 140 } as const;

export interface TemplateInput {
  brand: BrandStyleRef;
  scenes: Scene[];
  cta?: { text: string; keyword?: string };
  durationSec?: number;
}

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface MediaSlot {
  name: string; // asset file name (./assets/<name>)
  path: string; // "./assets/<name>"
  kind: "image" | "video";
}

export interface TimedScene extends Scene {
  idx: number;
  start: number;
  dur: number;
  end: number;
  m?: MediaSlot;
}

export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  onPrimary: string;
  onSecondary: string;
  onAccent: string;
  onBackground: string;
  dark: string; // darkest of the brand colors (for overlays)
  light: string; // lightest of the brand colors
}

export interface Ctx {
  brand: BrandStyleRef;
  name: string;
  handle: string;
  pal: Palette;
  headingFont: string; // CSS font-family stack
  bodyFont: string;
  scenes: TimedScene[];
  cta: { text: string; keyword?: string; start: number; dur: number; end: number };
  total: number;
  logo?: MediaSlot;
  assets: { name: string; src: string }[];
}

export interface TemplateParts {
  css: string;
  body: string; // scene sections (inside #root, after the shared background/brand bar)
  js: string; // timeline statements; `tl` is the paused timeline
}

export interface TemplateDef extends TemplateMeta {
  defaultSceneSec: number;
  ctaSec: number;
  fonts: { heading: string; body: string };
  build(ctx: Ctx): TemplateParts;
  /** optional cover-frame time (seconds) */
  thumbAt?(ctx: Ctx): number;
}

// ---------------------------------------------------------------- text utils
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strip *accent* markers. */
export function plain(s: string | undefined): string {
  return String(s ?? "").replace(/\*/g, "");
}

export interface Token {
  text: string;
  accent: boolean;
}

/** Split text into words; words wrapped in *asterisks* (single or multi-word) are flagged accent. */
export function tokens(s: string | undefined): Token[] {
  const out: Token[] = [];
  const parts = String(s ?? "").split("*");
  parts.forEach((part, i) => {
    const accent = i % 2 === 1;
    for (const w of part.split(/\s+/).filter(Boolean)) {
      // glue stray punctuation ("*present*." / "word ,") onto the previous word
      if (/^[.,!?;:…'"”’)\]]+$/.test(w) && out.length) out[out.length - 1].text += w;
      else out.push({ text: w, accent });
    }
  });
  return out;
}

/** Inline rich text: *accent* -> <em class="acc">. */
export function rich(s: string | undefined): string {
  const parts = String(s ?? "").split("*");
  return parts.map((p, i) => (i % 2 === 1 ? `<em class="acc">${esc(p)}</em>` : esc(p))).join("");
}

/** Word spans for staggered reveals. If no *accent* marker exists and `autoAccentLast`, the last word is accented. */
export function wordSpans(s: string | undefined, cls = "w", autoAccentLast = false): string {
  const t = tokens(s);
  if (autoAccentLast && t.length > 1 && !t.some((x) => x.accent)) t[t.length - 1].accent = true;
  return t
    .map((x) => `<span class="${cls}${x.accent ? " acc" : ""}"><span class="wi">${esc(x.text)}</span></span>`)
    .join(" ");
}

/** Font size that shrinks with text length. */
export function fit(text: string | undefined, maxPx: number, minPx: number, charsAtMax: number): number {
  const len = Math.max(1, plain(text).length);
  const size = len <= charsAtMax ? maxPx : maxPx * Math.sqrt(charsAtMax / len);
  return Math.round(Math.max(minPx, Math.min(maxPx, size)));
}

/** Longest word length — big kinetic type must not overflow horizontally. */
export function fitWords(text: string | undefined, maxPx: number, minPx: number, widthPx: number, charW = 0.62): number {
  const longest = Math.max(1, ...tokens(text).map((t) => t.text.length));
  const byWord = widthPx / (longest * charW);
  return Math.round(Math.max(minPx, Math.min(maxPx, byWord)));
}

// ---------------------------------------------------------------- color utils
function normHex(c: string | undefined, fallback: string): string {
  let s = String(c ?? "").trim();
  if (/^#?[0-9a-f]{3}$/i.test(s)) s = s.replace("#", "").split("").map((ch) => ch + ch).join("");
  s = s.replace("#", "");
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toUpperCase()}` : fallback;
}

export function rgb(hex: string): [number, number, number] {
  const h = normHex(hex, "#000000").slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Best readable text color on `bg` among candidates (falls back to white/near-black). */
export function onColor(bg: string, ...candidates: string[]): string {
  for (const c of candidates) if (c && contrast(bg, c) >= 4.5) return c;
  return contrast(bg, "#FFFFFF") >= contrast(bg, "#111111") ? "#FFFFFF" : "#111111";
}

/** Nudge `fg` toward white or black until it reaches `min` contrast against `bg` (keeps the hue). */
export function readable(fg: string, bg: string, min = 3.2): string {
  if (contrast(fg, bg) >= min) return fg;
  const target = luminance(bg) < 0.4 ? "#FFFFFF" : "#000000";
  for (let t = 0.1; t <= 1.001; t += 0.1) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}

export function palette(brand: BrandStyleRef): Palette {
  const c = brand.colors ?? ({} as BrandStyleRef["colors"]);
  const primary = normHex(c.primary, "#1E3A8A");
  const secondary = normHex(c.secondary, mix(primary, "#FFFFFF", 0.35));
  const accent = normHex(c.accent, "#F59E0B");
  const background = normHex(c.background, "#FFFFFF");
  const text = normHex(c.text, onColor(background));
  const all = [primary, secondary, accent, background, text];
  const sorted = [...all].sort((a, b) => luminance(a) - luminance(b));
  let dark = sorted[0];
  if (luminance(dark) > 0.08) dark = mix(dark, "#000000", 0.7);
  let light = sorted[sorted.length - 1];
  if (luminance(light) < 0.75) light = mix(light, "#FFFFFF", 0.85);
  return {
    primary,
    secondary,
    accent,
    background,
    text: contrast(background, text) >= 3 ? text : onColor(background),
    onPrimary: onColor(primary, background, text, light),
    onSecondary: onColor(secondary, text, background, dark),
    onAccent: onColor(accent, dark, text, background),
    onBackground: onColor(background, text, primary, dark),
    dark,
    light,
  };
}

export function fontStack(primary: string | undefined, fallback: string, generic = "sans-serif"): string {
  const fams = [primary, fallback].filter(Boolean).map((f) => `"${String(f).replace(/["\\]/g, "")}"`);
  const sys = generic === "serif" ? `Georgia, "Times New Roman", serif` : `"Segoe UI", Arial, Helvetica, sans-serif`;
  return [...new Set(fams)].join(", ") + ", " + sys;
}

// ---------------------------------------------------------------- media / assets
function extOf(src: string, kind: "image" | "video"): string {
  try {
    const p = new URL(src).pathname.toLowerCase();
    const m = p.match(/\.(png|jpe?g|webp|gif|avif|svg|mp4|mov|webm|m4v)$/);
    if (m) return m[1] === "jpeg" ? "jpg" : m[1];
  } catch {
    /* not a URL */
  }
  return kind === "video" ? "mp4" : "jpg";
}

// ---------------------------------------------------------------- context
export function makeCtx(def: TemplateDef, input: TemplateInput): Ctx {
  const brand = input.brand ?? ({ name: "Brand", colors: {} } as unknown as BrandStyleRef);
  const pal = palette(brand);
  const assets: { name: string; src: string }[] = [];

  let logo: MediaSlot | undefined;
  if (brand.logoUrl && /^https?:\/\//i.test(brand.logoUrl)) {
    const name = `logo.${extOf(brand.logoUrl, "image")}`;
    assets.push({ name, src: brand.logoUrl });
    logo = { name, path: `./assets/${name}`, kind: "image" };
  }

  const raw = (input.scenes ?? []).filter(Boolean);
  const scenesIn: Scene[] = raw.length
    ? raw
    : [{ id: "s1", durationSec: def.defaultSceneSec, headline: brand.name ?? "Hello" }];

  const ctaSec = def.ctaSec;
  let durs = scenesIn.map((s) => {
    const d = Number(s.durationSec);
    return Number.isFinite(d) && d > 0 ? Math.min(12, Math.max(1.2, d)) : def.defaultSceneSec;
  });
  if (input.durationSec && input.durationSec > ctaSec + 1) {
    const target = input.durationSec - ctaSec;
    const sum = durs.reduce((a, b) => a + b, 0);
    durs = durs.map((d) => Math.max(1.2, (d * target) / sum));
  }
  durs = durs.map((d) => Math.round(d * 10) / 10);

  let t = 0;
  const scenes: TimedScene[] = scenesIn.map((s, idx) => {
    const dur = durs[idx];
    let m: MediaSlot | undefined;
    if (s.media?.src && /^https?:\/\//i.test(s.media.src)) {
      const kind = s.media.kind === "video" ? "video" : "image";
      const name = `scene-${idx + 1}.${extOf(s.media.src, kind)}`;
      assets.push({ name, src: s.media.src });
      m = { name, path: `./assets/${name}`, kind };
    }
    const ts: TimedScene = { ...s, idx, start: round(t), dur, end: round(t + dur), m };
    t += dur;
    return ts;
  });
  const ctaStart = round(t);
  const total = round(t + ctaSec);

  const handle = brand.handle ? (brand.handle.startsWith("@") ? brand.handle : `@${brand.handle}`) : "";
  return {
    brand,
    name: brand.name || "Brand",
    handle,
    pal,
    headingFont: fontStack(brand.fonts?.heading, def.fonts.heading, /serif/i.test(def.fonts.heading) && !/sans/i.test(def.fonts.heading) ? "serif" : "sans-serif"),
    bodyFont: fontStack(brand.fonts?.body, def.fonts.body),
    scenes,
    cta: {
      text: input.cta?.text?.trim() || (handle ? `Follow ${handle} for more` : "Follow for more"),
      keyword: input.cta?.keyword?.trim().replace(/\s+/g, "").toUpperCase() || undefined,
      start: ctaStart,
      dur: ctaSec,
      end: total,
    },
    total,
    logo,
    assets,
  };
}

export function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Shorthand: time n seconds into scene. */
export function at(s: { start: number }, n: number): string {
  return String(round(s.start + n));
}

/** Media element. Images get a brand gradient underneath (visible if the asset fails to load). */
export function mediaTag(s: TimedScene, cls: string, extra = ""): string {
  if (!s.m) return "";
  if (s.m.kind === "video") {
    return `<video id="vid-${s.idx}" class="${cls}" src="${s.m.path}" muted playsinline data-start="${s.start}" data-duration="${s.dur}" data-track-index="3" ${extra}></video>`;
  }
  return `<img class="${cls}" src="${s.m.path}" alt="" ${extra} />`;
}

/** Logo or monogram. */
export function logoTag(ctx: Ctx, cls: string): string {
  if (ctx.logo) return `<div class="${cls}"><img src="${ctx.logo.path}" alt="" /></div>`;
  const initials = plain(ctx.name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return `<div class="${cls} mono"><span>${esc(initials || "★")}</span></div>`;
}

// ---------------------------------------------------------------- shared chrome
export function baseCss(ctx: Ctx): string {
  const p = ctx.pal;
  return `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:${p.dark}}
:root{--primary:${p.primary};--secondary:${p.secondary};--accent:${p.accent};--bg:${p.background};--text:${p.text};
--on-primary:${p.onPrimary};--on-secondary:${p.onSecondary};--on-accent:${p.onAccent};--on-bg:${p.onBackground};--dark:${p.dark};--light:${p.light};
--fh:${ctx.headingFont};--fb:${ctx.bodyFont}}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;isolation:isolate;background:var(--bg);font-family:var(--fb);color:var(--text)}
.clip{position:absolute;inset:0;overflow:hidden}
.safe{position:absolute;left:${SAFE.left}px;right:${SAFE.right}px;top:${SAFE.top}px;bottom:${SAFE.bottom}px}
em.acc,.acc{font-style:normal}
img{display:block}
.cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.brandbar{position:absolute;left:${SAFE.left}px;top:${SAFE.top - 70}px;display:flex;align-items:center;gap:18px;z-index:50;font:700 30px/1 var(--fb);letter-spacing:.02em}
.brandbar .lg{width:58px;height:58px;border-radius:50%;overflow:hidden;flex:none;background:var(--accent);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.25)}
.brandbar .lg img{width:100%;height:100%;object-fit:cover}
.mono span{font:800 26px/1 var(--fh);color:var(--on-accent)}
`;
}

/** Small logo + handle chip shown during scenes (not on the CTA card). */
export function brandBar(ctx: Ctx, color: string, extraStyle = ""): string {
  const label = ctx.handle || ctx.name;
  return `<div id="brandbar" class="clip brandbar-clip" data-start="0" data-duration="${ctx.cta.start}" data-track-index="9" style="inset:auto;left:0;top:0;width:${W}px;height:${SAFE.top}px;overflow:visible;z-index:50">
  <div class="brandbar" style="color:${color};${extraStyle}">${logoTag(ctx, "lg")}<span>${esc(label)}</span></div>
</div>`;
}

// ---------------------------------------------------------------- CTA end card
export type CtaVariant = "pill" | "button" | "sticker" | "minimal";

export interface CtaOpts {
  variant: CtaVariant;
  bg: string; // CSS background
  fg: string;
  pillBg: string;
  pillFg: string;
  eyebrow?: string; // small text above the keyword, default "Comment"
  buttonLabel?: string; // for "button" variant
  btnBg?: string;
  btnFg?: string;
}

export function ctaCss(): string {
  return `
#cta{display:flex;align-items:center;justify-content:center}
#cta .inner{position:absolute;left:${SAFE.left}px;right:${SAFE.right - 40}px;top:${SAFE.top + 40}px;bottom:${SAFE.bottom}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:34px}
#cta .clogo{width:190px;height:190px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--accent);box-shadow:0 20px 60px rgba(0,0,0,.3)}
#cta .clogo img{width:100%;height:100%;object-fit:cover}
#cta .clogo.mono span{font-size:76px}
#cta .eyebrow{font:800 46px/1 var(--fb);letter-spacing:.28em;text-transform:uppercase;opacity:.85}
#cta .kw{display:inline-block;padding:34px 70px;border-radius:999px;font:900 132px/1 var(--fh);letter-spacing:.02em;text-transform:uppercase;box-shadow:0 24px 70px rgba(0,0,0,.35)}
#cta .kw.small{font-size:96px}
#cta .kw.xsmall{font-size:72px}
#cta .ctext{font:700 50px/1.25 var(--fb);max-width:820px}
#cta .ctext.big{font:900 92px/1.05 var(--fh)}
#cta .chandle{font:700 38px/1 var(--fb);opacity:.8;letter-spacing:.04em}
#cta .btn{display:inline-flex;align-items:center;gap:22px;padding:30px 64px;border-radius:24px;font:900 54px/1 var(--fh);text-transform:uppercase;letter-spacing:.06em;box-shadow:0 18px 50px rgba(0,0,0,.35)}
#cta .arrow{font:900 90px/1 var(--fb)}
#cta .burst{position:absolute;width:1500px;height:1500px;left:50%;top:46%;margin:-750px 0 0 -750px;border-radius:50%;opacity:.16;
background:repeating-conic-gradient(currentColor 0 6deg, transparent 6deg 18deg)}
`;
}

export function ctaHtml(ctx: Ctx, o: CtaOpts): string {
  const kw = ctx.cta.keyword;
  const kwCls = !kw ? "" : kw.length > 8 ? "xsmall" : kw.length > 5 ? "small" : "";
  const parts: string[] = [];
  parts.push(logoTag(ctx, "clogo c-a"));
  if (kw) {
    parts.push(`<div class="eyebrow c-b">${esc(o.eyebrow ?? "Comment")}</div>`);
    parts.push(`<div class="kw c-kw ${kwCls}" style="background:${o.pillBg};color:${o.pillFg}">${esc(kw)}</div>`);
    parts.push(`<div class="ctext c-c">${rich(ctx.cta.text)}</div>`);
  } else {
    parts.push(`<div class="ctext big c-c">${rich(ctx.cta.text)}</div>`);
  }
  if (o.variant === "button") {
    parts.push(`<div class="btn c-btn" style="background:${o.btnBg ?? o.pillBg};color:${o.btnFg ?? o.pillFg}">${esc(o.buttonLabel ?? "Learn more")} <span>&#8594;</span></div>`);
  } else if (!kw) {
    parts.push(`<div class="arrow c-arrow">&#8595;</div>`);
  }
  if (ctx.handle) parts.push(`<div class="chandle c-d">${esc(ctx.handle)}</div>`);
  const burst = o.variant === "sticker" || o.variant === "pill" ? `<div class="burst c-burst" style="color:${o.fg}"></div>` : "";
  return `<section id="cta" class="clip" data-start="${ctx.cta.start}" data-duration="${ctx.cta.dur}" data-track-index="1" style="background:${o.bg};color:${o.fg}">
  ${burst}
  <div class="inner">${parts.join("\n    ")}</div>
</section>`;
}

export function ctaJs(ctx: Ctx): string {
  const s = ctx.cta;
  const a = (n: number) => round(s.start + n);
  return `
if (document.querySelector("#cta .c-burst")) tl.fromTo("#cta .c-burst",{rotation:0,scale:.8},{rotation:40,scale:1.05,duration:${s.dur},ease:"none"},${s.start});
tl.fromTo("#cta .c-a",{scale:0,rotation:-25},{scale:1,rotation:0,duration:.6,ease:"back.out(2)"},${a(0.05)});
if (document.querySelector("#cta .c-b")) tl.fromTo("#cta .c-b",{y:40,opacity:0},{y:0,opacity:.85,duration:.45,ease:"power3.out"},${a(0.3)});
if (document.querySelector("#cta .c-kw")) {
  tl.fromTo("#cta .c-kw",{scale:.3,opacity:0,rotation:-6},{scale:1,opacity:1,rotation:-2,duration:.6,ease:"back.out(2.2)"},${a(0.45)});
  tl.to("#cta .c-kw",{scale:1.07,duration:.42,ease:"sine.inOut",yoyo:true,repeat:${Math.max(1, Math.floor((s.dur - 1.3) / 0.42) | 1)}},${a(1.1)});
}
tl.fromTo("#cta .c-c",{y:50,opacity:0},{y:0,opacity:1,duration:.5,ease:"power3.out"},${a(0.7)});
if (document.querySelector("#cta .c-btn")) {
  tl.fromTo("#cta .c-btn",{y:60,opacity:0},{y:0,opacity:1,duration:.5,ease:"back.out(1.8)"},${a(0.9)});
  tl.to("#cta .c-btn",{scale:1.05,duration:.4,ease:"sine.inOut",yoyo:true,repeat:3},${a(1.5)});
}
if (document.querySelector("#cta .c-arrow")) tl.fromTo("#cta .c-arrow",{y:-20,opacity:0},{y:20,opacity:1,duration:.45,ease:"sine.inOut",yoyo:true,repeat:5},${a(0.9)});
if (document.querySelector("#cta .c-d")) tl.fromTo("#cta .c-d",{opacity:0},{opacity:.8,duration:.4},${a(1.0)});
`;
}

// ---------------------------------------------------------------- document assembly
export function assemble(def: TemplateDef, ctx: Ctx, parts: TemplateParts): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
<title>${esc(ctx.name)} — ${esc(def.name)}</title>
<script src="${GSAP_SRC}"></script>
<style>${baseCss(ctx)}${ctaCss()}${parts.css}</style>
</head>
<body>
<div id="root" data-composition-id="${COMPOSITION_ID}" data-start="0" data-duration="${ctx.total}" data-width="${W}" data-height="${H}" data-thumb-at="${def.thumbAt ? def.thumbAt(ctx) : thumbAt(ctx)}">
${parts.body}
</div>
<script>
(function(){
  var tl = gsap.timeline({ paused: true });
  ${parts.js}
  ${ctaJs(ctx)}
  // pin the timeline length to the composition duration
  tl.set({}, {}, ${ctx.total});
  window.__timelines = window.__timelines || {};
  window.__timelines["${COMPOSITION_ID}"] = tl;
})();
</script>
</body>
</html>
`;
}

export function buildSpec(def: TemplateDef, input: TemplateInput): HtmlReelSpec {
  const ctx = makeCtx(def, input);
  const parts = def.build(ctx);
  return {
    engine: "hyperframes",
    width: W,
    height: H,
    fps: FPS,
    durationSec: ctx.total,
    html: assemble(def, ctx, parts),
    template: def.id,
    assets: ctx.assets,
    brand: input.brand,
    // kept so the server can re-time scenes to a voiceover and rebuild the HTML
    templateInput: { brand: input.brand, scenes: input.scenes ?? [], ...(input.cta ? { cta: input.cta } : {}), ...(input.durationSec ? { durationSec: input.durationSec } : {}) },
  };
}

/** Cover-frame time: late in the first scene, after its intro animations, before its exit. */
export function thumbAt(ctx: Ctx): number {
  const s = ctx.scenes[0];
  if (!s) return round(ctx.cta.start + 1.5);
  return round(s.start + Math.max(0.6, s.dur - 0.5));
}
