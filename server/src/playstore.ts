// Google Play listing → brand. Reads the public Play Store page (no API key): app name, short + full description,
// icon, phone screenshots, category, rating (when shown) and last update; downloads the icon + screenshots into the
// brand's assets (source "playstore") and stores the facts on brand.playStore so Claude (MCP) / the planner can write
// posts from them. Routes: registerPlayStoreRoutes(app) (see CONTRACTS.md "Play Store").
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Express, Request } from "express";
import type { Asset, PlayStoreApp } from "../../shared/types.ts";
import * as db from "./db.ts";
import { UPLOADS_DIR, fileUrlFor, nowIso } from "./config.ts";

const httpErr = (status: number, msg: string) => Object.assign(new Error(msg), { status });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

export function packageIdFrom(input: string): string | undefined {
  const s = input.trim();
  const m = s.match(/[?&]id=([A-Za-z0-9_.]+)/);
  if (m) return m[1];
  return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(s) ? s : undefined;
}
const listingUrl = (pkg: string) => `https://play.google.com/store/apps/details?id=${pkg}`;

const decode = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .trim();

/** Parse the public listing page. */
export async function fetchPlayListing(pkg: string): Promise<Omit<PlayStoreApp, "iconAssetId" | "screenshotAssetIds" | "importedAt">> {
  const res = await fetch(`${listingUrl(pkg)}&hl=en&gl=US`, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) throw httpErr(404, `App ${pkg} not found on Google Play`);
  if (!res.ok) throw httpErr(502, `Google Play returned ${res.status}`);
  const html = await res.text();
  let ld: any = {};
  const ldm = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (ldm) {
    try {
      ld = JSON.parse(ldm[1]);
    } catch {
      /* ignore */
    }
  }
  const title = String(ld.name ?? html.match(/<meta property="og:title" content="([^"]*)"/)?.[1]?.replace(/ - Apps on Google Play$/, "") ?? pkg);
  const summary = decode(String(ld.description ?? ""));
  const di = html.indexOf('data-g-id="description"');
  let description = "";
  if (di >= 0) {
    const chunk = html.slice(html.indexOf(">", di) + 1, di + 20000);
    description = decode(chunk.split("</div>")[0]);
  }
  const updated = html.match(/Updated on<\/div><div[^>]*>([^<]+)</)?.[1];
  const wn = html.indexOf("What’s new") >= 0 ? html.indexOf("What’s new") : html.indexOf("What&#39;s new");
  const whatsNew = wn >= 0 ? decode(html.slice(wn, wn + 4000).match(/itemprop="description"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "").slice(0, 1500) || undefined : undefined;
  const iconBase = String(ld.image ?? html.match(/<meta property="og:image" content="([^"]*)"/)?.[1] ?? "").split("=")[0];
  // Phone screenshots: the gallery uses "=w526-h296-rw" thumbnails; the same ids at "=s0" are the originals.
  const shots = [...new Set([...html.matchAll(/https:\/\/play-lh\.googleusercontent\.com\/([A-Za-z0-9_-]+)=w526-h296-rw/g)].map((m) => m[1]))];
  const rating = Number(ld.aggregateRating?.ratingValue);
  const ratingCount = Number(ld.aggregateRating?.ratingCount);
  return {
    packageId: pkg,
    url: listingUrl(pkg),
    title,
    summary,
    description,
    category: ld.applicationCategory ? String(ld.applicationCategory).replace(/_/g, " ").toLowerCase() : undefined,
    developer: ld.author?.name ? String(ld.author.name) : undefined,
    developerUrl: ld.author?.url ? String(ld.author.url) : undefined,
    contentRating: ld.contentRating ? String(ld.contentRating) : undefined,
    free: Array.isArray(ld.offers) ? ld.offers.some((o: any) => Number(o.price) === 0) : undefined,
    rating: Number.isFinite(rating) ? rating : undefined,
    ratingCount: Number.isFinite(ratingCount) ? ratingCount : undefined,
    updatedOn: updated,
    whatsNew,
    iconUrl: iconBase ? `${iconBase}=s512` : undefined,
    screenshotUrls: shots.slice(0, 12).map((id) => `https://play-lh.googleusercontent.com/${id}=s0`),
    features: featuresFrom(description),
  };
}

/** "FEATURES" section headings → feature list (title + one line). */
function featuresFrom(desc: string): { title: string; text: string }[] {
  const lines = desc.split("\n").map((l) => l.trim());
  const start = lines.findIndex((l) => /^features$/i.test(l));
  if (start < 0) return [];
  const out: { title: string; text: string }[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (/^[A-Z][A-Z '’&]+$/.test(l) && l.length > 4) break; // next ALL-CAPS section ("WHO IT'S FOR")
    const next = lines.slice(i + 1).find((x) => x);
    if (l.length <= 50 && next && next.length > 50) {
      out.push({ title: l, text: next });
      i = lines.indexOf(next, i + 1);
    }
  }
  return out.slice(0, 20);
}

async function download(url: string): Promise<{ bytes: Buffer; ext: string; mime: string }> {
  if (!/^https:\/\/play-lh\.googleusercontent\.com\//.test(url)) throw new Error("Not a Google Play image URL");
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`image ${res.status}`);
  const mime = (res.headers.get("content-type") ?? "image/png").split(";")[0].trim();
  if (!/^image\//.test(mime)) throw new Error(`not an image (${mime})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const ext = mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
  return { bytes, ext, mime };
}

/** Import (or refresh) a Play Store app into a brand. Re-import reuses already downloaded images. */
export async function importPlayStore(brandId: string, input?: string): Promise<PlayStoreApp> {
  const b = db.getBrand(brandId);
  if (!b) throw httpErr(404, "Brand not found");
  const pkg = packageIdFrom(input ?? "") ?? b.playStore?.packageId;
  if (!pkg) throw httpErr(400, "Give a Google Play link (https://play.google.com/store/apps/details?id=...) or package id");
  const info = await fetchPlayListing(pkg);
  const prev = b.playStore?.packageId === pkg ? b.playStore : undefined;
  const known = new Map<string, string>(Object.entries(prev?.imageSources ?? {}));
  const dir = path.join(UPLOADS_DIR, brandId);
  fs.mkdirSync(dir, { recursive: true });
  const save = async (url: string, name: string): Promise<string | undefined> => {
    const old = known.get(url);
    const a = old ? db.getAsset(old) : undefined;
    if (a && fs.existsSync(a.path)) return a.id;
    try {
      const img = await download(url);
      const abs = path.join(dir, `play-${name}-${nanoid(6)}${img.ext}`);
      fs.writeFileSync(abs, img.bytes);
      const asset: Asset = { id: nanoid(12), brandId, kind: "image", url: fileUrlFor(abs), path: abs, originalName: `play-${name}${img.ext}`, mime: img.mime, size: img.bytes.length, createdAt: nowIso(), source: "playstore" };
      db.saveAsset(asset);
      known.set(url, asset.id);
      return asset.id;
    } catch (e: any) {
      console.warn(`[playstore] ${url}: ${e?.message ?? e}`);
      return undefined;
    }
  };
  const iconAssetId = info.iconUrl ? await save(info.iconUrl, "icon") : undefined;
  const screenshotAssetIds: string[] = [];
  for (let i = 0; i < info.screenshotUrls.length; i++) {
    const id = await save(info.screenshotUrls[i], `screen-${i + 1}`);
    if (id) screenshotAssetIds.push(id);
  }
  const app: PlayStoreApp = { ...info, iconAssetId, screenshotAssetIds, imageSources: Object.fromEntries(known), importedAt: nowIso() };
  db.updateBrand(brandId, (x) => {
    x.playStore = app;
    if (!x.website) x.website = app.developerUrl;
    if (x.brain && iconAssetId && !x.brain.logoUrl) x.brain.logoUrl = db.getAsset(iconAssetId)?.url;
  });
  return app;
}

export function registerPlayStoreRoutes(app: Express) {
  const brandId = (req: Request) => {
    const id = String(req.params.id);
    if (!db.getBrand(id)) throw httpErr(404, "Brand not found");
    return id;
  };
  app.get("/api/brands/:id/playstore", (req, res) => {
    const b = db.getBrand(brandId(req))!;
    const ps = b.playStore;
    res.json(ps ? { ...ps, iconUrlLocal: ps.iconAssetId ? db.getAsset(ps.iconAssetId)?.url : undefined, screenshots: ps.screenshotAssetIds.map((id) => db.getAsset(id)).filter(Boolean) } : null);
  });
  app.post("/api/brands/:id/playstore/import", async (req, res) => res.json(await importPlayStore(brandId(req), String(req.body?.url ?? req.body?.packageId ?? ""))));
  app.get("/api/playstore/lookup", async (req, res) => {
    const pkg = packageIdFrom(String(req.query.url ?? ""));
    if (!pkg) throw httpErr(400, "Give ?url=<Google Play link>");
    res.json(await fetchPlayListing(pkg));
  });
}
