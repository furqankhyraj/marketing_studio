import { at, brandBar, ctaHtml, esc, fit, mediaTag, mix, plain, readable, rgba, rich, type Ctx, type TemplateDef, type TimedScene } from "./common.ts";

type Kind = "hero" | "lessons" | "instructor" | "point";

function kindOf(s: TimedScene): Kind {
  if (s.bullets?.length) return "lessons";
  if (s.m) return s.idx === 0 ? "hero" : "instructor";
  return s.idx === 0 ? "hero" : "point";
}

function scene(ctx: Ctx, s: TimedScene): string {
  const k = kindOf(s);
  let inner = "";
  if (k === "hero") {
    inner = `
    <div class="badge">${esc(s.subtext && plain(s.subtext).length <= 26 ? plain(s.subtext) : "New course")}</div>
    ${s.m ? `<div class="heroimg">${mediaTag(s, "cover")}</div>` : ""}
    <h1 class="head" style="font-size:${fit(s.headline, s.m ? 104 : 130, 62, s.m ? 16 : 14)}px">${rich(s.headline)}</h1>
    ${s.subtext && plain(s.subtext).length > 26 ? `<p class="sub">${rich(s.subtext)}</p>` : ""}
    <div class="meta"><span>&#9654; Video lessons</span><span>&#9733; Certificate</span></div>`;
  } else if (k === "lessons") {
    const items = (s.bullets ?? []).slice(0, 6);
    inner = `
    <div class="label">${esc(s.subtext ? plain(s.subtext) : "What you'll learn")}</div>
    <h2 class="h2" style="font-size:${fit(s.headline, 84, 54, 20)}px">${rich(s.headline)}</h2>
    <div class="lessons">${items
      .map(
        (b, i) =>
          `<div class="lesson"><span class="num">${String(i + 1).padStart(2, "0")}</span><span class="lt">${rich(b)}</span><span class="chk"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" /></svg></span></div>`,
      )
      .join("")}</div>`;
  } else if (k === "instructor") {
    inner = `
    <div class="label">${esc("Meet your instructor")}</div>
    <div class="portrait"><div class="dash"></div><div class="ph">${mediaTag(s, "cover")}</div></div>
    <h2 class="h2 center" style="font-size:${fit(s.headline, 86, 54, 18)}px">${rich(s.headline)}</h2>
    ${s.subtext ? `<p class="sub center">${rich(s.subtext)}</p>` : ""}`;
  } else {
    inner = `
    <div class="bigq">${String(s.idx).padStart(2, "0")}</div>
    <h2 class="h2" style="font-size:${fit(s.headline, 104, 60, 16)}px">${rich(s.headline)}</h2>
    ${s.subtext ? `<p class="sub">${rich(s.subtext)}</p>` : ""}`;
  }
  return `<section id="s${s.idx}" class="clip scene k-${k}" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1">
  <div class="safe"><div class="panel">${inner}</div></div>
</section>`;
}

function sceneJs(s: TimedScene): string {
  const id = `#s${s.idx}`;
  const k = kindOf(s);
  const L: string[] = [];
  L.push(`tl.fromTo("${id} .panel",{y:120,opacity:0},{y:0,opacity:1,duration:.6,ease:"power4.out"},${at(s, 0)});`);
  if (k === "hero") {
    L.push(`tl.fromTo("${id} .badge",{scale:0,rotation:-8},{scale:1,rotation:-2,duration:.5,ease:"back.out(2.2)"},${at(s, 0.25)});`);
    L.push(`if (document.querySelector("${id} .heroimg")) tl.fromTo("${id} .heroimg",{clipPath:"inset(0% 0% 100% 0% round 36px)"},{clipPath:"inset(0% 0% 0% 0% round 36px)",duration:.7,ease:"power3.inOut"},${at(s, 0.3)});`);
    L.push(`if (document.querySelector("${id} .heroimg img")) tl.fromTo("${id} .heroimg img",{scale:1.2},{scale:1,duration:${s.dur},ease:"none"},${at(s, 0.3)});`);
    L.push(`tl.fromTo("${id} .head",{y:50,opacity:0},{y:0,opacity:1,duration:.55,ease:"power3.out"},${at(s, 0.45)});`);
    L.push(`if (document.querySelector("${id} .sub")) tl.fromTo("${id} .sub",{y:30,opacity:0},{y:0,opacity:1,duration:.45},${at(s, 0.75)});`);
    L.push(`tl.fromTo("${id} .meta span",{y:30,opacity:0},{y:0,opacity:1,duration:.4,stagger:.15},${at(s, 0.9)});`);
  } else if (k === "lessons") {
    const n = Math.min(6, s.bullets?.length ?? 0);
    const step = Math.min(0.42, Math.max(0.2, (s.dur - 1.4) / Math.max(1, n)));
    L.push(`tl.fromTo("${id} .label, ${id} .h2",{y:30,opacity:0},{y:0,opacity:1,duration:.45,stagger:.12},${at(s, 0.2)});`);
    L.push(`tl.fromTo("${id} .lesson",{x:-140,opacity:0},{x:0,opacity:1,duration:.45,ease:"power3.out",stagger:${step.toFixed(3)}},${at(s, 0.55)});`);
    L.push(`tl.fromTo("${id} .chk",{scale:0},{scale:1,duration:.35,ease:"back.out(3)",stagger:${step.toFixed(3)}},${at(s, 0.8)});`);
    L.push(`tl.fromTo("${id} .chk path",{strokeDashoffset:30},{strokeDashoffset:0,duration:.3,stagger:${step.toFixed(3)}},${at(s, 0.9)});`);
  } else if (k === "instructor") {
    L.push(`tl.fromTo("${id} .label",{y:30,opacity:0},{y:0,opacity:1,duration:.4},${at(s, 0.2)});`);
    L.push(`tl.fromTo("${id} .portrait",{scale:.4,opacity:0},{scale:1,opacity:1,duration:.6,ease:"back.out(1.8)"},${at(s, 0.25)});`);
    L.push(`tl.fromTo("${id} .dash",{rotation:0},{rotation:120,duration:${s.dur},ease:"none"},${at(s, 0)});`);
    L.push(`tl.fromTo("${id} .h2",{y:40,opacity:0},{y:0,opacity:1,duration:.5,ease:"power3.out"},${at(s, 0.6)});`);
    L.push(`if (document.querySelector("${id} .sub")) tl.fromTo("${id} .sub",{y:30,opacity:0},{y:0,opacity:1,duration:.45},${at(s, 0.8)});`);
  } else {
    L.push(`tl.fromTo("${id} .bigq",{x:-200,opacity:0},{x:0,opacity:1,duration:.6,ease:"power4.out"},${at(s, 0.1)});`);
    L.push(`tl.fromTo("${id} .h2",{y:50,opacity:0},{y:0,opacity:1,duration:.55,ease:"power3.out"},${at(s, 0.3)});`);
    L.push(`if (document.querySelector("${id} .sub")) tl.fromTo("${id} .sub",{y:30,opacity:0},{y:0,opacity:1,duration:.45},${at(s, 0.6)});`);
  }
  L.push(`tl.to("${id} .panel",{y:-80,opacity:0,duration:.32,ease:"power2.in"},${at(s, s.dur - 0.34)});`);
  return L.join("\n");
}

export const coursePromo: TemplateDef = {
  id: "course-promo",
  name: "Course Promo",
  description:
    "Academy / online-course launch reel on a dark grid backdrop with glowing brand light. Scene layouts are chosen from content: first scene = course hero (badge from short subtext, optional cover image), scenes with bullets = animated lesson checklist, scenes with media = instructor portrait, others = numbered key points. Ends with an enroll button + comment keyword.",
  tags: ["course", "academy", "education", "lessons", "enroll"],
  defaultSceneSec: 3.4,
  ctaSec: 3.6,
  fonts: { heading: "Montserrat", body: "Inter" },
  build(ctx) {
    const p = ctx.pal;
    const deep = luminanceDark(ctx);
    const hi = readable(p.accent, deep, 4.2);
    const css = `
#bg{background:${deep}}
#bg .grid{position:absolute;inset:-200px;background-image:linear-gradient(${rgba("#FFFFFF", 0.06)} 2px,transparent 2px),linear-gradient(90deg,${rgba("#FFFFFF", 0.06)} 2px,transparent 2px);background-size:90px 90px}
#bg .glow{position:absolute;width:1100px;height:1100px;border-radius:50%}
#bg .g1{left:-380px;top:-200px;background:radial-gradient(circle, ${rgba(p.primary, 0.85)} 0%, transparent 65%)}
#bg .g2{right:-420px;bottom:-160px;background:radial-gradient(circle, ${rgba(p.accent, 0.55)} 0%, transparent 65%)}
.scene{color:#FFFFFF}
.scene .panel{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:34px}
.scene .badge{align-self:flex-start;padding:18px 34px;border-radius:14px;background:var(--accent);color:var(--on-accent);font:800 36px/1 var(--fb);letter-spacing:.14em;text-transform:uppercase}
.scene .heroimg{width:100%;height:560px;border-radius:36px;overflow:hidden;position:relative;box-shadow:0 30px 80px rgba(0,0,0,.45);background:linear-gradient(135deg,${p.primary},${p.secondary})}
.scene .head{font-family:var(--fh);font-weight:900;line-height:1.04;letter-spacing:-.01em;word-spacing:.08em}
.scene .h2{font-family:var(--fh);font-weight:800;line-height:1.08;letter-spacing:-.01em}
.scene .acc{color:${hi}}
.scene .sub{font:500 44px/1.35 var(--fb);color:${rgba("#FFFFFF", 0.82)}}
.scene .center{text-align:center}
.scene .meta{display:flex;gap:22px}
.scene .meta span{padding:16px 26px;border-radius:999px;border:2px solid ${rgba("#FFFFFF", 0.3)};font:600 32px/1 var(--fb);color:${rgba("#FFFFFF", 0.9)}}
.scene .label{font:800 32px/1 var(--fb);letter-spacing:.24em;text-transform:uppercase;color:${hi}}
.scene .lessons{display:flex;flex-direction:column;gap:20px}
.scene .lesson{display:flex;align-items:center;gap:26px;padding:26px 30px;border-radius:24px;background:${rgba("#FFFFFF", 0.08)};border:2px solid ${rgba("#FFFFFF", 0.12)}}
.scene .lesson .num{font:900 40px/1 var(--fh);color:${hi};width:66px;flex:none}
.scene .lesson .lt{font:700 40px/1.2 var(--fb);flex:1}
.scene .lesson .chk{width:60px;height:60px;border-radius:50%;background:var(--accent);flex:none;display:flex;align-items:center;justify-content:center}
.scene .lesson .chk svg{width:38px;height:38px;fill:none;stroke:${p.onAccent};stroke-width:3.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:30}
.scene.k-instructor .panel{align-items:center}
.scene .portrait{position:relative;width:560px;height:560px}
.scene .portrait .ph{position:absolute;inset:40px;border-radius:50%;overflow:hidden;background:linear-gradient(135deg,${p.primary},${p.secondary})}
.scene .portrait .dash{position:absolute;inset:0;border-radius:50%;border:8px dashed ${hi}}
.scene .bigq{font:900 300px/1 var(--fh);font-variant-numeric:lining-nums;color:transparent;-webkit-text-stroke:4px ${hi}}
#cta .btn{margin-top:4px}
`;
    const body =
      `<div id="bg" class="clip" data-start="0" data-duration="${ctx.total}" data-track-index="0"><div class="grid"></div><div class="glow g1"></div><div class="glow g2"></div></div>\n` +
      ctx.scenes.map((s) => scene(ctx, s)).join("\n") +
      "\n" +
      brandBar(ctx, "#FFFFFF") +
      "\n" +
      ctaHtml(ctx, {
        variant: "button",
        bg: `radial-gradient(90% 60% at 50% 40%, ${mix(p.primary, deep, 0.2)} 0%, ${deep} 100%)`,
        fg: "#FFFFFF",
        pillBg: p.accent,
        pillFg: p.onAccent,
        buttonLabel: "Enroll now",
        btnBg: "#FFFFFF",
        btnFg: deep,
      });
    const js =
      `tl.fromTo("#bg .grid",{y:0},{y:180,duration:${ctx.total},ease:"none"},0);\n` +
      `tl.fromTo("#bg .g1",{x:0,y:0},{x:260,y:520,duration:${ctx.total},ease:"sine.inOut"},0);\n` +
      `tl.fromTo("#bg .g2",{x:0,y:0},{x:-240,y:-560,duration:${ctx.total},ease:"sine.inOut"},0);\n` +
      ctx.scenes.map(sceneJs).join("\n");
    return { css, body, js };
  },
};

function luminanceDark(ctx: Ctx): string {
  // a deep, brand-tinted near-black
  return mix(ctx.pal.primary, "#05060A", 0.78);
}
