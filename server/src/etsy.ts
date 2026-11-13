// Etsy shop → posts. Imports a shop's active listings (Etsy Open API v3 with a key, the shop RSS feed without
// one, or listings added by hand), stores them in `etsy_listings`, downloads listing photos into the brand's
// assets, feeds the Brand Brain, and turns a listing into a product reel / carousel / story with a
// keyword-first caption and an optional comment → DM automation that sends the listing link.
// Routes: registerEtsyRoutes(app) (see CONTRACTS.md "Etsy shop").
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Express, Request } from "express";
import type {
  Asset, Automation, Brand, BrandBrain, CarouselSpec, EtsyBrandFacts, EtsyImportJob, EtsyImportSummary, EtsyListing, EtsyReview,
  EtsyShopInfo, EtsyStatus, Post, PostType, ReelSpec, Scene, MediaRef,
} from "../../shared/types.ts";
import * as db from "./db.ts";
import { UPLOADS_DIR, fileUrlFor, nowIso } from "./config.ts";
import { ensureBrain, brandStyleRef } from "./brain.ts";
import { askJson, llmAvailable } from "./llm.ts";
import { getStyles, loadHyperframes, tryLoad } from "./engines.ts";
import { nextSlots, takenSlots } from "./schedule.ts";
import { newPost, type AnySpec } from "./posts.ts";
import { enqueueRender } from "./render.ts";
import { capHashtags, heuristicHashtags, keywordFirstCaption, normTag, shortTopic, smartLower } from "./hashtags.ts";
import {
  EtsyApi, EtsyError, cleanListingUrl, downloadImage, fetchShopRss, isEtsyImageUrl, largestImageUrl, listingIdFromUrl, parseShopName,
  type RawListing, type RawReview, type RawShop,
} from "./etsy-client.ts";

const httpErr = (status: number, msg: string) => Object.assign(new Error(msg), { status });

// ================================================================ storage
db.db.exec(`
CREATE TABLE IF NOT EXISTS etsy_listings (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, listing_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT, UNIQUE(brand_id, listing_id));
CREATE INDEX IF NOT EXISTS idx_etsy_listings_brand ON etsy_listings(brand_id);
`);

export function listListings(brandId: string): EtsyListing[] {
  return (db.db.prepare("SELECT data FROM etsy_listings WHERE brand_id = ?").all(brandId) as { data: string }[]).map((r) => JSON.parse(r.data));
}
export function getListing(brandId: string, listingId: string): EtsyListing | undefined {
  const r = db.db.prepare("SELECT data FROM etsy_listings WHERE brand_id = ? AND listing_id = ?").get(brandId, listingId) as { data: string } | undefined;
  return r ? JSON.parse(r.data) : undefined;
}
export function saveListing(l: EtsyListing): EtsyListing {
  db.db
    .prepare("INSERT INTO etsy_listings(id, brand_id, listing_id, data, updated_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(brand_id, listing_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .run(l.id, l.brandId, l.listingId, JSON.stringify(l), l.updatedAt);
  return l;
}
function deleteListingRow(brandId: string, listingId: string) {
  db.db.prepare("DELETE FROM etsy_listings WHERE brand_id = ? AND listing_id = ?").run(brandId, listingId);
}

/** Etsy key: "keystring:shared_secret" from Settings, or env ETSY_API_KEY. */
export const etsyKey = (): string | undefined => db.getSetting("etsyApiKey") || process.env.ETSY_API_KEY || undefined;
export const shopFor = (b: Brand): string | undefined => parseShopName(b.etsyShop) ?? parseShopName(b.website);

/** Newest first by listing date, then most favorited. */
const byNewest = (a: EtsyListing, b: EtsyListing) => Date.parse(b.listedAt ?? b.importedAt) - Date.parse(a.listedAt ?? a.importedAt);
const byTop = (a: EtsyListing, b: EtsyListing) => (b.favorers ?? 0) - (a.favorers ?? 0) || (b.views ?? 0) - (a.views ?? 0) || byNewest(a, b);

// ================================================================ import
const jobs = new Map<string, EtsyImportJob>();

export function etsyStatus(brandId: string): EtsyStatus {
  const b = db.getBrand(brandId);
  if (!b) throw httpErr(404, "Brand not found");
  const keySet = !!etsyKey();
  const shop = shopFor(b);
  return {
    shop,
    keySet,
    mode: keySet ? "api" : shop ? "rss" : "manual",
    info: b.etsy?.shop,
    lastImport: b.etsy?.lastImport,
    job: jobs.get(brandId),
    listingCount: listListings(brandId).length,
    facts: b.etsy,
  };
}

export interface ImportOptions {
  shop?: string;
  limit?: number;            // max listings (default 25, max 100)
  imagesPerListing?: number; // default 4 (max 10)
  source?: "auto" | "api" | "rss";
  onProgress?: (step: string, p: number) => void;
}

/** Run an import now (awaitable). Updates listings in place, downloads new photos, feeds the brand brain. */
export async function importShop(brandId: string, o: ImportOptions = {}): Promise<{ summary: EtsyImportSummary; listings: EtsyListing[] }> {
  let brand = db.getBrand(brandId);
  if (!brand) throw httpErr(404, "Brand not found");
  if (o.shop !== undefined) {
    const name = parseShopName(o.shop);
    if (!name) throw httpErr(400, `Not an Etsy shop name or URL: ${o.shop}`);
    brand = db.updateBrand(brandId, (x) => void (x.etsyShop = name))!;
  }
  const shop = shopFor(brand);
  if (!shop) throw httpErr(400, "Set your Etsy shop first (shop name or https://www.etsy.com/shop/<name>), or add listings by hand.");
  const limit = Math.max(1, Math.min(100, Math.floor(Number(o.limit) || 25)));
  const perListing = Math.max(1, Math.min(10, Math.floor(Number(o.imagesPerListing) || 4)));
  const progress = o.onProgress ?? (() => {});
  const warnings: string[] = [];
  const key = etsyKey();
  const source = o.source ?? "auto";

  let info: RawShop | undefined;
  let raws: RawListing[] = [];
  let reviews: RawReview[] = [];
  let used: "api" | "rss" = "rss";
  if (key && source !== "rss") {
    try {
      const api = new EtsyApi({ apiKey: key });
      progress("Finding your shop", 0.05);
      info = await api.findShop(shop);
      progress(`Reading active listings of ${info.name}`, 0.12);
      const ids = await api.activeListingIds(info.shopId!, limit);
      raws = await api.listingsWithImages(ids);
      progress("Reading reviews", 0.22);
      try {
        reviews = await api.reviews(info.shopId!, 100);
      } catch (e: any) {
        warnings.push(`Reviews not loaded: ${e?.message ?? e}`);
      }
      used = "api";
    } catch (e: any) {
      if (source === "api" || (e instanceof EtsyError && e.status === 404)) throw e;
      warnings.push(`Etsy API failed (${e?.message ?? e}); used the shop's RSS feed instead (10 newest listings, no tags or reviews).`);
    }
  } else if (source === "api") throw httpErr(400, "No Etsy API key set (Settings → Etsy).");
  if (used === "rss") {
    progress("Reading the shop's RSS feed", 0.1);
    const r = await fetchShopRss(shop);
    info = r.shop;
    raws = r.listings.slice(0, limit);
    if (!key) warnings.push("No Etsy API key: imported the 10 newest listings from the shop RSS feed (first photo only, no tags, favorites or reviews). Add a key in Settings → Etsy for the full shop.");
  }

  // ---- listings + photos
  const now = nowIso();
  let imported = 0;
  let updated = 0;
  let images = 0;
  const out: EtsyListing[] = [];
  for (let i = 0; i < raws.length; i++) {
    const r = raws[i];
    progress(`Saving “${shortTopic(r.title, 6)}” (${i + 1}/${raws.length})`, 0.25 + (0.65 * i) / Math.max(1, raws.length));
    const prev = getListing(brandId, r.listingId);
    const listingReviews = pickReviews(reviews.filter((x) => x.listingId === r.listingId), 5);
    const dl = await ensureImages(brandId, r.listingId, r.imageUrls.slice(0, perListing), prev);
    images += dl.downloaded;
    const l: EtsyListing = {
      id: prev?.id ?? nanoid(12),
      brandId,
      listingId: r.listingId,
      title: r.title,
      description: r.description,
      price: r.price,
      currency: r.currency ?? info?.currency,
      url: r.url,
      tags: r.tags.length ? r.tags : prev?.tags ?? [],
      materials: r.materials.length ? r.materials : prev?.materials ?? [],
      imageUrls: r.imageUrls.slice(0, perListing),
      imageAssetIds: dl.assetIds,
      imageSources: dl.sources,
      favorers: r.favorers ?? prev?.favorers,
      views: r.views ?? prev?.views,
      listedAt: r.createdAt ?? prev?.listedAt,
      reviews: listingReviews.length ? listingReviews : prev?.reviews ?? [],
      source: used,
      postIds: prev?.postIds ?? [],
      importedAt: prev?.importedAt ?? now,
      updatedAt: now,
    };
    if (dl.failed) warnings.push(`${dl.failed} photo(s) of “${shortTopic(r.title, 6)}” could not be downloaded`);
    prev ? updated++ : imported++;
    out.push(saveListing(l));
  }

  const summary: EtsyImportSummary = { at: now, source: used, imported, updated, images, reviews: reviews.length, warnings };
  const shopInfo: EtsyShopInfo = {
    name: info?.name ?? shop,
    shopId: info?.shopId,
    title: info?.title,
    url: info?.url ?? `https://www.etsy.com/shop/${shop}`,
    currency: info?.currency,
    reviewAverage: info?.reviewAverage,
    reviewCount: info?.reviewCount,
    listingCount: info?.listingCount,
  };
  progress("Updating your Brand Brain", 0.94);
  feedBrain(brandId, { shop: shopInfo, shopReviews: reviews, lastImport: summary });
  progress("Done", 1);
  return { summary, listings: out.sort(byNewest) };
}

/** Start an import in the background (one per brand). Poll GET /api/brands/:id/etsy for `job`. */
export function startImport(brandId: string, o: ImportOptions = {}): EtsyImportJob {
  const cur = jobs.get(brandId);
  if (cur?.running) return cur;
  const job: EtsyImportJob = { running: true, step: "Starting", progress: 0, startedAt: nowIso() };
  jobs.set(brandId, job);
  importShop(brandId, { ...o, onProgress: (step, p) => Object.assign(job, { step, progress: p }) })
    .then((r) => Object.assign(job, { running: false, step: "Done", progress: 1, summary: r.summary }))
    .catch((e) => Object.assign(job, { running: false, step: "Failed", error: String(e?.message ?? e) }));
  return job;
}

function pickReviews(list: RawReview[], n: number): EtsyReview[] {
  return [...list]
    .filter((r) => r.rating >= 4 && r.text.length >= 12)
    .sort((a, b) => b.rating - a.rating || Math.abs(a.text.length - 110) - Math.abs(b.text.length - 110))
    .slice(0, n)
    .map((r) => ({ rating: r.rating, text: r.text.slice(0, 400), createdAt: r.createdAt, listingId: r.listingId }));
}

/** Download listing photos into the brand's assets, reusing copies from earlier imports. */
async function ensureImages(brandId: string, listingId: string, urls: string[], prev?: EtsyListing) {
  const sources: Record<string, string> = {};
  const assetIds: string[] = [];
  let downloaded = 0;
  let failed = 0;
  const dir = path.join(UPLOADS_DIR, brandId);
  fs.mkdirSync(dir, { recursive: true });
  const results = await pool(urls, 3, async (url, k) => {
    const old = prev?.imageSources?.[url];
    const a = old ? db.getAsset(old) : undefined;
    if (a && fs.existsSync(a.path)) return a.id;
    try {
      const img = await downloadImage(url);
      const abs = path.join(dir, `etsy-${listingId}-${k + 1}-${nanoid(6)}${img.ext}`);
      fs.writeFileSync(abs, img.bytes);
      const asset: Asset = {
        id: nanoid(12),
        brandId,
        kind: "image",
        url: fileUrlFor(abs),
        path: abs,
        originalName: `etsy-${listingId}-${k + 1}${img.ext}`,
        mime: img.mime,
        size: img.bytes.length,
        createdAt: nowIso(),
        source: "etsy",
        etsyListingId: listingId,
      };
      db.saveAsset(asset);
      downloaded++;
      return asset.id;
    } catch (e: any) {
      console.warn(`[etsy] image ${url} failed:`, e?.message ?? e);
      failed++;
      return undefined;
    }
  });
  urls.forEach((u, i) => {
    const id = results[i];
    if (id) {
      sources[u] = id;
      assetIds.push(id);
    }
  });
  return { sources, assetIds, downloaded, failed };
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

// ================================================================ manual listings (keyless)
export async function addManualListing(brandId: string, body: any): Promise<EtsyListing> {
  const b = db.getBrand(brandId);
  if (!b) throw httpErr(404, "Brand not found");
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const listingId = (body?.listingId ? String(body.listingId) : undefined) ?? listingIdFromUrl(url);
  if (!listingId || !/^\d+$/.test(listingId)) throw httpErr(400, "url must be an Etsy listing URL like https://www.etsy.com/listing/1234567890/…");
  const prev = getListing(brandId, listingId);
  const assetIds: string[] = [];
  for (const id of Array.isArray(body?.assetIds) ? body.assetIds : []) {
    const a = db.getAsset(String(id));
    if (!a || a.brandId !== brandId || a.kind !== "image") throw httpErr(400, `Image asset not found for this brand: ${id}`);
    assetIds.push(a.id);
  }
  const imageUrls = (Array.isArray(body?.imageUrls) ? body.imageUrls : []).map(String).filter(isEtsyImageUrl).map(largestImageUrl).slice(0, 10);
  const dl = imageUrls.length ? await ensureImages(brandId, listingId, imageUrls, prev) : { sources: {}, assetIds: [] as string[] };
  const title = String(body?.title ?? prev?.title ?? "").trim();
  if (!title) throw httpErr(400, "title is required (the listing name)");
  const price = body?.price !== undefined && body?.price !== "" ? Number(String(body.price).replace(/[^\d.]/g, "")) : prev?.price;
  const now = nowIso();
  const l: EtsyListing = {
    id: prev?.id ?? nanoid(12),
    brandId,
    listingId,
    title,
    description: String(body?.description ?? prev?.description ?? "").trim(),
    price: Number.isFinite(price) ? price : undefined,
    currency: String(body?.currency ?? prev?.currency ?? "USD").toUpperCase().slice(0, 3),
    url: cleanListingUrl(url || prev?.url || `https://www.etsy.com/listing/${listingId}`),
    tags: Array.isArray(body?.tags) ? body.tags.map(String).filter(Boolean) : typeof body?.tags === "string" ? body.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : prev?.tags ?? [],
    materials: Array.isArray(body?.materials) ? body.materials.map(String) : prev?.materials ?? [],
    imageUrls: imageUrls.length ? imageUrls : prev?.imageUrls ?? [],
    imageAssetIds: [...new Set([...assetIds, ...dl.assetIds, ...(assetIds.length || dl.assetIds.length ? [] : prev?.imageAssetIds ?? [])])],
    imageSources: { ...(prev?.imageSources ?? {}), ...dl.sources },
    favorers: prev?.favorers,
    views: prev?.views,
    listedAt: prev?.listedAt ?? now,
    reviews: Array.isArray(body?.reviews)
      ? body.reviews.map((r: any) => ({ rating: Number(r?.rating) || 5, text: String(r?.text ?? r).slice(0, 400) })).filter((r: EtsyReview) => r.text)
      : prev?.reviews ?? [],
    source: prev?.source && prev.source !== "manual" ? prev.source : "manual",
    postIds: prev?.postIds ?? [],
    importedAt: prev?.importedAt ?? now,
    updatedAt: now,
  };
  saveListing(l);
  feedBrain(brandId, {});
  return l;
}

// ================================================================ brand brain
const PLACEHOLDER_PRODUCTS = new Set(["handmade products", "custom orders", "gift sets", "digital downloads", "courses"]);
const lc = (s: string) => s.toLowerCase().trim();

/** Clean product name from a keyword-stuffed Etsy title: "Beaded Bracelet | Boho Gift, Seed Bead…" → "Beaded Bracelet". */
export function productName(title: string, maxWords = 6): string {
  const first = title.split(/\s[|•·–—-]\s|[|•·,(]/)[0].replace(/\s+/g, " ").trim();
  return shortTopic(first || title, maxWords) || title.slice(0, 40);
}

export function formatPrice(price?: number, currency?: string): string | undefined {
  if (price === undefined || !Number.isFinite(price)) return undefined;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", minimumFractionDigits: price % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(price);
  } catch {
    return `${price.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

/** Merge shop facts into the brand brain (keeps user edits; only appends) and store them on brand.etsy. */
export function feedBrain(brandId: string, x: { shop?: EtsyShopInfo; shopReviews?: RawReview[]; lastImport?: EtsyImportSummary }): Brand | undefined {
  const b0 = db.getBrand(brandId);
  if (!b0) return undefined;
  ensureBrain(b0);
  const listings = listListings(brandId).sort(byTop);
  if (!listings.length && !x.shop) return b0;
  return db.updateBrand(brandId, (b) => {
    const brain: BrandBrain = b.brain ?? ensureBrain(b);
    // products: listing names (most favorited first) after the user's own entries
    const names = [...new Set(listings.map((l) => productName(l.title)).filter(Boolean))];
    const own = brain.products.filter((p) => !PLACEHOLDER_PRODUCTS.has(lc(p)));
    brain.products = [...own, ...names.filter((n) => !own.some((p) => lc(p) === lc(n)))].slice(0, 20);
    // keywords from the most used listing tags
    const counts = new Map<string, number>();
    for (const l of listings) for (const t of l.tags) {
      const k = normTag(t);
      if (k.length >= 4 && k.length <= 24) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const tagKeywords = [...counts.entries()].sort((a, c) => c[1] - a[1]).slice(0, 12).map(([k]) => k);
    brain.keywords = [...brain.keywords, ...tagKeywords.filter((k) => !brain.keywords.some((e) => normTag(e) === k))].slice(0, 20);
    // CTAs
    if (!brain.ctas.some((c) => /etsy/i.test(c))) brain.ctas = [...brain.ctas, "Shop on Etsy — link in bio"];
    if (!brain.ctas.some((c) => /comment\s+["']?[A-Z0-9]{3,12}/i.test(c))) brain.ctas = [...brain.ctas, "Comment LINK and I'll DM you the link"];
    // social proof
    const shop = x.shop ?? b.etsy?.shop;
    if (shop?.reviewAverage && (shop.reviewCount ?? 0) >= 3) {
      const line = `Rated ${shop.reviewAverage.toFixed(1)}★ by ${shop.reviewCount} Etsy buyers`;
      brain.differentiators = [...brain.differentiators.filter((d) => !/^Rated .*Etsy buyers$/.test(d)), line].slice(0, 20);
    }
    if (!brain.summary.trim() && shop?.title) brain.summary = `${b.name}: ${shop.title}`;
    b.brain = brain;
    if (b.analysisStatus === "idle") b.analysisStatus = "done";

    const prices = listings.map((l) => l.price).filter((p): p is number => typeof p === "number" && p > 0);
    const reviewTexts = [
      ...pickReviews(x.shopReviews ?? [], 6).map((r) => r.text),
      ...listings.flatMap((l) => l.reviews.map((r) => r.text)),
      ...(b.etsy?.topReviews ?? []),
    ];
    const facts: EtsyBrandFacts = {
      shop: shop ?? { name: shopFor(b) ?? "", url: shopFor(b) ? `https://www.etsy.com/shop/${shopFor(b)}` : "" },
      priceMin: prices.length ? Math.min(...prices) : undefined,
      priceMax: prices.length ? Math.max(...prices) : undefined,
      currency: listings.find((l) => l.currency)?.currency ?? shop?.currency,
      topReviews: [...new Set(reviewTexts)].slice(0, 6),
      tagKeywords,
      listingCount: listings.length,
      updatedAt: nowIso(),
      lastImport: x.lastImport ?? b.etsy?.lastImport,
    };
    b.etsy = facts;
  });
}

// ================================================================ content
export interface ListingCopy {
  hook: string;
  benefits: string[];       // 2–4 short on-screen lines
  voice: { hook: string; benefits: string[]; review?: string; price: string; cta: string };
  review?: { text: string; rating: number; shopLevel: boolean };
  captionBody: string;
  hashtags: string[];
}

const DIGITAL = /\b(printable|digital|download|pdf|svg|template|instant|editable|canva)\b/i;
const hashN = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Short benefit lines from Etsy-style bullet points, materials and tags. */
export function extractBenefits(l: EtsyListing, max = 4): string[] {
  const lines = l.description
    .split(/\n|(?<=[.!])\s+/)
    .map((s) => s.replace(/^[\s•*\-–—✓✔➤►▶️♡❤]+/u, "").replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 12 && s.length <= 70 && !/https?:|copyright|all rights|contact|message me|questions|refund|return|shipping|turnaround|business days|policy|ref=/i.test(s))
    .filter((s) => !/^[A-Z ∙·]{6,}$/.test(s)); // spaced-out headings like "H O W ∙ T O"
  const bullets = lines.filter((s) => /[:]|\b(made|hand|bead|gold|silver|sterling|crystal|stone|gift|adjust|size|length|waterproof|tarnish|print|instant|edit|includes?|pages?|letter|a4)\b/i.test(s));
  const out = [...new Set([...bullets, ...lines])].slice(0, max).map((s) => s.replace(/[.;,]$/, ""));
  if (out.length < max && l.materials.length) out.push(`Made with ${l.materials.slice(0, 3).join(", ").toLowerCase()}`);
  if (out.length < 2) for (const t of l.tags.slice(0, 3)) if (out.length < max) out.push(t.charAt(0).toUpperCase() + t.slice(1));
  return [...new Set(out.map(sentenceCase))].slice(0, max);
}

/** "TYPE THE NAME ONCE" → "Type the name once" (shouty Etsy bullets). */
export function sentenceCase(s: string): string {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 6 || letters.replace(/[^A-Z]/g, "").length / letters.length < 0.7) return s;
  const low = s.toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1);
}

function bestReview(b: Brand, l: EtsyListing): ListingCopy["review"] {
  const own = l.reviews.find((r) => r.rating >= 4);
  if (own) return { text: own.text, rating: own.rating, shopLevel: false };
  const shopText = b.etsy?.topReviews?.[0];
  return shopText ? { text: shopText, rating: 5, shopLevel: true } : undefined;
}
const shortQuote = (t: string, max = 90) => {
  const first = t.split(/(?<=[.!?])\s/)[0];
  const s = first.length <= max ? first : t.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return s.replace(/^["“]|["”]$/g, "");
};

export function heuristicCopy(b: Brand, brain: BrandBrain, l: EtsyListing, keyword: string): ListingCopy {
  const topic = smartLower(productName(l.title, 4));
  const digital = DIGITAL.test(`${l.title} ${l.tags.join(" ")}`);
  const hooks = digital
    ? [`Your new favorite ${topic}`, `The ${topic} everyone is downloading`, `Print this ${topic} in minutes`]
    : [`The ${topic} everyone asks about`, `Handmade ${topic}, made to be noticed`, `POV: you found the perfect ${topic}`];
  const hook = hooks[hashN(l.listingId) % hooks.length];
  const benefits = extractBenefits(l, 3);
  while (benefits.length < 2) benefits.push(digital ? "Instant download — no shipping" : brain.differentiators[benefits.length] ?? "Made with care");
  const price = formatPrice(l.price, l.currency);
  const review = bestReview(b, l);
  const priceLine = price ? `${price} on Etsy` : "Available now on Etsy";
  return {
    hook,
    benefits,
    review,
    voice: {
      hook: hook.replace(/^POV: /, "Picture this: ") + ".",
      // terse bullet points ("Glass seed beads") get a spoken lead-in
      benefits: benefits.map((x, i) => (x.split(/\s+/).length <= 5 ? ["Look closer: ", "Plus: ", "And: "][i % 3] + smartLower(x) : x) + "."),
      review: review ? `${review.shopLevel ? "Buyers say" : "One buyer said"}: ${shortQuote(review.text, 120)}` : undefined,
      price: price ? `It's just ${price}, on Etsy.` : "It's waiting for you on Etsy.",
      cta: `Comment ${keyword} and I'll send you the link.`,
    },
    captionBody: [benefits.slice(0, 2).map((x) => `✨ ${x}`).join("\n"), priceLine, review ? `“${shortQuote(review.text, 120)}” ★★★★★` : ""].filter(Boolean).join("\n\n"),
    hashtags: listingHashtags(brain, l),
  };
}

/** Listing tags first (they are Etsy SEO keywords), then brand hashtags. Max 5. */
export function listingHashtags(brain: BrandBrain, l: EtsyListing): string[] {
  const tagTags = l.tags.map((t) => normTag(t)).filter((t) => t.length >= 5 && t.length <= 24).sort((a, c) => a.length - c.length).slice(0, 3);
  return capHashtags([...tagTags, ...heuristicHashtags(brain, `${productName(l.title)} ${l.tags.slice(0, 5).join(" ")}`)]);
}

const COPY_SYSTEM = `You write Instagram content for a small Etsy shop's product. Use ONLY facts from the listing, reviews and brand; never invent materials, sizes, discounts, shipping promises or claims.
Return JSON: {"hook": string (<= 8 words, scroll-stopping, contains the product keyword),
 "benefits": string[] (3 short on-screen lines, <= 7 words each, concrete benefits from the listing),
 "voice": {"hook": string, "benefits": string[3], "review"?: string, "price": string, "cta": string} (one natural spoken sentence each; cta asks people to comment the given keyword to get the link),
 "reviewIndex"?: number (index of the best review to quote, or omit),
 "captionBody": string (2-4 short lines: benefits, price, a short review quote if any; no hashtags, no CTA),
 "hashtags": string[] (3-5, no #, specific niche keywords, prefer the listing's tags)}`;

async function llmCopy(b: Brand, brain: BrandBrain, l: EtsyListing, keyword: string, fb: ListingCopy): Promise<ListingCopy> {
  const reviews = [...l.reviews.map((r) => r.text), ...(b.etsy?.topReviews ?? [])].slice(0, 6);
  const input = {
    brand: { name: b.name, voice: brain.voice, audience: brain.audience, claimsToAvoid: brain.claimsToAvoid },
    listing: { title: l.title, description: l.description.slice(0, 2500), price: formatPrice(l.price, l.currency), tags: l.tags, materials: l.materials },
    reviews,
    keyword,
  };
  const r = await askJson<any>(COPY_SYSTEM, JSON.stringify(input), 2000);
  const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, n) : []);
  const benefits = arr(r?.benefits, 4);
  const ri = Number(r?.reviewIndex);
  const review = Number.isInteger(ri) && reviews[ri] ? { text: reviews[ri], rating: 5, shopLevel: ri >= l.reviews.length } : fb.review;
  return {
    hook: String(r?.hook ?? "").trim() || fb.hook,
    benefits: benefits.length >= 2 ? benefits : fb.benefits,
    review,
    voice: {
      hook: String(r?.voice?.hook ?? "").trim() || fb.voice.hook,
      benefits: arr(r?.voice?.benefits, 4).length >= 2 ? arr(r?.voice?.benefits, 4) : fb.voice.benefits,
      review: review ? String(r?.voice?.review ?? "").trim() || fb.voice.review : undefined,
      price: String(r?.voice?.price ?? "").trim() || fb.voice.price,
      cta: String(r?.voice?.cta ?? "").trim() || fb.voice.cta,
    },
    captionBody: String(r?.captionBody ?? "").trim() || fb.captionBody,
    hashtags: capHashtags(arr(r?.hashtags, 8)).length >= 3 ? capHashtags(arr(r?.hashtags, 8)) : fb.hashtags,
  };
}

export async function listingCopy(b: Brand, l: EtsyListing, keyword: string): Promise<ListingCopy> {
  const brain = ensureBrain(b);
  const fb = heuristicCopy(b, brain, l, keyword);
  if (!llmAvailable()) return fb;
  try {
    return await llmCopy(b, brain, l, keyword, fb);
  } catch (e: any) {
    console.warn("[etsy] LLM copy failed, using heuristic:", e?.message ?? e);
    return fb;
  }
}

/** The listing's photos as scene media (falls back to other brand photos). */
function listingMedia(l: EtsyListing): MediaRef[] {
  const own = l.imageAssetIds.map((id) => db.getAsset(id)).filter((a): a is Asset => !!a && a.kind === "image" && fs.existsSync(a.path));
  if (own.length) return own.map((a) => ({ src: a.url, kind: "image" as const }));
  return db
    .listAssets(l.brandId)
    .filter((a) => a.kind === "image" && !/logo/i.test(a.originalName))
    .slice(0, 4)
    .map((a) => ({ src: a.url, kind: "image" as const }));
}

export const PRODUCT_STYLES = ["product-drop", "paper", "magazine"]; // product / handmade looks (renderer style ids)
const pickStyle = (avail: { id: string; supports: string[] }[], kind: "reel" | "carousel" | "story", want: string | undefined, seed: number): string => {
  const ok = avail.filter((s) => s.supports.includes(kind));
  if (want && ok.some((s) => s.id === want)) return want;
  const prefs = PRODUCT_STYLES.filter((id) => ok.some((s) => s.id === id));
  return prefs.length ? prefs[seed % prefs.length] : ok[seed % Math.max(1, ok.length)]?.id ?? "minimal";
};

export interface CreateOptions {
  types?: PostType[];        // default ["reel"]
  render?: boolean;          // default true
  style?: string;            // Remotion style id, or "product-showcase" (HyperFrames template)
  automation?: boolean;      // create a comment → DM automation per reel/carousel (default false)
  keyword?: string;          // comment keyword (default "LINK")
  slots?: string[];          // pre-computed schedule slots (plan); else next best times
}

export function utmLink(url: string, postId: string): string {
  const u = new URL(cleanListingUrl(url));
  u.searchParams.set("utm_source", "instagram");
  u.searchParams.set("utm_medium", "social");
  u.searchParams.set("utm_campaign", postId);
  return u.toString();
}

/** Build reel / carousel / story posts for one listing. */
export async function createListingPosts(brandId: string, listingId: string, o: CreateOptions = {}): Promise<{ posts: Post[]; automations: Automation[]; listing: EtsyListing }> {
  const b = db.getBrand(brandId);
  if (!b) throw httpErr(404, "Brand not found");
  const l = resolveListing(brandId, listingId);
  const brain = ensureBrain(b);
  const types = [...new Set((o.types?.length ? o.types : ["reel"]).filter((t): t is PostType => ["reel", "carousel", "story"].includes(t)))];
  if (!types.length) throw httpErr(400, "types must contain reel, carousel and/or story");
  const keyword = (o.keyword || "LINK").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12) || "LINK";
  const copy = await listingCopy(b, l, keyword);
  const media = listingMedia(l);
  const m = (i: number) => (media.length ? media[i % media.length] : undefined);
  const { styles, captionStyles, htmlTemplates } = await getStyles();
  const seed = hashN(l.listingId) + (l.postIds?.length ?? 0);
  const ref = brandStyleRef(b);
  const price = formatPrice(l.price, l.currency);
  const name = productName(l.title);
  const slots = o.slots?.length ? [...o.slots] : nextSlots(brain.bestTimes, types.length, new Date(), takenSlots(brandId));
  const caption = (cta: string) => keywordFirstCaption({ hook: copy.hook, keyword: smartLower(name), body: copy.captionBody, cta });
  const commentCta = `Comment ${keyword} and I'll DM you the link 💌 (or tap the link in bio)`;
  const reviewLine = copy.review ? shortQuote(copy.review.text, 80) : undefined;

  const posts: Post[] = [];
  for (const type of types) {
    let spec: AnySpec;
    let cta = commentCta;
    if (type === "carousel") {
      const slides: CarouselSpec["slides"] = [
        { headline: copy.hook, body: "Swipe →", media: m(0) },
        { headline: copy.benefits[0], body: short(copy.benefits[2], 90), media: m(1) },
        { headline: copy.benefits[1] ?? name, body: l.materials.length ? `Made with ${l.materials.slice(0, 3).join(", ").toLowerCase()}` : undefined, media: m(2) },
        { headline: price ?? "On Etsy now", body: `${name} — available on Etsy`, media: m(3) },
        ...(reviewLine ? [{ headline: `“${reviewLine}”`, body: "★★★★★ Etsy buyer", media: m(4) }] : []),
        { headline: "Want the link?", body: `Comment ${keyword} and I'll DM it to you`, media: m(0) },
      ].map((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as unknown as CarouselSpec["slides"][number]);
      spec = { width: 1080, height: 1350, style: pickStyle(styles, "carousel", o.style, seed), brand: ref, slides };
    } else {
      const scenes: Scene[] =
        type === "story"
          ? [
              sc(1, 2.5, copy.hook, undefined, copy.voice.hook, m(0)),
              sc(2, 3, price ? `Only ${price}` : name, price ? name : "Available on Etsy", copy.voice.price, m(1)),
              sc(3, 3, "Shop it now", "Link in bio", "Find it at the link in my bio.", m(2)),
            ]
          : [
              sc(1, 2.5, copy.hook, undefined, copy.voice.hook, m(0)),
              sc(2, 3.2, copy.benefits[0], short(copy.benefits[2]), copy.voice.benefits[0], m(1)),
              sc(3, 3.2, copy.benefits[1] ?? name, undefined, copy.voice.benefits[1] ?? `Meet the ${smartLower(name)}.`, m(2)),
              ...(reviewLine ? [sc(4, 3.8, `“${reviewLine}”`, "★★★★★ Etsy review", copy.voice.review ?? reviewLine, m(3))] : []),
              sc(reviewLine ? 5 : 4, 3, price ? `Only ${price}` : name, price ? "on Etsy" : "Available on Etsy", copy.voice.price, m(reviewLine ? 4 : 3)),
            ];
      const endCard = type === "story" ? { text: "Link in bio" } : { text: `Comment ${keyword} for the link`, keyword };
      if (type === "story") cta = "Shop it at the link in bio 🛍️";
      const useHtml = o.style === "product-showcase" && htmlTemplates.some((t) => t.id === "product-showcase");
      const h = useHtml ? await tryLoad(loadHyperframes) : undefined;
      if (h) spec = h.buildFromTemplate("product-showcase", { brand: ref, scenes, cta: endCard });
      else
        spec = {
          width: 1080,
          height: 1920,
          fps: 30,
          style: pickStyle(styles, type === "story" ? "story" : "reel", o.style, seed),
          captionStyle: captionStyles.find((c) => c.id === "white-pill")?.id ?? captionStyles[0]?.id,
          brand: ref,
          scenes,
          cta: endCard,
        } satisfies ReelSpec;
    }
    const p = newPost({
      brandId,
      type,
      title: `${name} — ${type}`,
      hook: copy.hook,
      caption: caption(cta),
      hashtags: copy.hashtags,
      spec,
      scheduledAt: slots.shift(),
    });
    posts.push(
      db.updatePost(p.id, (x) => {
        x.etsyListingId = l.listingId;
        x.etsyLink = utmLink(l.url, p.id);
      })!,
    );
  }

  const automations: Automation[] = [];
  if (o.automation) {
    for (const p of posts.filter((x) => x.type !== "story")) {
      const exists = db.listAutomations(brandId).find((a) => a.postId === p.id && a.keyword.toUpperCase() === keyword);
      if (exists) continue;
      automations.push(
        db.saveAutomation({
          id: nanoid(12),
          brandId,
          keyword,
          replyText: "Sent you a DM with the link 💌",
          dmText: `Hi {username}! Here's the link to the ${smartLower(name)}:`,
          link: p.etsyLink,
          enabled: true,
          postId: p.id,
          createdAt: nowIso(),
        }),
      );
    }
  }
  const listing = saveListing({ ...l, postIds: [...new Set([...(l.postIds ?? []), ...posts.map((p) => p.id)])], updatedAt: nowIso() });
  const final = o.render === false ? posts : posts.map((p) => enqueueRender(p.id) ?? p);
  return { posts: final, automations, listing };
}

const short = (s: string | undefined, max = 48) => (s && s.length <= max ? s : undefined);

function sc(n: number, durationSec: number, headline: string, subtext: string | undefined, voiceoverText: string | undefined, media?: MediaRef): Scene {
  return { id: `s${n}`, durationSec, headline, ...(subtext ? { subtext } : {}), ...(voiceoverText ? { voiceoverText } : {}), ...(media ? { media } : {}) };
}

/** listingId, or "newest" / "top" (most favorited). */
export function resolveListing(brandId: string, listingId: string): EtsyListing {
  const all = listListings(brandId);
  if (!all.length) throw httpErr(404, "No Etsy listings yet — import your shop or add a listing first.");
  const key = String(listingId).toLowerCase();
  const l = key === "newest" || key === "latest" ? [...all].sort(byNewest)[0] : key === "top" || key === "best" ? [...all].sort(byTop)[0] : all.find((x) => x.listingId === String(listingId) || x.id === listingId);
  if (!l) throw httpErr(404, `Etsy listing not found: ${listingId}`);
  return l;
}

/** "Plan from shop": best listings (most favorited, then newest; fresh ones first) → posts. */
export async function planFromShop(brandId: string, o: { count?: number; types?: PostType[]; render?: boolean; automation?: boolean; style?: string } = {}) {
  const b = db.getBrand(brandId);
  if (!b) throw httpErr(404, "Brand not found");
  const count = Math.max(1, Math.min(10, Math.floor(Number(o.count) || 3)));
  const all = listListings(brandId);
  if (!all.length) throw httpErr(404, "No Etsy listings yet — import your shop or add a listing first.");
  const ranked = [...all].sort((a, c) => (a.postIds.length ? 1 : 0) - (c.postIds.length ? 1 : 0) || byTop(a, c));
  const chosen = ranked.slice(0, count);
  const types = o.types?.length ? o.types : (["reel"] as PostType[]);
  const slots = nextSlots(ensureBrain(b).bestTimes, chosen.length * types.length, new Date(), takenSlots(brandId));
  const posts: Post[] = [];
  const automations: Automation[] = [];
  for (const l of chosen) {
    const r = await createListingPosts(brandId, l.listingId, { ...o, types, slots: slots.splice(0, types.length) });
    posts.push(...r.posts);
    automations.push(...r.automations);
  }
  return { posts, automations, listings: chosen.map((l) => l.listingId) };
}

/** Listings with a compact view of their posts (status for the UI), newest first. */
export function listingsView(brandId: string): EtsyListing[] {
  const posts = new Map(db.listPosts({ brandId }).map((p) => [p.id, p]));
  return listListings(brandId)
    .sort(byNewest)
    .map((l) => ({
      ...l,
      imageAssetUrls: l.imageAssetIds.map((id) => db.getAsset(id)?.url).filter((u): u is string => !!u),
      posts: l.postIds
        .map((id) => posts.get(id))
        .filter((p): p is Post => !!p)
        .map((p) => ({ id: p.id, type: p.type, status: p.status, title: p.title, thumbnailUrl: p.thumbnailUrl, renderProgress: p.renderProgress })),
    }));
}

// ================================================================ routes
const typesOf = (v: unknown): PostType[] | undefined =>
  Array.isArray(v) ? (v.map(String).filter((t) => ["reel", "carousel", "story"].includes(t)) as PostType[]) : typeof v === "string" ? typesOf(v.split(",")) : undefined;

export function registerEtsyRoutes(app: Express) {
  const brandId = (req: Request) => {
    const id = String(req.params.id);
    if (!db.getBrand(id)) throw httpErr(404, "Brand not found");
    return id;
  };

  // Settings: write-only key "keystring:shared_secret" ("" clears). Runs before the main PATCH /api/settings.
  app.patch("/api/settings", (req, _res, next) => {
    const b = req.body ?? {};
    let key: string | undefined = typeof b.etsyApiKey === "string" ? b.etsyApiKey.trim() : undefined;
    if (key !== undefined && key && !key.includes(":") && typeof b.etsySharedSecret === "string" && b.etsySharedSecret.trim()) key = `${key}:${b.etsySharedSecret.trim()}`;
    if (key && !/^[A-Za-z0-9]+:[A-Za-z0-9]+$/.test(key))
      throw httpErr(400, "Etsy API key must be keystring:shared_secret (both are on etsy.com/developers/your-apps). Etsy rejects the keystring alone.");
    if (key !== undefined) db.setSetting("etsyApiKey", key);
    next();
  });
  // Brand field etsyShop (shop name or URL) via the normal brand PATCH.
  app.patch("/api/brands/:id", (req, _res, next) => {
    const v = req.body?.etsyShop;
    if (v !== undefined && db.getBrand(String(req.params.id))) {
      const name = v === null || v === "" ? undefined : parseShopName(String(v));
      if (v && !name) throw httpErr(400, `Not an Etsy shop name or URL: ${v}`);
      db.updateBrand(String(req.params.id), (x) => void (x.etsyShop = name));
    }
    next();
  });
  // Brand deleted → drop its listings too.
  app.delete("/api/brands/:id", (req, _res, next) => {
    db.db.prepare("DELETE FROM etsy_listings WHERE brand_id = ?").run(String(req.params.id));
    next();
  });

  app.get("/api/brands/:id/etsy", (req, res) => res.json(etsyStatus(brandId(req))));
  app.put("/api/brands/:id/etsy", (req, res) => {
    const id = brandId(req);
    const v = req.body?.shop;
    const name = v ? parseShopName(String(v)) : undefined;
    if (v && !name) throw httpErr(400, `Not an Etsy shop name or URL: ${v}`);
    db.updateBrand(id, (x) => void (x.etsyShop = name));
    res.json(etsyStatus(id));
  });
  app.post("/api/brands/:id/etsy/import", async (req, res) => {
    const id = brandId(req);
    const b = req.body ?? {};
    const o: ImportOptions = { shop: typeof b.shop === "string" && b.shop.trim() ? b.shop : undefined, limit: b.limit, imagesPerListing: b.imagesPerListing, source: ["api", "rss"].includes(b.source) ? b.source : "auto" };
    if (b.wait === true || req.query.wait === "1") {
      const r = await importShop(id, o);
      return res.json({ ...r.summary, status: etsyStatus(id), listings: listingsView(id) });
    }
    if (o.shop) {
      const name = parseShopName(o.shop);
      if (!name) throw httpErr(400, `Not an Etsy shop name or URL: ${o.shop}`);
    }
    startImport(id, o);
    res.status(202).json(etsyStatus(id));
  });
  app.post("/api/brands/:id/etsy/brain", (req, res) => res.json(feedBrain(brandId(req), {})));
  app.get("/api/brands/:id/etsy/listings", (req, res) => res.json(listingsView(brandId(req))));
  app.post("/api/brands/:id/etsy/listings", async (req, res) => {
    const id = brandId(req);
    const l = await addManualListing(id, req.body);
    res.status(201).json(listingsView(id).find((x) => x.listingId === l.listingId));
  });
  app.delete("/api/brands/:id/etsy/listings/:listingId", (req, res) => {
    deleteListingRow(brandId(req), String(req.params.listingId));
    res.json({ ok: true });
  });
  app.post("/api/brands/:id/etsy/listings/:listingId/posts", async (req, res) => {
    const id = brandId(req);
    const b = req.body ?? {};
    const r = await createListingPosts(id, String(req.params.listingId), {
      types: typesOf(b.types),
      render: b.render !== false,
      style: typeof b.style === "string" ? b.style : undefined,
      automation: b.automation === true,
      keyword: typeof b.keyword === "string" ? b.keyword : undefined,
    });
    res.status(201).json(r);
  });
  app.post("/api/brands/:id/etsy/plan", async (req, res) => {
    const id = brandId(req);
    const b = req.body ?? {};
    res.status(201).json(await planFromShop(id, { count: b.count, types: typesOf(b.types), render: b.render !== false, automation: b.automation === true, style: typeof b.style === "string" ? b.style : undefined }));
  });
}
