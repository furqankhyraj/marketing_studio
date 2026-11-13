import { at, brandBar, ctaHtml, esc, fit, mediaTag, mix, plain, rgba, rich, type Ctx, type TemplateDef, type TimedScene } from "./common.ts";

const PRICE_RE = /((?:[$€£¥₹]|Rs\.?|PKR|USD|EUR|GBP)\s?\d[\d,.]*(?:\s?(?:USD|EUR|GBP|PKR))?|\d[\d,.]*\s?(?:USD|EUR|GBP|PKR|Rs))(\s?(?:\/|per)\s?(?:month|mo|year|yr|week|wk|lesson|course)\b)?/i;

function splitPrice(s: TimedScene): { price?: string; sub?: string } {
  const sub = s.subtext?.trim();
  if (sub) {
    const m = sub.match(PRICE_RE);
    if (m) {
      const rest = sub.replace(m[0], "").replace(/^[\s\-–—|•·:,]+|[\s\-–—|•·:,]+$/g, "");
      return { price: m[0].trim(), sub: rest || undefined };
    }
    return { sub };
  }
  const hm = s.headline.match(PRICE_RE);
  return hm ? { price: hm[0].trim() } : {};
}

function priceBadge(price: string): string {
  const m = price.match(/^(.*?)\s?((?:\/|per)\s?\w+)$/i);
  const main = m ? m[1] : price;
  const per = m ? m[2].replace(/^per\s?/i, "/") : "";
  const size = main.length > 6 ? 54 : main.length > 4 ? 64 : 76;
  return `<div class="price"><small>${per ? "just" : "only"}</small><b style="font-size:${size}px">${esc(main)}</b>${per ? `<small class="per">${esc(per.replace(/\s+/g, ""))}</small>` : ""}</div>`;
}

function scene(ctx: Ctx, s: TimedScene): string {
  const { price, sub } = splitPrice(s);
  const head = s.headline;
  const size = fit(head, 88, 54, 18);
  const pos = ["l", "r", "l", "r"];
  const callouts = (s.bullets ?? []).slice(0, 4).map(
    (b, i) =>
      `<div class="call call-${pos[i]}" style="top:${520 + i * 118}px"><span class="dot"></span>${rich(b)}</div>`,
  );
  const visual = s.m
    ? mediaTag(s, "pimg")
    : `<div class="pfallback"><span>${esc(plain(head).split(/\s+/).slice(0, 2).join(" "))}</span></div>`;
  return `<section id="s${s.idx}" class="clip scene" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1">
  <div class="ring"></div>
  <div class="card"><div class="cardin">${visual}</div><div class="shine"></div></div>
  ${price ? priceBadge(price) : ""}
  ${callouts.join("\n  ")}
  <div class="txt">
    <div class="kicker">${esc(s.idx === 0 ? "Just dropped" : "Featured")}</div>
    <h1 class="head" style="font-size:${size}px">${rich(head)}</h1>
    ${sub ? `<p class="sub">${rich(sub)}</p>` : ""}
  </div>
</section>`;
}

function sceneJs(s: TimedScene): string {
  const id = `#s${s.idx}`;
  const dir = s.idx % 2 === 0 ? 1 : -1;
  const L: string[] = [];
  L.push(`tl.fromTo("${id} .ring",{scale:.6,rotation:0,opacity:0},{scale:1,rotation:${dir * 50},opacity:1,duration:${s.dur},ease:"power1.out"},${at(s, 0)});`);
  L.push(`tl.fromTo("${id} .card",{x:${dir * 1100},rotation:${dir * 12}},{x:0,rotation:${dir * -2.5},duration:.75,ease:"power4.out"},${at(s, 0)});`);
  L.push(`tl.fromTo("${id} .cardin > *",{scale:1.18},{scale:1.02,duration:${s.dur},ease:"none"},${at(s, 0)});`);
  L.push(`tl.fromTo("${id} .shine",{xPercent:-160},{xPercent:260,duration:.9,ease:"power2.inOut"},${at(s, 0.7)});`);
  L.push(`if (document.querySelector("${id} .price")) tl.fromTo("${id} .price",{scale:0,rotation:-90},{scale:1,rotation:12,duration:.6,ease:"back.out(2.4)"},${at(s, 0.65)});`);
  L.push(`if (document.querySelector("${id} .price")) tl.to("${id} .price",{rotation:4,scale:1.06,duration:.5,ease:"sine.inOut",yoyo:true,repeat:${Math.max(1, Math.floor((s.dur - 1.5) / 0.5)) | 1}},${at(s, 1.3)});`);
  L.push(`if (document.querySelector("${id} .call-l")) tl.fromTo("${id} .call-l",{x:-500,opacity:0},{x:0,opacity:1,duration:.5,ease:"back.out(1.6)",stagger:.3},${at(s, 0.9)});`);
  L.push(`if (document.querySelector("${id} .call-r")) tl.fromTo("${id} .call-r",{x:500,opacity:0},{x:0,opacity:1,duration:.5,ease:"back.out(1.6)",stagger:.3},${at(s, 1.05)});`);
  L.push(`tl.fromTo("${id} .kicker",{y:30,opacity:0},{y:0,opacity:1,duration:.4,ease:"power3.out"},${at(s, 0.35)});`);
  L.push(`tl.fromTo("${id} .head",{y:60,opacity:0},{y:0,opacity:1,duration:.55,ease:"power3.out"},${at(s, 0.45)});`);
  L.push(`if (document.querySelector("${id} .sub")) tl.fromTo("${id} .sub",{y:40,opacity:0},{y:0,opacity:1,duration:.5,ease:"power3.out"},${at(s, 0.65)});`);
  L.push(`tl.to("${id} .card",{x:${dir * -1100},rotation:${dir * -10},duration:.4,ease:"power3.in"},${at(s, s.dur - 0.4)});`);
  L.push(`tl.to("${id} .txt, ${id} .call, ${id} .price",{opacity:0,y:-30,duration:.3,ease:"power2.in"},${at(s, s.dur - 0.32)});`);
  return L.join("\n");
}

export const productShowcase: TemplateDef = {
  id: "product-showcase",
  name: "Product Showcase",
  description:
    "Shop-style product reel: each scene's image slides in on a tilted card with a light sweep, a spinning price sticker (put a price like \"$34\" in the subtext), up to 4 feature callouts from bullets, and an elegant serif headline. Ideal for Etsy / handmade / e-commerce products.",
  tags: ["product", "etsy", "ecommerce", "price", "images"],
  defaultSceneSec: 3.6,
  ctaSec: 3.4,
  fonts: { heading: "Playfair Display", body: "Poppins" },
  build(ctx) {
    const p = ctx.pal;
    const warm = mix(p.background, p.secondary, 0.18);
    const css = `
.scene{background:radial-gradient(120% 80% at 50% 30%, ${mix(p.background, "#FFFFFF", 0.4)} 0%, ${warm} 55%, ${mix(warm, p.primary, 0.25)} 100%);color:var(--on-bg)}
.scene .ring{position:absolute;left:50%;top:720px;width:1180px;height:1180px;margin:-590px 0 0 -590px;border-radius:50%;
  background:repeating-conic-gradient(${rgba(p.primary, 0.1)} 0 10deg, transparent 10deg 20deg)}
.scene .card{position:absolute;left:160px;top:300px;width:760px;height:830px;border-radius:44px;overflow:hidden;background:linear-gradient(150deg,${p.primary},${p.secondary});
  box-shadow:0 50px 90px ${rgba(p.dark, 0.35)}, 0 0 0 14px #FFFFFF}
.scene .cardin{position:absolute;inset:0}
.scene .pimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scene .pfallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:60px;text-align:center}
.scene .pfallback span{font:700 120px/1.05 var(--fh);color:${p.onPrimary};opacity:.9}
.scene .shine{position:absolute;top:-20%;bottom:-20%;width:180px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-18deg)}
.scene .price{position:absolute;left:720px;top:230px;width:250px;height:250px;border-radius:50%;background:var(--accent);color:var(--on-accent);
  display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 20px 50px ${rgba(p.dark, 0.35)};border:6px dashed ${rgba(p.onAccent, 0.35)};z-index:5}
.scene .price small{font:700 30px/1 var(--fb);text-transform:uppercase;letter-spacing:.15em;opacity:.85}
.scene .price b{font:900 76px/1.05 var(--fb);letter-spacing:-.02em}
.scene .price small.per{text-transform:none;letter-spacing:.02em;font-size:30px;margin-top:2px}
.scene .call{position:absolute;display:flex;align-items:center;gap:16px;padding:22px 32px;border-radius:999px;background:#FFFFFF;color:${p.dark};
  font:700 36px/1 var(--fb);box-shadow:0 16px 40px ${rgba(p.dark, 0.25)};z-index:6;max-width:640px;white-space:nowrap}
.scene .call-l{left:${70}px}
.scene .call-r{right:${150}px}
.scene .call .dot{width:22px;height:22px;border-radius:50%;background:var(--accent);flex:none;box-shadow:0 0 0 6px ${rgba(p.accent, 0.25)}}
.scene .txt{position:absolute;left:90px;right:140px;top:1180px;bottom:400px;display:flex;flex-direction:column;gap:18px;justify-content:flex-start}
.scene .kicker{font:700 30px/1 var(--fb);letter-spacing:.3em;text-transform:uppercase;color:var(--primary)}
.scene .head{font-family:var(--fh);font-weight:700;line-height:1.05;color:${p.onBackground}}
.scene .head .acc{color:var(--primary);font-style:italic}
.scene .sub{font:500 40px/1.3 var(--fb);opacity:.85}
`;
    const body =
      ctx.scenes.map((s) => scene(ctx, s)).join("\n") +
      "\n" +
      brandBar(ctx, p.onBackground, `background:${rgba("#FFFFFF", 0.75)};padding:8px 28px 8px 8px;border-radius:999px`) +
      "\n" +
      ctaHtml(ctx, {
        variant: "sticker",
        bg: `linear-gradient(160deg, ${p.primary} 0%, ${mix(p.primary, p.dark, 0.5)} 100%)`,
        fg: p.onPrimary,
        pillBg: p.accent,
        pillFg: p.onAccent,
        eyebrow: "Comment",
      });
    return { css, body, js: ctx.scenes.map(sceneJs).join("\n") };
  },
};
