import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pexelsKey, pixabayKey } from "./config.ts";

export interface StockItem {
  id: string;
  kind: "video" | "image";
  url: string;
  previewUrl: string;
  width: number;
  height: number;
  credit: string;
  source: "pexels" | "pixabay";
}

type Opts = { kind: "video" | "image"; orientation?: "portrait"; perPage?: number };

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
  return r.json();
}

/** Pick the best video file: portrait-ish, closest to 1080 wide without going far above, mp4. */
function pickPexelsVideoFile(files: any[], portrait: boolean): any | undefined {
  const mp4 = files.filter((f) => (f.file_type ?? "").includes("mp4") && f.width && f.height);
  const pool = mp4.length ? mp4 : files;
  const score = (f: any) => {
    const w = portrait ? Math.min(f.width, f.height) : f.width;
    const orientOk = portrait ? f.height >= f.width : true;
    return (orientOk ? 0 : 100000) + Math.abs(w - 1080) + (w > 1440 ? 2000 : 0);
  };
  return [...pool].sort((a, b) => score(a) - score(b))[0];
}

async function searchPexels(query: string, opts: Opts, key: string): Promise<StockItem[]> {
  const per = Math.min(80, Math.max(1, opts.perPage ?? 10));
  const q = new URLSearchParams({ query, per_page: String(per) });
  if (opts.orientation === "portrait") q.set("orientation", "portrait");
  const headers = { Authorization: key };
  const portrait = opts.orientation === "portrait";
  if (opts.kind === "video") {
    const j = await getJson(`https://api.pexels.com/videos/search?${q}`, headers);
    return (j.videos ?? []).flatMap((v: any): StockItem[] => {
      const f = pickPexelsVideoFile(v.video_files ?? [], portrait);
      if (!f?.link) return [];
      return [{
        id: `pexels-video-${v.id}`,
        kind: "video",
        url: f.link,
        previewUrl: v.image ?? v.video_pictures?.[0]?.picture ?? "",
        width: f.width ?? v.width,
        height: f.height ?? v.height,
        credit: `Video by ${v.user?.name ?? "Unknown"} on Pexels`,
        source: "pexels",
      }];
    });
  }
  const j = await getJson(`https://api.pexels.com/v1/search?${q}`, headers);
  return (j.photos ?? []).map((p: any): StockItem => {
    // "large2x" is ~1880px on the long side; for portrait prefer "portrait" (800x1200 crop) only as preview.
    const url = p.src?.large2x ?? p.src?.original;
    return {
      id: `pexels-image-${p.id}`,
      kind: "image",
      url,
      previewUrl: p.src?.medium ?? p.src?.small ?? url,
      width: p.width,
      height: p.height,
      credit: `Photo by ${p.photographer ?? "Unknown"} on Pexels`,
      source: "pexels",
    };
  });
}

async function searchPixabay(query: string, opts: Opts, key: string): Promise<StockItem[]> {
  const per = Math.min(200, Math.max(3, opts.perPage ?? 10)); // pixabay min per_page is 3
  const q = new URLSearchParams({ key, q: query.slice(0, 100), per_page: String(per), safesearch: "true" });
  if (opts.kind === "video") {
    const j = await getJson(`https://pixabay.com/api/videos/?${q}`);
    let items: StockItem[] = (j.hits ?? []).flatMap((h: any): StockItem[] => {
      const v = h.videos ?? {};
      const f = [v.large, v.medium, v.small, v.tiny].find((x: any) => x?.url && x.width);
      if (!f) return [];
      return [{
        id: `pixabay-video-${h.id}`,
        kind: "video",
        url: f.url,
        previewUrl: f.thumbnail ?? v.medium?.thumbnail ?? `https://i.vimeocdn.com/video/${h.picture_id}_640x360.jpg`,
        width: f.width,
        height: f.height,
        credit: `Video by ${h.user ?? "Unknown"} on Pixabay`,
        source: "pixabay",
      }];
    });
    if (opts.orientation === "portrait") items = items.filter((i) => i.height >= i.width);
    return items.slice(0, opts.perPage ?? 10);
  }
  if (opts.orientation === "portrait") q.set("orientation", "vertical");
  q.set("image_type", "photo");
  const j = await getJson(`https://pixabay.com/api/?${q}`);
  return (j.hits ?? []).slice(0, opts.perPage ?? 10).map((h: any): StockItem => ({
    id: `pixabay-image-${h.id}`,
    kind: "image",
    url: h.largeImageURL ?? h.webformatURL,
    previewUrl: h.webformatURL ?? h.previewURL,
    width: h.imageWidth,
    height: h.imageHeight,
    credit: `Image by ${h.user ?? "Unknown"} on Pixabay`,
    source: "pixabay",
  }));
}

/**
 * Search Pexels first, then Pixabay; results are interleaved (Pexels first). Returns [] when no key
 * is configured. Provider errors are logged and skipped (never thrown).
 */
export async function searchStock(query: string, opts: Opts): Promise<StockItem[]> {
  const per = opts.perPage ?? 10;
  const pk = pexelsKey();
  const xk = pixabayKey();
  const jobs: Promise<StockItem[]>[] = [];
  if (pk) jobs.push(searchPexels(query, opts, pk).catch((e) => { console.warn(`[voice] pexels search failed: ${e.message}`); return []; }));
  if (xk) jobs.push(searchPixabay(query, opts, xk).catch((e) => { console.warn(`[voice] pixabay search failed: ${e.message}`); return []; }));
  if (!jobs.length) return [];
  const lists = await Promise.all(jobs);
  const out: StockItem[] = [];
  for (let i = 0; out.length < per && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && out.length < per) out.push(l[i]);
  }
  return out;
}

/** Stream a remote file to disk (atomic via .part rename). Returns the absolute outFile path. */
export async function downloadStock(url: string, outFile: string): Promise<string> {
  const abs = path.resolve(outFile);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const r = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "SocialMCPStudio/0.1" },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!r.ok || !r.body) throw new Error(`Download failed: HTTP ${r.status}`);
  const tmp = `${abs}.part`;
  try {
    await pipeline(Readable.fromWeb(r.body as any), fs.createWriteStream(tmp));
    fs.renameSync(tmp, abs);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return abs;
}
