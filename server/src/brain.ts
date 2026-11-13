// Brand brain: website analysis → BrandBrain (LLM when a key is set, deterministic heuristic otherwise).
import type { Brand, BrandBrain, BrandColors, BrandStyleRef } from "../../shared/types.ts";
import { DEFAULT_BEST_TIMES, nowIso } from "./config.ts";
import { getBrand, saveBrand, listAssets, updateBrand } from "./db.ts";
import { askJson, llmAvailable } from "./llm.ts";
import { scrapeSite, normHex, type ScrapeResult } from "./scrape.ts";
import { normalizeLanguage, hasUrduScript } from "./language.ts";

// ---------- color utils ----------
function rgb(hex: string): [number, number, number] {
  const h = normHex(hex).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function hsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((x) => x / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const isHex = (s: unknown): s is string => typeof s === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim());

function hashHue(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function paletteFromColors(colors: string[], seed: string): BrandColors {
  const saturated = colors.filter((c) => {
    const [, s, l] = hsl(c);
    return s > 0.25 && l > 0.15 && l < 0.85;
  });
  const distinct: string[] = [];
  for (const c of saturated) {
    const [h] = hsl(c);
    if (distinct.every((d) => Math.abs(hsl(d)[0] - h) > 18)) distinct.push(c);
    if (distinct.length >= 3) break;
  }
  const hue = distinct[0] ? hsl(distinct[0])[0] : hashHue(seed);
  const primary = distinct[0] ?? hslHex(hue, 0.6, 0.38);
  const secondary = distinct[1] ?? hslHex((hue + 30) % 360, 0.45, 0.25);
  const accent = distinct[2] ?? hslHex((hue + 180) % 360, 0.75, 0.55);
  const lights = colors.filter((c) => luminance(c) > 0.85);
  const background = lights[0] ?? "#FAF7F2";
  const darks = colors.filter((c) => luminance(c) < 0.05);
  const text = darks[0] ?? "#1A1A1A";
  return { primary, secondary, accent, background, text };
}

// ---------- text utils ----------
const STOP = new Set(
  "the a an and or but of to in on for with at by from is are was were be been it this that these those you your we our us they them their as not no yes can will just more most all any each about into over than then so if out up do does did have has had get got how what when where who why which also only very new one two its it's i me my shop store home cart menu login sign account search page item items free shipping ship policy privacy terms cookies cookie copyright reserved rights view add sale price usd eur gbp pkr www com http https etsy click here learn read contact email".split(
    " ",
  ),
);
export function topKeywords(text: string, n = 12): string[] {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
    const word = w.replace(/'s$/, "").replace(/^-|-$/g, "");
    if (STOP.has(word) || word.length < 4) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}
function sentences(text: string): string[] {
  return (text.match(/[^.!?]{20,240}[.!?]/g) ?? []).map((s) => s.trim());
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function isEtsy(url?: string) {
  return !!url && /etsy\.com/i.test(url);
}
function etsyShopName(url?: string): string | undefined {
  const m = url?.match(/etsy\.com\/(?:[a-z-]+\/)?shop\/([^/?#]+)/i);
  return m?.[1];
}

/** Deterministic brain from scraped data + description. */
export function heuristicBrain(brand: Brand, s?: ScrapeResult): BrandBrain {
  const desc = brand.description?.trim() ?? "";
  const corpus = [desc, s?.title, s?.description, ...(s?.headings ?? []), s?.text].filter(Boolean).join(". ");
  const keywords = topKeywords(corpus, 14);
  const etsy = isEtsy(brand.website);
  const academy = /academy|course|class|lesson|learn|school|tutor|teach|student|quran|arabic/i.test(corpus + brand.name);
  const handmade = etsy || /handmade|handcrafted|etsy|crafted|artisan|custom|personali[sz]ed/i.test(corpus);
  const niche = academy ? "online education" : handmade ? "handmade & gifts" : keywords.slice(0, 2).join(" ") || "small business";
  const summary =
    desc ||
    s?.description ||
    sentences(s?.text ?? "")[0] ||
    `${brand.name} is a ${niche} brand${brand.website ? ` (${brand.website})` : ""}.`;
  const productsFromHeadings = (s?.headings ?? []).filter((h) => h.split(" ").length <= 6).slice(0, 6);
  const products = productsFromHeadings.length
    ? productsFromHeadings
    : academy
      ? ["Online courses", "Live classes", "1:1 tutoring"]
      : handmade
        ? ["Handmade products", "Custom orders", "Gift sets"]
        : keywords.slice(0, 3).map(cap);
  const audience = academy
    ? "Students and parents looking for structured, trustworthy online learning"
    : handmade
      ? "Gift shoppers and people who love unique, handmade pieces"
      : `People interested in ${keywords.slice(0, 3).join(", ") || niche}`;
  const voice = academy
    ? "Warm, encouraging and clear — like a patient teacher"
    : handmade
      ? "Friendly, personal and crafty — the maker talking to you"
      : "Friendly, confident and helpful";
  const pillars = academy
    ? ["Quick lessons", "Student wins", "Behind the scenes", "Myths & mistakes", "How to start"]
    : handmade
      ? ["Making-of process", "Product spotlights", "Gift ideas", "Customer stories", "Behind the scenes"]
      : ["Tips", "Product spotlights", "Behind the scenes", "Customer stories", "FAQs"];
  const ctas = etsy
    ? ["Shop on Etsy — link in bio", "Comment SHOP and I'll DM you the link"]
    : academy
      ? ["Book a free trial class — link in bio", "Comment LEARN for the details"]
      : ["Link in bio", "Comment INFO and we'll DM you"];
  const colors = paletteFromColors(s?.colors ?? [], brand.name);
  return {
    summary,
    products,
    audience,
    voice,
    niche,
    colors,
    fonts: s?.fonts?.length ? { heading: s.fonts[0], body: s.fonts[1] ?? s.fonts[0] } : undefined,
    logoUrl: s?.logoUrl,
    claimsToAvoid: academy
      ? ["Guaranteed results or grades", "Unverified certifications"]
      : ["Medical or health claims", "Unverifiable 'best in the world' claims"],
    differentiators: academy
      ? ["Structured curriculum", "Qualified, caring teachers", "Flexible online schedule"]
      : handmade
        ? ["Made by hand in small batches", "Personal touch on every order", "Unique designs you won't find in stores"]
        : ["Personal service", "Quality you can see"],
    ctas,
    keywords: keywords.length ? keywords.slice(0, 12) : [niche.replace(/\s+/g, "")],
    contentPillars: pillars,
    competitors: [],
    bestTimes: DEFAULT_BEST_TIMES,
    // Urdu-teaching / Urdu-script brands default to Urdu narration + captions (editable on the Brand Brain page)
    language: /\burdu\b/i.test(desc) || hasUrduScript(desc) ? "ur" : "en",
  };
}

const strArr = (v: unknown, fb: string[]): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : fb;
const str = (v: unknown, fb: string): string => (typeof v === "string" && v.trim() ? v.trim() : fb);

/** Validate/repair a (possibly LLM-produced) brain, filling gaps from a fallback brain. */
export function normalizeBrain(raw: any, fb: BrandBrain): BrandBrain {
  const r = raw && typeof raw === "object" ? raw : {};
  const c = r.colors && typeof r.colors === "object" ? r.colors : {};
  const colors: BrandColors = {
    primary: isHex(c.primary) ? normHex(c.primary) : fb.colors.primary,
    secondary: isHex(c.secondary) ? normHex(c.secondary) : fb.colors.secondary,
    accent: isHex(c.accent) ? normHex(c.accent) : fb.colors.accent,
    background: isHex(c.background) ? normHex(c.background) : fb.colors.background,
    text: isHex(c.text) ? normHex(c.text) : fb.colors.text,
  };
  const bestTimes = strArr(r.bestTimes, fb.bestTimes ?? DEFAULT_BEST_TIMES).filter((t) => parseSlot(t));
  return {
    summary: str(r.summary, fb.summary),
    products: strArr(r.products, fb.products),
    audience: str(r.audience, fb.audience),
    voice: str(r.voice, fb.voice),
    niche: str(r.niche, fb.niche),
    colors,
    fonts: r.fonts && typeof r.fonts === "object" ? { heading: r.fonts.heading || fb.fonts?.heading, body: r.fonts.body || fb.fonts?.body } : fb.fonts,
    logoUrl: typeof r.logoUrl === "string" && /^https?:/.test(r.logoUrl) ? r.logoUrl : fb.logoUrl,
    claimsToAvoid: strArr(r.claimsToAvoid, fb.claimsToAvoid),
    differentiators: strArr(r.differentiators, fb.differentiators),
    ctas: strArr(r.ctas, fb.ctas),
    keywords: strArr(r.keywords, fb.keywords).map((k) => k.replace(/^#/, "").replace(/\s+/g, "")),
    contentPillars: strArr(r.contentPillars, fb.contentPillars),
    competitors: strArr(r.competitors, fb.competitors ?? []),
    bestTimes: bestTimes.length ? bestTimes : DEFAULT_BEST_TIMES,
    language: normalizeLanguage(str(r.language, fb.language ?? "en")),
    // voiceId: "" clears it (back to the default voice for the language)
    ...((typeof r.voiceId === "string" ? r.voiceId.trim() : fb.voiceId) ? { voiceId: typeof r.voiceId === "string" ? r.voiceId.trim() : fb.voiceId } : {}),
  };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function parseSlot(s: string): { dow: number; h: number; m: number } | undefined {
  const m = s.trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const dow = DAYS.findIndex((d) => d.toLowerCase() === m[1].toLowerCase());
  const h = Number(m[2]);
  const mi = Number(m[3]);
  if (dow < 0 || h > 23 || mi > 59) return undefined;
  return { dow, h, m: mi };
}

const BRAIN_SYSTEM = `You are a senior social media strategist building a "brand brain" for an Instagram autopilot.
Return JSON with exactly these keys:
{"summary": string (one paragraph), "products": string[], "audience": string, "voice": string, "niche": string,
 "colors": {"primary": hex, "secondary": hex, "accent": hex, "background": hex, "text": hex},
 "fonts": {"heading": string, "body": string}, "claimsToAvoid": string[], "differentiators": string[],
 "ctas": string[], "keywords": string[] (hashtag-ready, no #), "contentPillars": string[] (4-6),
 "competitors": string[], "bestTimes": string[] (3-5 like "Tue 18:00", local time, for this audience), "language": "en" | "ur" | "ur-roman" (language the brand posts in: "ur" = Urdu script, "ur-roman" = Roman Urdu)}
Use the site's real colors when given (pick a strong primary, a deep secondary, a contrasting accent, a background and readable text color).
Be specific to this business — never generic. Never invent facts that contradict the input.`;

export async function buildBrain(brand: Brand): Promise<BrandBrain> {
  let scrape: ScrapeResult | undefined;
  if (brand.website) scrape = await scrapeSite(brand.website);
  const fb = heuristicBrain(brand, scrape);
  // Prefer an uploaded logo-looking asset
  const logoAsset = listAssets(brand.id).find((a) => a.kind === "image" && /logo/i.test(a.originalName));
  if (logoAsset) fb.logoUrl = logoAsset.url;
  if (!llmAvailable()) return fb;
  const etsyName = etsyShopName(brand.website);
  const input = {
    brandName: brand.name,
    website: brand.website,
    instagramHandle: brand.instagramHandle,
    ownerDescription: brand.description,
    etsyShop: etsyName,
    scrape: scrape
      ? {
          ok: scrape.ok,
          blocked: scrape.blocked,
          note: scrape.blocked ? "The site blocked our crawler; rely on the owner description and brand name." : undefined,
          title: scrape.title,
          metaDescription: scrape.description,
          headings: scrape.headings.slice(0, 40),
          text: scrape.text.slice(0, 12000),
          colorsByFrequency: scrape.colors.slice(0, 12),
          themeColor: scrape.themeColor,
          fonts: scrape.fonts,
        }
      : undefined,
    heuristicDraft: fb,
  };
  try {
    const raw = await askJson(BRAIN_SYSTEM, JSON.stringify(input, null, 1), 4000);
    const brain = normalizeBrain(raw, fb);
    brain.logoUrl = fb.logoUrl ?? brain.logoUrl;
    return brain;
  } catch (e) {
    console.warn("[brain] LLM failed, using heuristic brain:", (e as Error).message);
    return fb;
  }
}

/** Run analysis in background and persist status. */
export function startAnalysis(brandId: string): Brand | undefined {
  const b = updateBrand(brandId, (x) => {
    x.analysisStatus = "running";
    x.analysisError = undefined;
  });
  if (!b) return undefined;
  (async () => {
    try {
      const brain = await buildBrain(b);
      updateBrand(brandId, (x) => {
        // keep user-edited bestTimes if present
        // keep a user-chosen language / voice across re-analysis (the website may be in another language)
        const keepLang = x.brain?.language && normalizeLanguage(x.brain.language) !== "en" ? { language: x.brain.language } : {};
        const keepVoice = x.brain?.voiceId ? { voiceId: x.brain.voiceId } : {};
        x.brain = { ...brain, ...keepLang, ...keepVoice };
        x.analysisStatus = "done";
      });
    } catch (e: any) {
      updateBrand(brandId, (x) => {
        x.analysisStatus = "failed";
        x.analysisError = String(e?.message ?? e);
      });
    }
  })();
  return b;
}

export function ensureBrain(brand: Brand): BrandBrain {
  if (brand.brain) return brand.brain;
  const brain = heuristicBrain(brand);
  brand.brain = brain;
  brand.updatedAt = nowIso();
  saveBrand(brand);
  return brain;
}

export function brandStyleRef(brand: Brand): BrandStyleRef {
  const brain = brand.brain ?? heuristicBrain(brand);
  const handle = brand.instagramHandle ? "@" + brand.instagramHandle.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "") : undefined;
  return { name: brand.name, handle, colors: brain.colors, logoUrl: brain.logoUrl, fonts: brain.fonts };
}

export { getBrand };
