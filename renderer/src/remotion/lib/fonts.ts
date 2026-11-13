// Google fonts loaded from the Google Fonts CSS API by the headless browser at render time.
// Rendering waits (delayRender) until the faces are loaded; if offline, it falls back to system stacks after a timeout.
import { continueRender, delayRender } from "remotion";
import { setArabicMode, scriptLang } from "./text.ts";

const FAMILIES: { css: string; name: string; faces: string[] }[] = [
  { css: "Anton", name: "Anton", faces: ["400"] },
  { css: "Bebas+Neue", name: "Bebas Neue", faces: ["400"] },
  { css: "Playfair+Display:ital,wght@0,400;0,700;1,400;1,700", name: "Playfair Display", faces: ["400", "700", "italic 400"] },
  { css: "Bodoni+Moda:ital,wght@0,400;0,700;1,400;1,700", name: "Bodoni Moda", faces: ["400", "700", "italic 700"] },
  { css: "Inter:wght@400;600;800", name: "Inter", faces: ["400", "600", "800"] },
  { css: "Space+Grotesk:wght@400;700", name: "Space Grotesk", faces: ["400", "700"] },
  { css: "JetBrains+Mono:wght@400;700", name: "JetBrains Mono", faces: ["400", "700"] },
  { css: "Caveat:wght@700", name: "Caveat", faces: ["700"] },
  { css: "Permanent+Marker", name: "Permanent Marker", faces: ["400"] },
  { css: "Montserrat:ital,wght@0,600;0,900;1,900", name: "Montserrat", faces: ["600", "900", "italic 900"] },
  { css: "Fraunces:ital,wght@0,400;0,700;1,400", name: "Fraunces", faces: ["400", "700", "italic 400"] },
  { css: "DM+Serif+Display", name: "DM Serif Display", faces: ["400"] },
];

let loaded = false;
function loadAll() {
  if (loaded || typeof document === "undefined") return;
  loaded = true;
  const handle = delayRender("Loading Google fonts", { timeoutInMilliseconds: 60000 });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    continueRender(handle);
  };
  const timer = setTimeout(finish, 20000); // offline: continue with fallbacks
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?" + FAMILIES.map((f) => "family=" + f.css).join("&") + "&display=block";
  link.onload = () => {
    const loads = FAMILIES.flatMap((f) => f.faces.map((face) => document.fonts.load(face + ' 48px "' + f.name + '"', "AaBb")));
    Promise.allSettled(loads).then(() => {
      clearTimeout(timer);
      finish();
    });
  };
  link.onerror = () => {
    clearTimeout(timer);
    finish();
  };
  document.head.appendChild(link);
}
loadAll();

// ---- Urdu (Arabic script) ----
// Noto Nastaliq Urdu is the traditional Urdu style; Noto Naskh Arabic is the fallback (and covers glyphs
// Nastaliq lacks). Loaded only for specs that contain Arabic-script text (see Reel / CarouselSlide), and
// the render waits until both faces are ready so the first frames already have joined Nastaliq letters.
const URDU_FAMILIES = [
  { css: "Noto+Nastaliq+Urdu:wght@400;700", name: "Noto Nastaliq Urdu", faces: ["400", "700"] },
  { css: "Noto+Naskh+Arabic:wght@400;700", name: "Noto Naskh Arabic", faces: ["400", "700"] },
];
let urduLoaded = false;
/** Arabic-script fonts. lang "ar" loads only Naskh (standard Arabic lettering); otherwise Nastaliq (Urdu) + Naskh. */
export function loadUrduFonts(lang?: string, scriptText?: string) {
  const arabic = /^ar/i.test(lang ?? "") || (!lang && scriptText !== undefined && scriptLang(scriptText) === "ar");
  setArabicMode(arabic);
  if (urduLoaded || typeof document === "undefined") return;
  urduLoaded = true;
  const handle = delayRender("Loading Urdu fonts", { timeoutInMilliseconds: 60000 });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    continueRender(handle);
  };
  const timer = setTimeout(finish, 25000); // offline: continue with system fallbacks
  if (arabic) {
    // Arabic must never fall back to Nastaliq (it may be installed on the PC). Register the Naskh files under the
    // "Noto Nastaliq Urdu" name too: a web font declared with that name shadows any installed font of that name,
    // so every font stack in the app renders Arabic in Naskh.
    const href = "https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=block";
    fetch(href)
      .then((r) => r.text())
      .then(async (css) => {
        const faces: FontFace[] = [];
        for (const block of css.split("@font-face").slice(1)) {
          const src = block.match(/src:\s*(url\([^)]+\)[^;]*);/)?.[1];
          if (!src) continue;
          const weight = block.match(/font-weight:\s*(\d+)/)?.[1] ?? "400";
          const range = block.match(/unicode-range:\s*([^;]+);/)?.[1];
          for (const family of ["Noto Naskh Arabic", "Noto Nastaliq Urdu"]) {
            faces.push(new FontFace(family, src, { weight, display: "block", ...(range ? { unicodeRange: range } : {}) }));
          }
        }
        await Promise.allSettled(faces.map(async (f) => (document.fonts as unknown as { add: (f: FontFace) => void }).add(await f.load())));
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        finish();
      });
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  const families = arabic ? URDU_FAMILIES.filter((f) => /Naskh/.test(f.name)) : URDU_FAMILIES;
  link.href = "https://fonts.googleapis.com/css2?" + families.map((f) => "family=" + f.css).join("&") + "&display=block";
  link.onload = () => {
    const sample = "اردو کی آواز سیکھیں ۔ ؟ ،";
    const loads = families.flatMap((f) => f.faces.map((face) => document.fonts.load(face + " 48px \"" + f.name + "\"", sample)));
    Promise.allSettled(loads).then(() => {
      clearTimeout(timer);
      finish();
    });
  };
  link.onerror = () => {
    clearTimeout(timer);
    finish();
  };
  document.head.appendChild(link);
}

const anton = "Anton";
const bebas = "Bebas Neue";
const playfair = "Playfair Display";
const bodoni = "Bodoni Moda";
const inter = "Inter";
const spaceGrotesk = "Space Grotesk";
const mono = "JetBrains Mono";
const caveat = "Caveat";
const marker = "Permanent Marker";
const montserrat = "Montserrat";
const fraunces = "Fraunces";
const dmSerif = "DM Serif Display";

const SANS = "'Segoe UI', Arial, Helvetica, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const COND = "Impact, 'Arial Narrow', 'Segoe UI', sans-serif";
const MONO = "Consolas, 'Courier New', monospace";

const q = (f: string) => `'${f}'`;
// Appended to every stack: Latin fonts have no Arabic glyphs, so Urdu text falls back per glyph to Nastaliq.
const URDU = "'Noto Nastaliq Urdu', 'Noto Naskh Arabic'";

export const FONTS = {
  condensed: `${q(anton)}, ${URDU}, ${COND}`,
  bebas: `${q(bebas)}, ${URDU}, ${COND}`,
  serif: `${q(playfair)}, ${URDU}, ${SERIF}`,
  didone: `${q(bodoni)}, ${URDU}, ${SERIF}`,
  sans: `${q(inter)}, ${URDU}, ${SANS}`,
  grotesk: `${q(spaceGrotesk)}, ${URDU}, ${SANS}`,
  mono: `${q(mono)}, ${URDU}, ${MONO}`,
  hand: `${q(caveat)}, ${URDU}, 'Segoe Print', cursive`,
  marker: `${q(marker)}, ${URDU}, 'Segoe Print', cursive`,
  heavy: `${q(montserrat)}, ${URDU}, ${SANS}`,
  soft: `${q(fraunces)}, ${URDU}, ${SERIF}`,
  display: `${q(dmSerif)}, ${URDU}, ${SERIF}`,
  /** Urdu captions / explicit Urdu text: Nastaliq first, Naskh fallback. */
  urdu: `${URDU}, serif`,
} as const;

const known: Record<string, string> = {
  anton: FONTS.condensed,
  "bebas neue": FONTS.bebas,
  "playfair display": FONTS.serif,
  "bodoni moda": FONTS.didone,
  inter: FONTS.sans,
  "space grotesk": FONTS.grotesk,
  "jetbrains mono": FONTS.mono,
  caveat: FONTS.hand,
  "permanent marker": FONTS.marker,
  montserrat: FONTS.heavy,
  fraunces: FONTS.soft,
  "dm serif display": FONTS.display,
};

/** If the brand asks for a font we have loaded, use it; otherwise keep the style's own font. */
export function brandFont(requested: string | undefined, styleDefault: string): string {
  if (!requested) return styleDefault;
  const k = requested.toLowerCase().replace(/['"]/g, "").split(",")[0].trim();
  return known[k] ?? styleDefault;
}
