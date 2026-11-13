// Competitor discovery: brand facts → search intents → Google results (Apify SERP) + LLM seeds + Play Store /
// Etsy neighbours → ranked competitor list. Works without Apify (LLM seeds only) and without an LLM (SERP only).
import { nanoid } from "nanoid";
import type { Brand, BrandBrain, Competitor } from "../../../shared/types.ts";
import { askJson, llmAvailable } from "../llm.ts";
import { ACTORS, apifyAvailable, runActor } from "./apify.ts";
import { UA, domainOf, isGeneric, normalizeSite, rootDomain, uniq } from "./util.ts";
import { packageIdFrom, fetchPlayListing } from "../playstore.ts";
import { EtsyApi, fetchShopRss } from "../etsy-client.ts";
import { etsyKey } from "../etsy.ts";

export type SiteKind = "brand" | "etsy-shop" | "app" | "marketplace";

export function siteKind(website: string): SiteKind {
  const d = domainOf(website);
  if (/etsy\.com$/.test(d)) return "etsy-shop";
  if (/play\.google\.com$/.test(d) || /apps\.apple\.com$/.test(d)) return "app";
  return "brand";
}
export function etsyShopFromUrl(u: string): string | undefined {
  return u.match(/etsy\.com\/(?:[a-z]{2}\/)?shop\/([A-Za-z0-9_-]+)/i)?.[1];
}

export interface KeywordPlan {
  category: string;
  queries: { query: string; intent: string }[];
  seeds: { name: string; website: string; why: string }[];
}

const KEYWORD_SYSTEM = `You are a marketing researcher. Given facts about a brand, return JSON:
{"category": string (short market category, e.g. "printable party games"),
 "queries": [{"query": string, "intent": "buy"|"compare"|"learn"|"app"}] — 8 Google searches its ideal customers actually type when looking for what this brand sells (mix buy/compare intents; include the product category and 1-2 specific product queries; no brand names),
 "seeds": [{"name": string, "website": string, "why": string}] — up to 8 real direct competitors you know of (same product/category/audience; for an Etsy shop other Etsy shops or brands selling the same printables; for an app other apps in the same niche). Only include ones you are confident exist; website = homepage or Play Store / Etsy shop URL.}`;

export async function planKeywords(brand: Brand, brain: BrandBrain, website: string, kind: SiteKind): Promise<KeywordPlan> {
  const fallback: KeywordPlan = {
    category: brain.niche || brain.products[0] || brand.name,
    queries: uniq([
      ...brain.products.slice(0, 4).map((p) => `${p.toLowerCase()}`),
      `${brain.niche || brain.products[0] || brand.name} ${kind === "app" ? "app" : "shop"}`.toLowerCase(),
      `best ${brain.niche || brain.products[0] || ""}`.trim().toLowerCase(),
      ...brain.keywords.slice(0, 3).map((k) => k.toLowerCase()),
    ])
      .filter((q) => q.length > 3)
      .slice(0, 8)
      .map((query) => ({ query, intent: "buy" })),
    seeds: [],
  };
  if (!llmAvailable()) return fallback;
  try {
    const r = await askJson<any>(
      KEYWORD_SYSTEM,
      JSON.stringify({ brand: brand.name, website, kind, summary: brain.summary, products: brain.products, audience: brain.audience, niche: brain.niche, keywords: brain.keywords, differentiators: brain.differentiators }),
      2500,
    );
    const queries = Array.isArray(r?.queries) ? r.queries.map((q: any) => ({ query: String(q?.query ?? q).trim(), intent: String(q?.intent ?? "buy") })).filter((q: any) => q.query.length > 2).slice(0, 10) : [];
    const seeds = Array.isArray(r?.seeds) ? r.seeds.map((s: any) => ({ name: String(s?.name ?? "").trim(), website: String(s?.website ?? "").trim(), why: String(s?.why ?? "").trim() })).filter((s: any) => s.name && s.website).slice(0, 8) : [];
    return { category: String(r?.category || fallback.category), queries: queries.length ? queries : fallback.queries, seeds };
  } catch (e: any) {
    console.warn("[research] keyword plan LLM failed:", e?.message ?? e);
    return fallback;
  }
}

export interface SerpHit {
  query: string;
  position: number;
  title: string;
  url: string;
  description: string;
}

/** Google organic results for the queries (one page each) via Apify. */
export async function searchSerp(queries: string[], country: string, onCost: (usd: number) => void): Promise<SerpHit[]> {
  if (!apifyAvailable() || !queries.length) return [];
  const r = await runActor<any>(ACTORS.serp, { queries: queries.join("\n"), countryCode: country.toLowerCase(), maxPagesPerQuery: 1, resultsPerPage: 20, focusOnPaidAds: false }, { timeoutSec: 240 });
  onCost(r.costUsd);
  const out: SerpHit[] = [];
  for (const page of r.items) {
    const q = String(page?.searchQuery?.term ?? "");
    for (const o of page?.organicResults ?? []) if (o?.url) out.push({ query: q, position: Number(o.position) || 0, title: String(o.title ?? ""), url: String(o.url), description: String(o.description ?? "") });
    for (const o of page?.paidResults ?? []) if (o?.url) out.push({ query: q, position: 0, title: `[ad] ${o.title ?? ""}`, url: String(o.url), description: String(o.description ?? "") });
  }
  return out;
}

/** Google Play search page (no API): app ids for a query. */
export async function playSearch(query: string): Promise<string[]> {
  try {
    const res = await fetch(`https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=en&gl=US`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return [];
    const html = await res.text();
    return uniq([...html.matchAll(/\/store\/apps\/details\?id=([A-Za-z0-9_.]+)/g)].map((m) => m[1])).slice(0, 12);
  } catch {
    return [];
  }
}

/** Etsy competitors from Etsy's own search: shops whose listings rank for the brand's keywords (needs the Etsy API key). */
export async function etsyDiscover(queries: string[], ownShop: string | undefined, log: (t: string) => void): Promise<Candidate[]> {
  const key = etsyKey();
  if (!key) return [];
  const api = new EtsyApi({ apiKey: key });
  const shops = new Map<number, { hits: number; titles: string[] }>();
  for (const q of queries.slice(0, 5)) {
    try {
      const r = await api.get<{ results: any[] }>("/listings/active", { keywords: q, limit: 48, sort_on: "score" });
      for (const l of r?.results ?? []) {
        const id = Number(l.shop_id);
        if (!id) continue;
        const e = shops.get(id) ?? { hits: 0, titles: [] };
        e.hits++;
        if (e.titles.length < 4 && l.title) e.titles.push(String(l.title).slice(0, 90));
        shops.set(id, e);
      }
    } catch (e: any) {
      log(`Etsy search "${q}" failed: ${e?.message ?? e}`);
    }
  }
  // Etsy boosts brand-new listings, so keyword hits alone surface zero-sale shops: weight by sales + reviews.
  const top = [...shops.entries()].sort((a, b) => b[1].hits - a[1].hits).slice(0, 16);
  const scored: (Candidate & { sales: number })[] = [];
  for (const [id, e] of top) {
    try {
      const s = await api.get<any>(`/shops/${id}`);
      const name = String(s?.shop_name ?? "");
      if (!name || (ownShop && name.toLowerCase() === ownShop.toLowerCase())) continue;
      const sales = Number(s.transaction_sold_count ?? 0) || 0;
      const reviews = Number(s.review_count ?? 0) || 0;
      const since = s.create_date ? new Date(Number(s.create_date) * 1000).getFullYear() : undefined;
      const weight = e.hits + Math.log10(1 + sales) * 2 + (reviews > 100 ? 2 : 0);
      scored.push({ name, website: `https://www.etsy.com/shop/${name}`, domain: `etsy.com/shop/${name.toLowerCase()}`, kind: "etsy-shop", source: "etsy", sales, why: `${sales.toLocaleString()} sales · ${reviews.toLocaleString()} reviews${s.review_average ? ` (${s.review_average}★)` : ""} · ${s.listing_active_count ?? "?"} listings${since ? ` · on Etsy since ${since}` : ""} · ranks for ${e.hits} of your keyword searches`, hits: Math.round(weight), snippets: [`${sales} sales, ${reviews} reviews, ${s.listing_active_count ?? "?"} active listings${since ? `, since ${since}` : ""}`, ...e.titles] });
    } catch {
      /* skip shop */
    }
  }
  scored.sort((a, b) => b.hits - a.hits);
  // keep established shops first; zero-sale newcomers only fill in when nothing else ranks
  const established = scored.filter((c) => c.sales > 0);
  const out: Candidate[] = (established.length >= 3 ? established : scored).slice(0, 10).map(({ sales: _s, ...c }) => c);
  log(`Etsy search: ${scored.length} shops rank for your keywords, ${established.length} with sales`);
  return out;
}

/** Does this Etsy shop exist (LLM-suggested names are often wrong)? Returns the real name or undefined. */
async function verifyEtsyShop(name: string): Promise<string | undefined> {
  const key = etsyKey();
  try {
    if (key) return (await new EtsyApi({ apiKey: key }).findShop(name)).name;
    await fetchShopRss(name);
    return name;
  } catch {
    return undefined;
  }
}

interface Candidate {
  name: string;
  website: string;
  domain: string;
  kind: SiteKind;
  source: Competitor["source"];
  why?: string;
  hits: number;
  snippets: string[];
}

function candidateFromUrl(url: string, title: string, desc: string, source: Competitor["source"]): Candidate | undefined {
  const d = domainOf(url);
  if (!d) return undefined;
  const shop = etsyShopFromUrl(url);
  if (shop) return { name: shop, website: `https://www.etsy.com/shop/${shop}`, domain: `etsy.com/shop/${shop.toLowerCase()}`, kind: "etsy-shop", source, hits: 1, snippets: [title, desc].filter(Boolean) };
  const pkg = /play\.google\.com$/.test(d) ? packageIdFrom(url) : undefined;
  if (pkg) return { name: title.replace(/ - Apps on Google Play.*$/i, "").trim() || pkg, website: `https://play.google.com/store/apps/details?id=${pkg}`, domain: `play.google.com/${pkg}`, kind: "app", source, hits: 1, snippets: [desc].filter(Boolean) };
  if (isGeneric(d)) return undefined;
  const name = (title.split(/\s[|–—-]\s|:/)[0] || rootDomain(d).split(".")[0]).trim().slice(0, 60);
  return { name: name || d, website: `https://${d}`, domain: rootDomain(d), kind: "brand", source, hits: 1, snippets: [title, desc].filter(Boolean) };
}

const RANK_SYSTEM = `You rank competitor candidates for a brand. Input: the brand (what it sells, to whom) and candidates with where they were found (search snippets). Return JSON {"competitors": [{"index": number, "name": string, "why": string, "relevance": number 0-1}]}: keep ONLY real direct competitors — businesses selling the same kind of product/app to the same audience. Drop blogs, directories, news, tutorials, suppliers, tools, unrelated shops and the brand itself. Order by relevance. Fix the name to the brand's real name when the snippet shows it.`;

export interface DiscoverInput {
  brand: Brand;
  brain: BrandBrain;
  website: string;
  kind: SiteKind;
  plan: KeywordPlan;
  country: string;
  count: number;
  include: string[];
  exclude: string[];
  log: (t: string) => void;
  onCost: (usd: number) => void;
}

export async function discoverCompetitors(inp: DiscoverInput): Promise<{ competitors: Competitor[]; serp: { query: string; topDomains: string[] }[] }> {
  const own = domainOf(inp.website);
  const ownRoot = rootDomain(own);
  const ownShop = etsyShopFromUrl(inp.website)?.toLowerCase();
  const ownPkg = inp.kind === "app" ? packageIdFrom(inp.website) : undefined;
  const excluded = new Set(inp.exclude.map((e) => rootDomain(domainOf(e))));
  const byKey = new Map<string, Candidate>();
  const add = (c: Candidate | undefined) => {
    if (!c) return;
    if (c.domain === ownRoot || (ownShop && c.domain.endsWith(ownShop)) || (ownPkg && c.domain.endsWith(ownPkg))) return;
    if (excluded.has(rootDomain(c.domain))) return;
    const k = c.domain;
    const e = byKey.get(k);
    if (e) {
      e.hits += c.hits;
      e.snippets.push(...c.snippets);
      if (!e.why && c.why) e.why = c.why;
    } else byKey.set(k, c);
  };

  // 1. manual includes
  for (const inc of inp.include) {
    const s = inc.trim();
    if (!s) continue;
    if (s.startsWith("@")) add({ name: s.slice(1), website: `https://www.instagram.com/${s.slice(1)}/`, domain: `instagram.com/${s.slice(1).toLowerCase()}`, kind: "brand", source: "manual", hits: 5, snippets: [] });
    else add({ ...(candidateFromUrl(normalizeSite(s), "", "", "manual") ?? { name: s, website: normalizeSite(s), domain: rootDomain(domainOf(s)), kind: "brand" as SiteKind, source: "manual" as const, hits: 0, snippets: [] }), hits: 5 });
  }
  // 2. LLM seeds (Etsy shops are verified against Etsy first — Claude often guesses shop names)
  for (const s of inp.plan.seeds) {
    const c = candidateFromUrl(normalizeSite(s.website), s.name, s.why, "llm");
    if (!c) continue;
    if (c.kind === "etsy-shop") {
      const real = await verifyEtsyShop(etsyShopFromUrl(c.website) ?? c.name);
      if (!real) {
        inp.log(`Skipped "${s.name}": no such Etsy shop`);
        continue;
      }
      add({ ...c, name: real, website: `https://www.etsy.com/shop/${real}`, domain: `etsy.com/shop/${real.toLowerCase()}`, why: s.why, hits: 2 });
    } else add({ ...c, name: s.name || c.name, why: s.why, hits: 2 });
  }
  // 2b. Etsy's own search (real shops that rank for the brand's keywords)
  if (inp.kind === "etsy-shop") for (const c of await etsyDiscover(inp.plan.queries.map((q) => q.query), ownShop, inp.log)) add(c);
  // 3. search results
  const serp: { query: string; topDomains: string[] }[] = [];
  let hits: SerpHit[] = [];
  try {
    hits = await searchSerp(inp.plan.queries.map((q) => q.query), inp.country, inp.onCost);
    inp.log(`Google: ${hits.length} results for ${inp.plan.queries.length} searches`);
  } catch (e: any) {
    inp.log(`Google search skipped: ${e?.message ?? e}`);
  }
  for (const q of inp.plan.queries) {
    const qs = hits.filter((h) => h.query === q.query).sort((a, b) => a.position - b.position);
    serp.push({ query: q.query, topDomains: uniq(qs.map((h) => (etsyShopFromUrl(h.url) ? `etsy.com/shop/${etsyShopFromUrl(h.url)}` : rootDomain(domainOf(h.url))))).slice(0, 8) });
    for (const h of qs) add(candidateFromUrl(h.url, h.title, h.description, "serp"));
  }
  // 4. Play Store neighbours for apps
  if (inp.kind === "app") {
    const ids = uniq((await Promise.all(inp.plan.queries.slice(0, 4).map((q) => playSearch(q.query)))).flat()).filter((id) => id !== ownPkg).slice(0, 10);
    for (const id of ids) {
      const existing = byKey.get(`play.google.com/${id}`);
      if (existing) {
        existing.hits += 2;
        continue;
      }
      try {
        const info = await fetchPlayListing(id);
        add({ name: info.title, website: info.url, domain: `play.google.com/${id}`, kind: "app", source: "playstore", hits: 2, snippets: [info.summary] });
      } catch {
        /* skip */
      }
    }
    inp.log(`Play Store: ${ids.length} neighbouring apps`);
  }
  // 5. rank
  let list = [...byKey.values()];
  // same-kind preference: for an Etsy shop, other Etsy shops + brands; for an app, apps first
  list.sort((a, b) => (b.kind === inp.kind ? 1 : 0) - (a.kind === inp.kind ? 1 : 0) || b.hits - a.hits);
  const pool = list.slice(0, Math.max(inp.count * 3, 18));
  let ranked: Competitor[] = [];
  if (llmAvailable() && pool.length) {
    try {
      const r = await askJson<any>(
        RANK_SYSTEM,
        JSON.stringify({
          brand: { name: inp.brand.name, website: inp.website, kind: inp.kind, sells: inp.brain.products.slice(0, 6), audience: inp.brain.audience, category: inp.plan.category },
          candidates: pool.map((c, i) => ({ index: i, name: c.name, website: c.website, kind: c.kind, foundVia: c.source, searchHits: c.hits, snippets: c.snippets.slice(0, 3).map((s) => s.slice(0, 160)) })),
          keep: inp.count,
        }),
        3000,
      );
      const picks: any[] = Array.isArray(r?.competitors) ? r.competitors : [];
      for (const p of picks) {
        const c = pool[Number(p?.index)];
        if (!c || ranked.some((x) => x.domain === c.domain)) continue;
        ranked.push(toCompetitor(c, Number(p?.relevance) || 0.6, String(p?.why ?? c.why ?? ""), String(p?.name || c.name)));
      }
    } catch (e: any) {
      inp.log(`Ranking with Claude failed (${e?.message ?? e}); using search frequency`);
    }
  }
  // manual includes always stay
  for (const c of pool.filter((x) => x.source === "manual")) if (!ranked.some((r) => r.domain === c.domain)) ranked.unshift(toCompetitor(c, 1, "Added by you", c.name));
  if (ranked.length < inp.count) {
    const maxHits = Math.max(1, ...pool.map((c) => c.hits));
    for (const c of pool) {
      if (ranked.length >= inp.count) break;
      if (!ranked.some((r) => r.domain === c.domain)) ranked.push(toCompetitor(c, 0.3 + (0.6 * c.hits) / maxHits, c.why ?? `Ranks for ${c.hits} of your searches`, c.name));
    }
  }
  ranked = ranked.slice(0, inp.count);
  inp.log(`Competitors: ${ranked.map((c) => c.name).join(", ") || "none found"}`);
  return { competitors: ranked, serp };
}

function toCompetitor(c: Candidate, relevance: number, why: string, name: string): Competitor {
  return { id: nanoid(10), name: name.slice(0, 80), website: c.website, domain: c.domain, kind: c.kind, source: c.source, why: why || undefined, relevance: Math.max(0, Math.min(1, relevance)), serpHits: c.source === "serp" ? c.hits : undefined, adsTotal: 0, adsActive: 0 };
}
