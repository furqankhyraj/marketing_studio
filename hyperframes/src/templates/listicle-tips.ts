import { at, brandBar, ctaHtml, esc, fit, mediaTag, mix, readable, rgba, rich, wordSpans, type Ctx, type TemplateDef, type TimedScene } from "./common.ts";

function introScene(ctx: Ctx, s: TimedScene, count: number): string {
  return `<section id="s${s.idx}" class="clip scene intro" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1">
  ${s.m ? `<div class="bgm">${mediaTag(s, "cover")}</div><div class="shade"></div>` : ""}
  <div class="safe"><div class="stack">
    <div class="bignum">${count}</div>
    <h1 class="head" style="font-size:${fit(s.headline, 120, 64, 16)}px">${wordSpans(s.headline, "w")}</h1>
    ${s.subtext ? `<p class="sub">${rich(s.subtext)}</p>` : ""}
    <div class="save">&#128278; Save this for later</div>
  </div></div>
</section>`;
}

function tipScene(ctx: Ctx, s: TimedScene, n: number, count: number): string {
  const dots = Array.from({ length: count }, (_, i) => `<span class="${i < n ? "on" : ""}${i === n - 1 ? " cur" : ""}"></span>`).join("");
  return `<section id="s${s.idx}" class="clip scene tip" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1">
  <div class="stripe"></div>
  <div class="dots">${dots}</div>
  <div class="safe"><div class="stack">
    <div class="num"><span>${String(n).padStart(2, "0")}</span></div>
    ${s.m ? `<div class="media">${mediaTag(s, "cover")}</div>` : ""}
    <h2 class="head2" style="font-size:${fit(s.headline, s.m ? 84 : 104, 56, s.m ? 20 : 16)}px">${rich(s.headline)}</h2>
    ${s.subtext ? `<p class="sub">${rich(s.subtext)}</p>` : ""}
    ${s.bullets?.length ? `<ul class="bl">${s.bullets.slice(0, 4).map((b) => `<li>${rich(b)}</li>`).join("")}</ul>` : ""}
  </div></div>
</section>`;
}

export const listicleTips: TemplateDef = {
  id: "listicle-5-tips",
  name: "Listicle / N Tips",
  description:
    "Numbered tips reel (\"5 tips to…\"). Scene 1 is the title card (giant count = number of remaining scenes); every following scene is a numbered tip with a big outlined number, progress dots, optional image, subtext and bullets. Works for any count (3–10), great for saves.",
  tags: ["listicle", "tips", "educational", "numbered", "saves"],
  defaultSceneSec: 3.2,
  ctaSec: 3.2,
  fonts: { heading: "Oswald", body: "Inter" },
  build(ctx) {
    const p = ctx.pal;
    const hasIntro = ctx.scenes.length > 1;
    const count = hasIntro ? ctx.scenes.length - 1 : ctx.scenes.length;
    const tipBg = p.background;
    const numC = readable(p.primary, tipBg, 3);
    const bigC = readable(p.accent, p.primary, 3);
    const css = `
.scene{color:${p.onBackground}}
.scene .stack{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:30px}
.intro{background:${p.primary};color:${p.onPrimary}}
.intro .bgm{position:absolute;inset:0}
.intro .shade{position:absolute;inset:0;background:linear-gradient(180deg,${rgba(p.primary, 0.75)},${rgba(mix(p.primary, "#000000", 0.5), 0.92)})}
.intro .bignum{font:700 460px/1 var(--fh);font-variant-numeric:lining-nums;margin-bottom:10px;color:${bigC};margin-left:-12px;text-shadow:0 30px 80px rgba(0,0,0,.25)}
.intro .head{font-family:var(--fh);font-weight:700;line-height:1.02;text-transform:uppercase;color:#FFFFFF}
.intro .head .w{display:inline-block}
.intro .head .w.acc{color:${bigC}}
.intro .sub{font:600 46px/1.3 var(--fb);color:${rgba("#FFFFFF", 0.88)}}
.intro .save{align-self:flex-start;padding:18px 30px;border-radius:999px;background:${rgba("#FFFFFF", 0.16)};font:700 34px/1 var(--fb);color:#FFFFFF}
.tip{background:${tipBg}}
.tip .stripe{position:absolute;left:0;top:0;bottom:0;width:36px;background:var(--accent)}
.tip .dots{position:absolute;left:90px;right:140px;top:${250 + 8}px;display:flex;gap:12px}
.tip .dots span{flex:1;height:10px;border-radius:10px;background:${rgba(p.onBackground, 0.14)}}
.tip .dots span.on{background:var(--primary)}
.tip .num{font:700 280px/1 var(--fh);font-variant-numeric:lining-nums;margin-bottom:0;color:transparent;-webkit-text-stroke:5px ${numC};position:relative}
.tip .num span{display:inline-block}
.tip .media{width:100%;height:520px;border-radius:32px;overflow:hidden;position:relative;background:linear-gradient(135deg,${p.primary},${p.secondary});box-shadow:0 24px 60px ${rgba(p.dark, 0.25)}}
.tip .head2{font-family:var(--fh);font-weight:700;line-height:1.02;text-transform:uppercase;color:${p.onBackground}}
.tip .head2 .acc{color:${numC}}
.tip .sub{font:500 42px/1.35 var(--fb);color:${rgba(p.onBackground, 0.8)}}
.tip .bl{list-style:none;display:flex;flex-direction:column;gap:14px}
.tip .bl li{font:700 38px/1.2 var(--fb);padding-left:52px;position:relative}
.tip .bl li::before{content:"";position:absolute;left:0;top:10px;width:26px;height:26px;border-radius:8px;background:var(--accent)}
`;
    let n = 0;
    const body =
      ctx.scenes
        .map((s, i) => {
          if (hasIntro && i === 0) return introScene(ctx, s, count);
          n += 1;
          return tipScene(ctx, s, n, count);
        })
        .join("\n") +
      "\n" +
      brandBar(ctx, "#FFFFFF", `background:${rgba(p.dark, 0.55)};padding:8px 28px 8px 8px;border-radius:999px`) +
      "\n" +
      ctaHtml(ctx, { variant: "pill", bg: p.primary, fg: p.onPrimary, pillBg: p.accent, pillFg: p.onAccent, eyebrow: "Comment" });
    const js = ctx.scenes
      .map((s, i) => {
        const id = `#s${s.idx}`;
        if (hasIntro && i === 0) {
          return [
            `tl.fromTo("${id} .bignum",{scale:2.2,opacity:0,rotation:-12},{scale:1,opacity:1,rotation:0,duration:.6,ease:"power4.out"},${at(s, 0.05)});`,
            `tl.fromTo("${id} .w",{y:80,opacity:0},{y:0,opacity:1,duration:.45,ease:"back.out(1.7)",stagger:.09},${at(s, 0.35)});`,
            `if (document.querySelector("${id} .sub")) tl.fromTo("${id} .sub",{y:30,opacity:0},{y:0,opacity:1,duration:.45},${at(s, 0.9)});`,
            `tl.fromTo("${id} .save",{scale:0},{scale:1,duration:.4,ease:"back.out(2)"},${at(s, 1.1)});`,
            `tl.to("${id} .stack",{x:-300,opacity:0,duration:.3,ease:"power2.in"},${at(s, s.dur - 0.32)});`,
          ].join("\n");
        }
        return [
          `tl.fromTo("${id} .stripe",{scaleY:0,transformOrigin:"top"},{scaleY:1,duration:.5,ease:"power3.out"},${at(s, 0)});`,
          `tl.fromTo("${id} .dots .cur",{scaleX:0,transformOrigin:"left"},{scaleX:1,duration:.5,ease:"power2.out"},${at(s, 0.15)});`,
          `tl.fromTo("${id} .num span",{x:-400,rotation:-15,opacity:0},{x:0,rotation:0,opacity:1,duration:.55,ease:"power4.out"},${at(s, 0.05)});`,
          `if (document.querySelector("${id} .media")) tl.fromTo("${id} .media",{clipPath:"inset(0% 100% 0% 0% round 32px)"},{clipPath:"inset(0% 0% 0% 0% round 32px)",duration:.6,ease:"power3.inOut"},${at(s, 0.25)});`,
          `tl.fromTo("${id} .head2",{y:60,opacity:0},{y:0,opacity:1,duration:.5,ease:"power3.out"},${at(s, 0.35)});`,
          `if (document.querySelector("${id} .sub")) tl.fromTo("${id} .sub",{y:30,opacity:0},{y:0,opacity:1,duration:.45},${at(s, 0.6)});`,
          `if (document.querySelector("${id} .bl li")) tl.fromTo("${id} .bl li",{x:-60,opacity:0},{x:0,opacity:1,duration:.4,stagger:.15},${at(s, 0.8)});`,
          `tl.to("${id} .stack",{x:-300,opacity:0,duration:.3,ease:"power2.in"},${at(s, s.dur - 0.32)});`,
        ].join("\n");
      })
      .join("\n");
    return { css, body, js };
  },
};
