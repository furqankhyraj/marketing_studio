import { at, brandBar, ctaHtml, esc, fit, mediaTag, mix, readable, rgba, rich, round, type Ctx, type TemplateDef, type TimedScene } from "./common.ts";

function layer(s: TimedScene, cls: string, fallbackWord: string): string {
  return `<div class="layer ${cls}"><div class="fb"><span>${esc(fallbackWord)}</span></div>${s.m ? mediaTag(s, "cover") : ""}</div>`;
}

function textBlock(s: TimedScene, cls: string): string {
  return `<div class="txt ${cls}">
      <h1 class="head" style="font-size:${fit(s.headline, 96, 56, 18)}px">${rich(s.headline)}</h1>
      ${s.subtext ? `<p class="sub">${rich(s.subtext)}</p>` : ""}
    </div>`;
}

function compareSection(ctx: Ctx, a: TimedScene, b: TimedScene): string {
  return `<section id="cmp" class="clip scene" data-start="${a.start}" data-duration="${round(a.dur + b.dur)}" data-track-index="1">
  ${layer(a, "before", "Before")}
  ${layer(b, "after", "After")}
  <div class="divider"><div class="knob">&#8596;</div></div>
  <div class="lab lab-b">Before</div>
  <div class="lab lab-a">After</div>
  <div class="fade"></div>
  <div class="tbox">${textBlock(a, "ta")}${textBlock(b, "tb")}</div>
</section>`;
}

function compareJs(a: TimedScene, b: TimedScene): string {
  const t1 = b.start; // wipe begins at the start of the "after" scene
  const half = Math.min(1.2, b.dur * 0.3);
  const L: string[] = [];
  L.push(`tl.fromTo("#cmp .before",{scale:1.12},{scale:1,duration:${a.dur},ease:"none"},${a.start});`);
  L.push(`tl.fromTo("#cmp .after",{scale:1.08},{scale:1,duration:${b.dur},ease:"none"},${t1});`);
  L.push(`tl.fromTo("#cmp .lab-b",{x:-200,opacity:0},{x:0,opacity:1,duration:.45,ease:"back.out(1.7)"},${round(a.start + 0.2)});`);
  L.push(`tl.fromTo("#cmp .ta .head",{y:60,opacity:0},{y:0,opacity:1,duration:.5,ease:"power3.out"},${round(a.start + 0.3)});`);
  L.push(`if (document.querySelector("#cmp .ta .sub")) tl.fromTo("#cmp .ta .sub",{y:30,opacity:0},{y:0,opacity:1,duration:.4},${round(a.start + 0.55)});`);
  L.push(`tl.to("#cmp .ta",{y:-40,opacity:0,duration:.3,ease:"power2.in"},${round(t1 - 0.05)});`);
  // wipe: hidden -> half split -> fully revealed
  L.push(`tl.fromTo("#cmp .after",{clipPath:"inset(0% 0% 0% 100%)"},{clipPath:"inset(0% 0% 0% 50%)",duration:.6,ease:"power3.inOut"},${t1});`);
  L.push(`tl.fromTo("#cmp .divider",{x:1080,opacity:0},{x:540,opacity:1,duration:.6,ease:"power3.inOut"},${t1});`);
  L.push(`tl.fromTo("#cmp .lab-a",{x:200,opacity:0},{x:0,opacity:1,duration:.45,ease:"back.out(1.7)"},${round(t1 + 0.35)});`);
  L.push(`tl.to("#cmp .after",{clipPath:"inset(0% 0% 0% 0%)",duration:.55,ease:"power3.inOut"},${round(t1 + 0.6 + half)});`);
  L.push(`tl.to("#cmp .divider",{x:0,opacity:0,duration:.55,ease:"power3.inOut"},${round(t1 + 0.6 + half)});`);
  L.push(`tl.to("#cmp .lab-b",{opacity:0,duration:.3},${round(t1 + 0.6 + half)});`);
  L.push(`tl.fromTo("#cmp .tb .head",{y:60,opacity:0},{y:0,opacity:1,duration:.5,ease:"power3.out"},${round(t1 + 0.5)});`);
  L.push(`if (document.querySelector("#cmp .tb .sub")) tl.fromTo("#cmp .tb .sub",{y:30,opacity:0},{y:0,opacity:1,duration:.4},${round(t1 + 0.75)});`);
  L.push(`tl.to("#cmp .tbox, #cmp .lab-a",{opacity:0,y:-30,duration:.3,ease:"power2.in"},${round(b.end - 0.32)});`);
  return L.join("\n");
}

function resultSection(ctx: Ctx, s: TimedScene): string {
  const bl = s.bullets?.length
    ? `<ul class="bl">${s.bullets.slice(0, 4).map((x) => `<li><span class="ck">&#10003;</span>${rich(x)}</li>`).join("")}</ul>`
    : "";
  return `<section id="s${s.idx}" class="clip scene result" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1">
  ${layer(s, "rbg", "")}
  <div class="fade"></div>
  <div class="lab lab-r">Result</div>
  <div class="tbox">${textBlock(s, "tr")}${bl}</div>
</section>`;
}

function resultJs(s: TimedScene): string {
  const id = `#s${s.idx}`;
  return [
    `tl.fromTo("${id} .rbg",{scale:1.15},{scale:1,duration:${s.dur},ease:"none"},${at(s, 0)});`,
    `tl.fromTo("${id} .lab-r",{y:-40,opacity:0},{y:0,opacity:1,duration:.4,ease:"back.out(2)"},${at(s, 0.15)});`,
    `tl.fromTo("${id} .tr .head",{y:60,opacity:0},{y:0,opacity:1,duration:.5,ease:"power3.out"},${at(s, 0.3)});`,
    `if (document.querySelector("${id} .tr .sub")) tl.fromTo("${id} .tr .sub",{y:30,opacity:0},{y:0,opacity:1,duration:.4},${at(s, 0.55)});`,
    `if (document.querySelector("${id} .bl li")) tl.fromTo("${id} .bl li",{x:-60,opacity:0},{x:0,opacity:1,duration:.4,stagger:.14},${at(s, 0.7)});`,
    `tl.to("${id} .tbox",{y:-30,opacity:0,duration:.3,ease:"power2.in"},${at(s, s.dur - 0.32)});`,
  ].join("\n");
}

export const beforeAfter: TemplateDef = {
  id: "before-after",
  name: "Before / After",
  description:
    "Transformation reel: scene 1 = BEFORE, scene 2 = AFTER, revealed with a split-screen wipe (holds at 50/50, then full reveal) and labelled tags; any extra scenes become RESULT cards with check-mark bullets. Best with two photos (before/after media); without media it uses muted vs. brand-colored panels.",
  tags: ["before-after", "transformation", "results", "comparison", "wipe"],
  defaultSceneSec: 3.4,
  ctaSec: 3.2,
  fonts: { heading: "Archivo Black", body: "Inter" },
  thumbAt(ctx) {
    const b = ctx.scenes[1];
    return b ? round(b.start + 1.0) : round(Math.max(0.6, ctx.scenes[0].dur - 0.5));
  },
  build(ctx) {
    const p = ctx.pal;
    const hiAcc = readable(p.accent, p.dark, 4.5);
    const css = `
.scene{background:#111;color:#FFFFFF}
.scene .layer{position:absolute;inset:0;overflow:hidden}
.scene .before .fb{position:absolute;inset:0;background:linear-gradient(160deg,#5B5F66,#2B2D31)}
.scene .after .fb,.scene .rbg .fb{position:absolute;inset:0;background:linear-gradient(160deg,${p.primary},${mix(p.secondary, p.accent, 0.3)})}
.scene .fb{display:flex;align-items:center;justify-content:center}
.scene .fb span{font:900 230px/1 var(--fh);text-transform:uppercase;opacity:.14;transform:rotate(-90deg);white-space:nowrap}
.scene .divider{position:absolute;left:-5px;top:0;bottom:0;width:10px;opacity:0;background:#FFFFFF;box-shadow:0 0 30px rgba(0,0,0,.4);z-index:5}
.scene .knob{position:absolute;left:50%;top:44%;width:110px;height:110px;margin:-55px 0 0 -55px;border-radius:50%;background:#FFFFFF;color:#111;
  font:900 56px/110px var(--fb);text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.4)}
.scene .lab{position:absolute;top:${250 + 30}px;padding:16px 30px;border-radius:12px;font:900 40px/1 var(--fh);letter-spacing:.12em;text-transform:uppercase;z-index:6}
.scene .lab-b{left:90px;background:#FFFFFF;color:#222}
.scene .lab-a{right:150px;background:var(--accent);color:var(--on-accent)}
.scene .lab-r{left:90px;background:var(--accent);color:var(--on-accent)}
.scene .fade{position:absolute;left:0;right:0;bottom:0;height:1050px;background:linear-gradient(180deg,transparent 0%,${rgba(p.dark, 0.72)} 45%,${rgba(p.dark, 0.94)} 100%);z-index:4}
.scene .tbox{position:absolute;left:90px;right:140px;bottom:450px;z-index:7}
.scene .txt{display:flex;flex-direction:column;gap:20px}
.scene #cmp .txt{position:absolute;left:0;right:0;bottom:0}
#cmp .tbox{height:420px}
#cmp .txt{position:absolute;left:0;right:0;bottom:0}
.scene .head{font-family:var(--fh);font-weight:900;line-height:1.04;text-transform:uppercase;text-shadow:0 6px 30px rgba(0,0,0,.4)}
.scene .head .acc{color:${hiAcc}}
.scene .sub{font:600 42px/1.32 var(--fb);color:${rgba("#FFFFFF", 0.88)}}
.scene .bl{list-style:none;display:flex;flex-direction:column;gap:16px;margin-top:26px}
.scene .bl li{display:flex;align-items:center;gap:18px;font:700 38px/1.2 var(--fb)}
.scene .bl .ck{width:50px;height:50px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;font:900 30px/1 var(--fb);flex:none}
`;
    const sections: string[] = [];
    const js: string[] = [];
    const sc = ctx.scenes;
    let i = 0;
    if (sc.length >= 2) {
      sections.push(compareSection(ctx, sc[0], sc[1]));
      js.push(compareJs(sc[0], sc[1]));
      i = 2;
    }
    for (; i < sc.length; i++) {
      sections.push(resultSection(ctx, sc[i]));
      js.push(resultJs(sc[i]));
    }
    const body =
      sections.join("\n") +
      "\n" +
      brandBar(ctx, "#FFFFFF", `background:${rgba("#000000", 0.4)};padding:8px 28px 8px 8px;border-radius:999px`) +
      "\n" +
      ctaHtml(ctx, { variant: "pill", bg: `linear-gradient(170deg, ${mix(p.primary, "#000000", 0.2)}, ${mix(p.primary, "#000000", 0.65)})`, fg: "#FFFFFF", pillBg: p.accent, pillFg: p.onAccent, eyebrow: "Want this? Comment" });
    return { css, body, js: js.join("\n") };
  },
};
