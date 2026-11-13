// Etsy data sources (no DB access, so it is unit-testable with a stubbed fetch):
//  1. Etsy Open API v3 (https://openapi.etsy.com, docs https://developers.etsy.com/documentation)
//     Header `x-api-key: <keystring>:<shared_secret>` (keystring alone is rejected with 403
//     "Shared secret is required in x-api-key header."). Public shop/listing/review reads need no OAuth.
//     Seller apps start at 10 requests/second and 10,000/day (x-limit-per-second / x-limit-per-day headers).
//  2. Keyless fallback: the shop's public RSS feed https://www.etsy.com/shop/<name>/rss
//     (Etsy-provided feed: the ~10 newest listings, first photo, price, description; no tags/reviews).
// HTML scraping of etsy.com is NOT done (blocked by Etsy and against its terms).
import * as cheerio from "cheerio";

export const ETSY_API = "https://openapi.etsy.com/v3/application";
const IMAGE_HOST = /^https:\/\/i\.etsystatic\.com\//;

/** Normalized listing as it comes out of either source (before images are downloaded). */
export interface RawListing {
  listingId: string;
  title: string;
  description: string;
  price?: number;            // major units, e.g. 24.5
  currency?: string;         // ISO code, e.g. "USD"
  url: string;               // clean listing URL (no tracking params)
  tags: string[];
  materials: string[];
  imageUrls: string[];       // largest size available, rank order
  favorers?: number;
  views?: number;
  createdAt?: string;        // ISO (listing creation / RSS pubDate)
}
export interface RawReview {
  listingId?: string;
  rating: number;            // 1–5
  text: string;
  createdAt?: string;
}
export interface RawShop {
  shopId?: number;
  name: string;
  title?: string;
  url: string;
  currency?: string;
  reviewAverage?: number;
  reviewCount?: number;
  listingCount?: number;
  iconUrl?: string;
}

export class EtsyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- shop name parsing
/** Accepts a shop name, https://www.etsy.com/shop/<Name>, https://<name>.etsy.com, or etsy.com/uk/shop/<Name>?ref=… */
export function parseShopName(input: string | undefined): string | undefined {
  const s = String(input ?? "").trim();
  if (!s) return undefined;
  const m1 = s.match(/etsy\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?shop\/([A-Za-z0-9]+)/i);
  if (m1) return m1[1];
  const m2 = s.match(/^(?:https?:\/\/)?([A-Za-z0-9]+)\.etsy\.com\b/i);
  if (m2 && !/^(www|help|community|openapi|developers?)$/i.test(m2[1])) return m2[1];
  if (/^[A-Za-z0-9]{2,40}$/.test(s)) return s;
  return undefined;
}

/** https://www.etsy.com/listing/123/slug?ref=rss → https://www.etsy.com/listing/123/slug */
export function cleanListingUrl(u: string): string {
  try {
    const url = new URL(u);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return u.split(/[?#]/)[0];
  }
}
export const listingIdFromUrl = (u: string): string | undefined => u.match(/etsy\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?listing\/(\d+)/i)?.[1];

/** RSS gives 570xN images; the same path with il_fullxfull is the original (verified on i.etsystatic.com). */
export const largestImageUrl = (u: string) => u.replace(/\/il_(?:\d+x\d+|\d+xN|570xN|fullxfull)\./, "/il_fullxfull.");
export const isEtsyImageUrl = (u: string) => IMAGE_HOST.test(u);

// ---------------------------------------------------------------- API client
export interface ApiOptions {
  apiKey: string;              // "keystring:shared_secret"
  minIntervalMs?: number;      // spacing between calls (default 120 ms → < 10 QPS)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const unescapeHtml = (s: string) => cheerio.load(`<div>${s}</div>`)("div").text();

export class EtsyApi {
  private last = 0;
  constructor(private o: ApiOptions) {
    if (!o.apiKey?.trim()) throw new EtsyError(400, "No Etsy API key set (Settings → Etsy).");
  }

  async get<T = any>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(ETSY_API + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = this.last + (this.o.minIntervalMs ?? 120) - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      let res: Response;
      try {
        res = await fetch(url, { headers: { "x-api-key": this.o.apiKey.trim(), Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
      } catch (e: any) {
        throw new EtsyError(502, `Can't reach the Etsy API: ${e?.message ?? e}`);
      }
      if (res.status === 429 && attempt < 2) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Math.min(30, Number.isFinite(ra) && ra > 0 ? ra : 2) * 1000);
        continue;
      }
      const text = await res.text();
      let body: any;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }
      if (!res.ok) {
        const msg = String(body?.error ?? body?.error_description ?? res.statusText ?? "error");
        if (res.status === 401 || res.status === 403) {
          const hint = this.o.apiKey.includes(":") ? "" : " Paste the key as keystring:shared_secret (both values are on etsy.com/developers/your-apps).";
          throw new EtsyError(400, `Etsy rejected the API key (${res.status}: ${msg}).${hint}`);
        }
        if (res.status === 404) throw new EtsyError(404, `Etsy: not found (${msg})`);
        if (res.status === 429) throw new EtsyError(429, "Etsy rate limit reached (10 requests/second, 10,000/day for a new app). Try again later.");
        throw new EtsyError(502, `Etsy API error ${res.status}: ${msg}`);
      }
      return body as T;
    }
    throw new EtsyError(429, "Etsy rate limit reached. Try again later.");
  }

  /** GET /shops?shop_name= → exact (case-insensitive) match, else first result. */
  async findShop(name: string): Promise<RawShop> {
    const r = await this.get<{ count: number; results: any[] }>("/shops", { shop_name: name, limit: 25 });
    const list = r?.results ?? [];
    const s = list.find((x) => String(x.shop_name).toLowerCase() === name.toLowerCase()) ?? list[0];
    if (!s) throw new EtsyError(404, `No Etsy shop named "${name}" found.`);
    return {
      shopId: Number(s.shop_id),
      name: String(s.shop_name),
      title: s.title ?? undefined,
      url: cleanListingUrl(s.url ?? `https://www.etsy.com/shop/${s.shop_name}`),
      currency: s.currency_code ?? undefined,
      reviewAverage: typeof s.review_average === "number" ? s.review_average : undefined,
      reviewCount: typeof s.review_count === "number" ? s.review_count : undefined,
      listingCount: typeof s.listing_active_count === "number" ? s.listing_active_count : undefined,
      iconUrl: s.icon_url_fullxfull ?? undefined,
    };
  }

  /** GET /shops/{id}/listings/active (paged, ≤100 per page) → listing ids in Etsy's order (newest first). */
  async activeListingIds(shopId: number, max = 100): Promise<string[]> {
    const ids: string[] = [];
    for (let offset = 0; ids.length < max; offset += 100) {
      const r = await this.get<{ count: number; results: any[] }>(`/shops/${shopId}/listings/active`, { limit: Math.min(100, max - ids.length), offset });
      const rows = r?.results ?? [];
      ids.push(...rows.map((x) => String(x.listing_id)));
      if (rows.length < 100 || ids.length >= (r?.count ?? 0)) break;
    }
    return ids.slice(0, max);
  }

  /** GET /listings/batch?listing_ids=…&includes=Images (≤100 ids per call). Images + views need this endpoint. */
  async listingsWithImages(ids: string[]): Promise<RawListing[]> {
    const out: RawListing[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const r = await this.get<{ results: any[] }>("/listings/batch", { listing_ids: chunk.join(","), includes: "Images" });
      const byId = new Map((r?.results ?? []).map((x) => [String(x.listing_id), x]));
      for (const id of chunk) {
        const x = byId.get(id);
        if (x) out.push(apiListing(x));
      }
    }
    return out;
  }

  /** GET /shops/{id}/reviews (newest first). */
  async reviews(shopId: number, max = 100): Promise<RawReview[]> {
    const r = await this.get<{ results: any[] }>(`/shops/${shopId}/reviews`, { limit: Math.min(100, max) });
    return (r?.results ?? [])
      .map((x) => ({
        listingId: x.listing_id ? String(x.listing_id) : undefined,
        rating: Number(x.rating) || 0,
        text: unescapeHtml(String(x.review ?? "")).trim(),
        createdAt: x.created_timestamp ? new Date(Number(x.created_timestamp) * 1000).toISOString() : undefined,
      }))
      .filter((x) => x.text);
  }
}

export function apiListing(x: any): RawListing {
  const price = x.price && typeof x.price.amount === "number" && x.price.divisor ? x.price.amount / x.price.divisor : undefined;
  const images = (Array.isArray(x.images) ? [...x.images] : [])
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .map((im) => im.url_fullxfull || im.url_570xN)
    .filter((u: unknown): u is string => typeof u === "string" && isEtsyImageUrl(u));
  return {
    listingId: String(x.listing_id),
    title: unescapeHtml(String(x.title ?? "")).trim(),
    description: unescapeHtml(String(x.description ?? "")).trim(),
    price,
    currency: x.price?.currency_code ?? undefined,
    url: cleanListingUrl(String(x.url ?? `https://www.etsy.com/listing/${x.listing_id}`)),
    tags: Array.isArray(x.tags) ? x.tags.map((t: unknown) => String(t)).filter(Boolean) : [],
    materials: Array.isArray(x.materials) ? x.materials.map((t: unknown) => String(t)).filter(Boolean) : [],
    imageUrls: [...new Set(images)],
    favorers: typeof x.num_favorers === "number" ? x.num_favorers : undefined,
    views: typeof x.views === "number" ? x.views : undefined,
    createdAt: x.created_timestamp ? new Date(Number(x.created_timestamp) * 1000).toISOString() : undefined,
  };
}

// ---------------------------------------------------------------- RSS (keyless)
export const rssUrl = (shop: string) => `https://www.etsy.com/shop/${encodeURIComponent(shop)}/rss`;

/** Parse the shop RSS feed (XML). Titles end with " by <ShopName>" which is stripped. */
export function parseShopRss(xml: string, shop: string): { shop: RawShop; listings: RawListing[] } {
  const $ = cheerio.load(xml, { xmlMode: true });
  const listings: RawListing[] = [];
  $("item").each((_i, el) => {
    const it = $(el);
    const link = it.find("link").first().text().trim();
    const id = listingIdFromUrl(link) ?? listingIdFromUrl(it.find("guid").text());
    if (!id) return;
    const html = it.find("description").first().text(); // entity-decoded HTML
    const d = cheerio.load(`<div>${html}</div>`);
    const img = d("img").first().attr("src");
    const priceText = d("p.price").first().text().trim(); // "33.00 USD"
    const pm = priceText.match(/([\d.,]+)\s*([A-Z]{3})/);
    d("p.description br").replaceWith("\n");
    const desc = (d("p.description").text() || d.root().text()).replace(/\n{3,}/g, "\n\n").trim();
    const title = it.find("title").first().text().replace(new RegExp(`\\s+by\\s+${shop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "").trim();
    const pub = Date.parse(it.find("pubDate").text());
    listings.push({
      listingId: id,
      title,
      description: desc,
      price: pm ? Number(pm[1].replace(/,/g, "")) : undefined,
      currency: pm?.[2],
      url: cleanListingUrl(link || `https://www.etsy.com/listing/${id}`),
      tags: [],
      materials: [],
      imageUrls: img && isEtsyImageUrl(img) ? [largestImageUrl(img)] : [],
      createdAt: isNaN(pub) ? undefined : new Date(pub).toISOString(),
    });
  });
  return { shop: { name: shop, title: $("channel > title").first().text().replace(/^Etsy Shop for\s+/i, "").trim() || shop, url: `https://www.etsy.com/shop/${shop}` }, listings };
}

export async function fetchShopRss(shop: string): Promise<{ shop: RawShop; listings: RawListing[] }> {
  let res: Response;
  try {
    res = await fetch(rssUrl(shop), { headers: { "User-Agent": "SocialMCPStudio/0.1 (RSS reader)", Accept: "application/rss+xml, text/xml" }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  } catch (e: any) {
    throw new EtsyError(502, `Can't reach Etsy's RSS feed: ${e?.message ?? e}`);
  }
  if (res.status >= 300 && res.status < 400) throw new EtsyError(404, `Etsy shop "${shop}" has no RSS feed (check the shop name, it is case-sensitive).`);
  if (!res.ok) throw new EtsyError(502, `Etsy RSS feed returned ${res.status}. Add an Etsy API key in Settings, or add listings manually.`);
  const xml = await res.text();
  if (!/<rss[\s>]/i.test(xml)) throw new EtsyError(502, "Etsy RSS feed returned something unexpected. Add an Etsy API key in Settings, or add listings manually.");
  return parseShopRss(xml, shop);
}

/** Download one Etsy CDN image (only i.etsystatic.com, ≤25 MB). */
export async function downloadImage(url: string): Promise<{ bytes: Buffer; ext: string; mime: string }> {
  if (!isEtsyImageUrl(url)) throw new EtsyError(400, `Not an Etsy image URL: ${url}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new EtsyError(502, `Image download failed (${res.status})`);
  const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  const ext = mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : mime === "image/gif" ? ".gif" : ".jpg";
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > 25 * 1024 * 1024) throw new EtsyError(400, "Image too large (max 25 MB)");
  if (!/^image\//.test(mime)) throw new EtsyError(400, `Not an image (${mime})`);
  return { bytes, ext, mime };
}
