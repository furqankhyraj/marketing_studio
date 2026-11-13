import { at, brandBar, ctaHtml, esc, fit, fitWords, mediaTag, rgba, rich, round, wordSpans, type Ctx, type TemplateDef, type TimedScene } from "./common.ts";

function look(ctx: Ctx, i: number) {
  const p = ctx.pal;
  const looks = [
    { bg: p.primary, fg: p.onPrimary },
    { bg: p.dark, fg: "#FFFFFF" },
    { bg: p.background, fg: p.onBackground },
  ];
  return looks[i % looks.length];
}

function scene(ctx: Ctx, s: TimedScene): string {
  const lk = look(ctx, s.idx);
  const size = Math.min(fitWords(s.headline, 176, 72, 850, ctx.brand.fonts?.heading ? 0.72 : 0.5), fit(s.headline, 176, 80, 16));
  const media = s.m
    ? `<div class="bgm">${mediaTag(s, "cover kz")}</div><div class="shade" style="background:linear-gradient(180deg,${rgba(ctx.pal.dark, 0.55)} 0%,${rgba(ctx.pal.dark, 0.35)} 45%,${rgba(ctx.pal.dark, 0.85)} 100%)"></div>`
    : "";
  const fg = s.m ? "#FFFFFF" : lk.fg;
  const bullets = s.bullets?.length
    ? `<div class="chips">${s.bullets.map((b) => `<span class="chip">${rich(b)}</span>`).join("")}</div>`
    : "";
  return `<section id="s${s.idx}" class="clip scene" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1" style="background:${lk.bg};color:${fg}">
  ${media}
  <div class="marq"><span>${esc(ctx.name)} &#8226; ${esc(ctx.name)} &#8226; ${esc(ctx.name)} &#8226; ${esc(ctx.name)} &#8226;</span></div>
  <div class="safe"><div class="stack">
    <div class="tag">${String(s.idx + 1).padStart(2, "0")}</div>
    <h1 class="head" style="font-size:${size}px">${wordSpans(s.headline, "w", true)}</h1>
    ${s.subtext ? `<p class="sub">${rich(s.subtext)}</p>` : ""}
    ${bullets}
  </div></div>
  ${s.idx > 0 ? `<div class="wipe"></div>` : ""}
</section>`;
}

function sceneJs(s: TimedScene): string {
  const id = `#s${s.idx}`;
  const words = s.headline.split(/\s+/).filter(Boolean).length;
  const wStart = 0.2;
  const step = Math.min(0.16, (s.dur * 0.45) / Math.max(1, words));
  const after = wStart + words * step + 0.25;
  const lines: string[] = [];
  if (s.idx > 0) lines.push(`tl.fromTo("${id} .wipe",{xPercent:0},{xPercent:105,duration:.5,ease:"power3.inOut"},${at(s, 0)});`);
  if (s.m) lines.push(`tl.fromTo("${id} .bgm",{scale:1.18},{scale:1,duration:${s.dur},ease:"none"},${at(s, 0)});`);
  lines.push(`tl.fromTo("${id} .marq span",{x:0},{x:-700,duration:${s.dur},ease:"none"},${at(s, 0)});`);
  lines.push(`tl.fromTo("${id} .tag",{x:-80,opacity:0},{x:0,opacity:1,duration:.4,ease:"power3.out"},${at(s, 0.1)});`);
  lines.push(`tl.fromTo("${id} .w .wi",{yPercent:115,rotation:7},{yPercent:0,rotation:0,duration:.5,ease:"back.out(1.7)",stagger:${round(step)}},${at(s, wStart)});`);
  lines.push(`tl.fromTo("${id} .w.acc .hl",{scaleX:0},{scaleX:1,duration:.35,ease:"power4.out"},${at(s, wStart + words * step)});`);
  lines.push(`tl.fromTo("${id} .head",{scale:1},{scale:1.04,duration:${round(Math.max(0.5, s.dur - wStart))},ease:"none"},${at(s, wStart)});`);
  lines.push(`if (document.querySelector("${id} .sub")) tl.fromTo("${id} .sub",{y:40,opacity:0},{y:0,opacity:1,duration:.45,ease:"power3.out"},${at(s, after)});`);
  lines.push(`if (document.querySelector("${id} .chip")) tl.fromTo("${id} .chip",{scale:.4,opacity:0},{scale:1,opacity:1,duration:.4,ease:"back.out(2)",stagger:.12},${at(s, after + 0.15)});`);
  lines.push(`tl.to("${id} .stack",{y:-70,opacity:0,duration:.28,ease:"power2.in"},${at(s, s.dur - 0.3)});`);
  return lines.join("\n");
}

export const kineticType: TemplateDef = {
  id: "kinetic-type",
  name: "Kinetic Type",
  description:
    "Bold, punchy word-by-word typography with masked reveals, highlighted keywords (*wrap words in asterisks*), color-blocked scenes and a scrolling brand marquee. Works with zero media; scene media becomes a dimmed full-bleed background.",
  tags: ["typography", "hook", "bold", "no-media", "fast"],
  defaultSceneSec: 2.6,
  ctaSec: 3.2,
  fonts: { heading: "Anton", body: "Inter" },
  build(ctx) {
    const p = ctx.pal;
    const css = `
.scene .bgm{position:absolute;inset:0}
.scene .shade{position:absolute;inset:0}
.scene .stack{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:40px}
.scene .tag{font:900 44px/1 var(--fb);letter-spacing:.2em;opacity:.9;display:inline-flex;align-items:center;gap:18px}
.scene .tag::after{content:"";display:block;width:120px;height:8px;background:var(--accent)}
.scene .head{font-family:var(--fh);font-weight:${ctx.brand.fonts?.heading ? 800 : 400};line-height:1.02;text-transform:uppercase;letter-spacing:.005em;transform-origin:left center}
.scene .w{display:inline-block;overflow:hidden;vertical-align:top;position:relative;padding:0 .04em;margin:0 -.02em}
.scene .w .wi{display:inline-block;position:relative;z-index:1}
.scene .w.acc .wi{color:var(--on-accent);padding:0 .08em}
.scene .w.acc .hl{position:absolute;left:0;right:0;top:.06em;bottom:.04em;background:var(--accent);transform-origin:left center;z-index:0;transform:skewX(-6deg)}
.scene .sub{font:600 50px/1.3 var(--fb);max-width:820px;opacity:.95}
.scene .sub .acc{color:inherit;border-bottom:6px solid var(--accent)}
.scene .chips{display:flex;flex-wrap:wrap;gap:18px}
.scene .chip{font:800 38px/1 var(--fb);padding:20px 30px;border-radius:999px;background:${rgba(p.accent, 0.95)};color:var(--on-accent)}
.scene .marq{position:absolute;left:0;bottom:200px;white-space:nowrap;font:${ctx.brand.fonts?.heading ? 800 : 400} 260px/1 var(--fh);text-transform:uppercase;opacity:.07;pointer-events:none}
.scene .wipe{position:absolute;inset:0;background:var(--accent);z-index:40}
`;
    // inject highlight spans inside accented words
    const body =
      ctx.scenes.map((s) => scene(ctx, s).replace(/<span class="w acc"><span class="wi">/g, '<span class="w acc"><span class="hl"></span><span class="wi">')).join("\n") +
      "\n" +
      brandBar(ctx, "#FFFFFF", "background:rgba(0,0,0,.32);padding:8px 28px 8px 8px;border-radius:999px") +
      "\n" +
      ctaHtml(ctx, { variant: "pill", bg: p.primary, fg: p.onPrimary, pillBg: p.accent, pillFg: p.onAccent });
    const js = ctx.scenes.map(sceneJs).join("\n");
    return { css, body, js };
  },
};
