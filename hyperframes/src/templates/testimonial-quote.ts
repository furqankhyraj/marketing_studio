import { at, brandBar, ctaHtml, esc, fit, mediaTag, mix, plain, rgba, rich, round, wordSpans, type Ctx, type TemplateDef, type TimedScene } from "./common.ts";

function initials(s: string): string {
  return plain(s)
    .replace(/^[^A-Za-zÀ-ɏ؀-ۿ]+/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "★";
}

function scene(ctx: Ctx, s: TimedScene): string {
  const author = s.subtext?.trim() || "Happy customer";
  const size = fit(s.headline, 76, 46, 40);
  const avatar = s.m ? `<div class="av">${mediaTag(s, "cover")}</div>` : `<div class="av mono2"><span>${esc(initials(author))}</span></div>`;
  const tags = s.bullets?.length ? `<div class="tags">${s.bullets.slice(0, 3).map((b) => `<span>${rich(b)}</span>`).join("")}</div>` : "";
  return `<section id="s${s.idx}" class="clip scene" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1">
  <div class="blob b1"></div><div class="blob b2"></div>
  <div class="cw"><div class="card">
    <div class="qm">&#8220;</div>
    <div class="stars">${"<span>&#9733;</span>".repeat(5)}</div>
    <blockquote class="quote" style="font-size:${size}px">${wordSpans(s.headline, "qw")}</blockquote>
    <div class="who">${avatar}<div class="wt"><b>${rich(author)}</b><small>&#10003; Verified review</small></div></div>
    ${tags}
  </div></div>
  <div class="count">${String(s.idx + 1).padStart(2, "0")} / ${String(ctx.scenes.length).padStart(2, "0")}</div>
</section>`;
}

function sceneJs(s: TimedScene): string {
  const id = `#s${s.idx}`;
  const words = s.headline.split(/\s+/).filter(Boolean).length;
  const span = Math.max(0.8, s.dur * 0.5);
  const step = round(span / Math.max(1, words));
  const L: string[] = [];
  L.push(`tl.fromTo("${id} .b1",{x:-80,y:0,scale:.9},{x:60,y:120,scale:1.1,duration:${s.dur},ease:"sine.inOut"},${at(s, 0)});`);
  L.push(`tl.fromTo("${id} .b2",{x:60,y:0},{x:-90,y:-140,duration:${s.dur},ease:"sine.inOut"},${at(s, 0)});`);
  L.push(`tl.fromTo("${id} .card",{y:220,opacity:0,rotation:3},{y:0,opacity:1,rotation:0,duration:.65,ease:"power4.out"},${at(s, 0)});`);
  L.push(`tl.fromTo("${id} .qm",{scale:0,rotation:-30},{scale:1,rotation:0,duration:.55,ease:"back.out(2.5)"},${at(s, 0.25)});`);
  L.push(`tl.fromTo("${id} .stars span",{scale:0,opacity:0},{scale:1,opacity:1,duration:.3,ease:"back.out(3)",stagger:.08},${at(s, 0.4)});`);
  L.push(`tl.fromTo("${id} .qw",{opacity:.14,y:8},{opacity:1,y:0,duration:.3,ease:"power2.out",stagger:${step}},${at(s, 0.55)});`);
  L.push(`tl.fromTo("${id} .who",{x:-60,opacity:0},{x:0,opacity:1,duration:.5,ease:"power3.out"},${at(s, Math.min(s.dur - 0.9, 0.7 + span * 0.6))});`);
  L.push(`if (document.querySelector("${id} .tags span")) tl.fromTo("${id} .tags span",{y:20,opacity:0},{y:0,opacity:1,duration:.35,stagger:.1},${at(s, Math.min(s.dur - 0.7, 0.9 + span * 0.6))});`);
  L.push(`tl.fromTo("${id} .count",{opacity:0},{opacity:1,duration:.4},${at(s, 0.3)});`);
  L.push(`tl.to("${id} .card",{y:-160,opacity:0,rotation:-2,duration:.35,ease:"power2.in"},${at(s, s.dur - 0.36)});`);
  return L.join("\n");
}

export const testimonialQuote: TemplateDef = {
  id: "testimonial-quote",
  name: "Testimonial Quote",
  description:
    "Social-proof reel: one review per scene on a floating card with a big quote mark, 5 popping stars and karaoke-style word highlighting. headline = the quote, subtext = reviewer name, media = reviewer photo (else initials), bullets = up to 3 tags (e.g. product bought).",
  tags: ["testimonial", "review", "social-proof", "quote", "trust"],
  defaultSceneSec: 4.6,
  ctaSec: 3.2,
  fonts: { heading: "DM Serif Display", body: "Poppins" },
  build(ctx) {
    const p = ctx.pal;
    const bg = mix(p.background, p.secondary, 0.12);
    const css = `
.scene{background:${bg};color:${p.onBackground}}
.scene .blob{position:absolute;border-radius:50%}
.scene .b1{width:900px;height:900px;left:-300px;top:120px;background:radial-gradient(circle, ${rgba(p.primary, 0.32)} 0%, transparent 68%)}
.scene .b2{width:800px;height:800px;right:-300px;bottom:180px;background:radial-gradient(circle, ${rgba(p.accent, 0.35)} 0%, transparent 68%)}
.scene .cw{position:absolute;left:90px;right:140px;top:330px;bottom:440px;display:flex;align-items:center}
.scene .card{position:relative;width:100%;padding:110px 64px 64px;border-radius:48px;background:#FFFFFF;color:#1A1A1A;
  box-shadow:0 40px 100px ${rgba(p.dark, 0.25)};display:flex;flex-direction:column;gap:34px}
.scene .qm{position:absolute;left:46px;top:-120px;width:200px;height:200px;border-radius:50%;background:var(--primary);color:var(--on-primary);
  font:400 260px/1 Georgia, serif;display:flex;align-items:flex-start;justify-content:center;padding-top:28px;box-shadow:0 20px 50px ${rgba(p.dark, 0.3)};overflow:hidden}
.scene .stars{display:flex;gap:8px;color:#F5B301;font-size:58px;line-height:1}
.scene .stars span{display:inline-block}
.scene .quote{font-family:var(--fh);font-weight:${ctx.brand.fonts?.heading ? 600 : 400};line-height:1.18;color:#141414}
.scene .qw{display:inline-block}
.scene .qw.acc{color:var(--primary)}
.scene .who{display:flex;align-items:center;gap:26px;padding-top:12px;border-top:2px solid #EEE}
.scene .av{width:120px;height:120px;border-radius:50%;overflow:hidden;position:relative;flex:none;background:linear-gradient(135deg,${p.primary},${p.accent});display:flex;align-items:center;justify-content:center}
.scene .av.mono2 span{font:800 46px/1 var(--fb);color:#FFFFFF}
.scene .wt{display:flex;flex-direction:column;gap:10px}
.scene .wt b{font:800 42px/1.1 var(--fb)}
.scene .wt small{font:600 30px/1 var(--fb);color:#2E9E5B}
.scene .tags{display:flex;flex-wrap:wrap;gap:14px}
.scene .tags span{padding:14px 24px;border-radius:999px;background:${rgba(p.primary, 0.1)};color:${mix(p.primary, "#000000", 0.25)};font:700 30px/1 var(--fb)}
.scene .count{position:absolute;right:150px;top:${250 - 60}px;font:800 34px/1 var(--fb);letter-spacing:.12em;opacity:.6}
`;
    const body =
      ctx.scenes.map((s) => scene(ctx, s)).join("\n") +
      "\n" +
      brandBar(ctx, p.onBackground) +
      "\n" +
      ctaHtml(ctx, { variant: "pill", bg: p.primary, fg: p.onPrimary, pillBg: "#FFFFFF", pillFg: mix(p.primary, "#000000", 0.35), eyebrow: "Want yours? Comment" });
    return { css, body, js: ctx.scenes.map(sceneJs).join("\n") };
  },
};
