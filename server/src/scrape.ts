// Website scraping: home page + up to 5 relevant internal pages. Extracts text, headings, colors, logo.
import * as cheerio from "cheerio";

export interface ScrapeResult {
  url: string;
  ok: boolean;
  blocked?: boolean;
  error?: string;
  title?: string;
  description?: string;
  siteName?: string;
  headings: string[];
  text: string; // concatenated visible text (trimmed)
  colors: string[]; // hex colors ordered by frequency
  themeColor?: string;
  logoUrl?: string;
  ogImage?: string;
  images: string[];
  pages: string[];
  fonts: string[];
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function fetchText(url: string, timeoutMs = 15000): Promise<{ status: number; text: string; finalUrl: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/css,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
    });
    const text = res.ok ? await res.text() : "";
    return { status: res.status, text: text.slice(0, 3_000_000), finalUrl: res.url || url };
  } finally {
    clearTimeout(t);
  }
}

export function normalizeUrl(u: string): string {
  let s = u.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}

const HEX_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const RGB_RE = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;

export function normHex(h: string): string {
  let s = h.replace("#", "").toLowerCase();
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  return "#" + s.toUpperCase();
}
function collectColors(css: string, counts: Map<string, number>, weight = 1) {
  for (const m of css.match(HEX_RE) ?? []) {
    const h = normHex(m);
    counts.set(h, (counts.get(h) ?? 0) + weight);
  }
  for (const m of css.matchAll(RGB_RE)) {
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)));
    const h = "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
    counts.set(h, (counts.get(h) ?? 0) + weight);
  }
}

const PAGE_HINT = /(about|our-story|story|shop|store|product|collection|course|program|class|service|academy|learn|faq|contact)/i;

function extractPage(html: string, baseUrl: string, acc: ScrapeResult, colorCounts: Map<string, number>, isHome: boolean) {
  const $ = cheerio.load(html);
  const abs = (u?: string) => {
    if (!u) return undefined;
    try {
      return new URL(u, baseUrl).href;
    } catch {
      return undefined;
    }
  };
  if (isHome) {
    acc.title = $("title").first().text().trim() || $('meta[property="og:title"]').attr("content")?.trim();
    acc.description =
      $('meta[name="description"]').attr("content")?.trim() || $('meta[property="og:description"]').attr("content")?.trim();
    acc.siteName = $('meta[property="og:site_name"]').attr("content")?.trim();
    acc.themeColor = $('meta[name="theme-color"]').attr("content")?.trim();
    acc.ogImage = abs($('meta[property="og:image"]').attr("content"));
    const logoImg = $("img")
      .filter((_, el) => /logo/i.test([$(el).attr("class"), $(el).attr("id"), $(el).attr("src"), $(el).attr("alt")].join(" ")))
      .first();
    acc.logoUrl =
      abs(logoImg.attr("src") || logoImg.attr("data-src")) ||
      abs($('link[rel="apple-touch-icon"]').attr("href")) ||
      abs($('link[rel~="icon"]').attr("href"));
    if (acc.themeColor && /^#/.test(acc.themeColor)) colorCounts.set(normHex(acc.themeColor), (colorCounts.get(normHex(acc.themeColor)) ?? 0) + 20);
  }
  $("style").each((_, el) => collectColors($(el).text(), colorCounts));
  $("[style]").each((_, el) => collectColors($(el).attr("style") ?? "", colorCounts, 2));
  const fontLinks = $('link[href*="fonts.googleapis.com"]').map((_, el) => $(el).attr("href") ?? "").get();
  for (const f of fontLinks) {
    const m = f.match(/family=([^&:]+)/g) ?? [];
    for (const x of m) acc.fonts.push(decodeURIComponent(x.replace("family=", "").replace(/\+/g, " ")).split(":")[0]);
  }
  $("h1, h2, h3").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t && t.length < 160 && !acc.headings.includes(t)) acc.headings.push(t);
  });
  $("img").each((_, el) => {
    const src = abs($(el).attr("src") || $(el).attr("data-src"));
    if (src && /\.(jpe?g|png|webp)(\?|$)/i.test(src) && acc.images.length < 30) acc.images.push(src);
  });
  $("script, style, noscript, svg, nav, footer, header").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  acc.text += (acc.text ? "\n\n" : "") + text.slice(0, 6000);

  if (!isHome) return { links: [] as string[], css: [] as string[] };
  const host = new URL(baseUrl).host;
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = abs($(el).attr("href"));
    if (!href) return;
    try {
      const u = new URL(href);
      if (u.host !== host) return;
      u.hash = "";
      if (u.href === baseUrl) return;
      if (PAGE_HINT.test(u.pathname)) links.add(u.href);
    } catch {
      /* ignore */
    }
  });
  const cssLinks = $('link[rel="stylesheet"]')
    .map((_, el) => abs($(el).attr("href")))
    .get()
    .filter(Boolean) as string[];
  return { links: [...links].slice(0, 5), css: cssLinks.slice(0, 3) };
}

export async function scrapeSite(rawUrl: string): Promise<ScrapeResult> {
  const url = normalizeUrl(rawUrl);
  const acc: ScrapeResult = { url, ok: false, headings: [], text: "", colors: [], images: [], pages: [], fonts: [] };
  const colorCounts = new Map<string, number>();
  try {
    const home = await fetchText(url);
    if (home.status === 403 || home.status === 429 || (home.status >= 400 && /etsy\.com/i.test(url))) {
      acc.blocked = true;
      acc.error = `Site returned HTTP ${home.status} (bot protection?)`;
      return acc;
    }
    if (!home.text) {
      acc.error = `Site returned HTTP ${home.status}`;
      return acc;
    }
    if (/captcha|access denied|please verify you are a human/i.test(home.text.slice(0, 5000)) && home.text.length < 20000) {
      acc.blocked = true;
      acc.error = "Site served a bot-protection page";
      return acc;
    }
    acc.ok = true;
    acc.pages.push(home.finalUrl);
    const { links, css } = extractPage(home.text, home.finalUrl, acc, colorCounts, true);
    await Promise.all([
      ...links.map(async (l) => {
        try {
          const p = await fetchText(l, 10000);
          if (p.text) {
            acc.pages.push(l);
            extractPage(p.text, l, acc, colorCounts, false);
          }
        } catch {
          /* skip page */
        }
      }),
      ...css.map(async (c) => {
        try {
          const p = await fetchText(c, 8000);
          if (p.text) collectColors(p.text.slice(0, 400_000), colorCounts);
        } catch {
          /* skip css */
        }
      }),
    ]);
  } catch (e: any) {
    acc.error = e?.name === "AbortError" ? "Timed out fetching site" : `Could not fetch site: ${e?.message ?? e}`;
  }
  acc.colors = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, 24);
  acc.text = acc.text.slice(0, 20000);
  acc.fonts = [...new Set(acc.fonts)];
  return acc;
}
