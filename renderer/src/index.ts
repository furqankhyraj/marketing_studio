// Social MCP Studio renderer — public API (see CONTRACTS.md "Renderer API").
// Importable from other packages (e.g. server/ via `import("../../renderer/src/index.ts")` under tsx):
// all paths are resolved from import.meta.url, never from process.cwd().
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import {
  ensureBrowser,
  openBrowser,
  renderMedia,
  renderStill as remotionRenderStill,
  selectComposition,
} from "@remotion/renderer";
import type { CarouselSpec, CaptionStyleMeta, MediaRef, ReelSpec, StyleMeta } from "../../shared/types.ts";
import { CAPTION_STYLES, STYLE_LIST } from "./remotion/styles/meta.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, "remotion", "entry.ts");
const PKG_ROOT = path.resolve(HERE, "..");

const CONCURRENCY = Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));
const DELAY_RENDER_TIMEOUT = 90_000;

// ---------------------------------------------------------------- metadata

export function listStyles(): StyleMeta[] {
  return STYLE_LIST.map((s) => ({ ...s, tags: [...s.tags], supports: [...s.supports] }));
}

export function listCaptionStyles(): CaptionStyleMeta[] {
  return CAPTION_STYLES.map((c) => ({ ...c }));
}

// ---------------------------------------------------------------- bundling (once per process)

let bundlePromise: Promise<string> | null = null;
let browserReady: Promise<void> | null = null;

export function getServeUrl(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: ENTRY,
      // rootDir anchors webpack's cache + public dir inside renderer/ regardless of the caller's cwd
      rootDir: PKG_ROOT,
    }).catch((err) => {
      bundlePromise = null; // allow retry on next call
      throw err;
    });
  }
  return bundlePromise;
}

function getBrowserReady(): Promise<void> {
  if (!browserReady) {
    browserReady = ensureBrowser()
      .then(() => undefined)
      .catch((err) => {
        browserReady = null;
        throw err;
      });
  }
  return browserReady;
}

export async function withBrowser<T>(fn: (browser: Awaited<ReturnType<typeof openBrowser>>) => Promise<T>): Promise<T> {
  await getBrowserReady();
  const browser = await openBrowser("chrome", { chromiumOptions: { gl: "angle" } });
  try {
    return await fn(browser);
  } finally {
    await browser.close({ silent: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- media preflight

const probeCache = new Map<string, { ok: boolean; at: number }>();

/** Returns true if the URL answers with a 2xx within the timeout. Failed media is dropped so renders never crash. */
export async function probe(url: string | undefined, kind: "image" | "video" | "audio"): Promise<boolean> {
  if (!url || typeof url !== "string") return false;
  if (!/^https?:\/\//i.test(url) && !url.startsWith("data:")) return false;
  if (url.startsWith("data:")) return true;
  const cached = probeCache.get(url);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.ok;
  let ok = false;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-2047" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    const type = (res.headers.get("content-type") || "").toLowerCase();
    ok = res.ok && !type.startsWith("text/html");
    if (ok && type && !type.includes("octet-stream")) {
      if (kind === "image") ok = type.startsWith("image/");
      else if (kind === "video") ok = type.startsWith("video/") || type.includes("mp4") || type.includes("quicktime");
      else ok = type.startsWith("audio/") || type.startsWith("video/");
    }
    await res.body?.cancel().catch(() => undefined);
  } catch {
    ok = false;
  }
  if (!ok) console.warn(`[renderer] media unavailable, falling back to brand colors: ${url}`);
  probeCache.set(url, { ok, at: Date.now() });
  return ok;
}

async function checkMedia(m: MediaRef | undefined): Promise<MediaRef | undefined> {
  if (!m?.src) return undefined;
  const kind = m.kind === "video" ? "video" : "image";
  return (await probe(m.src, kind)) ? { src: m.src, kind, ...(m.frame === "phone" && kind === "image" ? { frame: "phone" as const } : {}) } : undefined;
}

function clampNum(v: unknown, d: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
}

async function prepareReel(spec: ReelSpec): Promise<ReelSpec> {
  const brand = { ...spec.brand, name: spec.brand?.name || "Brand", colors: { ...(spec.brand?.colors ?? ({} as ReelSpec["brand"]["colors"])) } };
  const scenes = (spec.scenes?.length ? spec.scenes : [{ id: "s1", durationSec: 3, headline: brand.name }]).map((s, i) => ({
    ...s,
    id: s.id || `s${i + 1}`,
    headline: String(s.headline ?? ""),
    durationSec: clampNum(s.durationSec, 3, 0.5, 60),
  }));
  const [logoOk, musicOk, voiceOk, medias] = await Promise.all([
    brand.logoUrl ? probe(brand.logoUrl, "image") : Promise.resolve(false),
    spec.music?.src ? probe(spec.music.src, "audio") : Promise.resolve(false),
    spec.voiceover?.src ? probe(spec.voiceover.src, "audio") : Promise.resolve(false),
    Promise.all(scenes.map((s) => checkMedia(s.media))),
  ]);
  return {
    ...spec,
    width: Math.round(clampNum(spec.width, 1080, 240, 3840)),
    height: Math.round(clampNum(spec.height, 1920, 240, 3840)),
    fps: Math.round(clampNum(spec.fps, 30, 1, 60)),
    brand: { ...brand, logoUrl: logoOk ? brand.logoUrl : undefined },
    scenes: scenes.map((s, i) => ({ ...s, media: medias[i] })),
    music: musicOk && spec.music ? spec.music : undefined,
    voiceover: voiceOk && spec.voiceover ? spec.voiceover : undefined,
    captions: Array.isArray(spec.captions) ? spec.captions : undefined,
  };
}

async function prepareCarousel(spec: CarouselSpec): Promise<CarouselSpec> {
  const brand = { ...spec.brand, name: spec.brand?.name || "Brand" };
  const slides = (spec.slides?.length ? spec.slides : [{ headline: brand.name }]).slice(0, 10);
  const [logoOk, medias] = await Promise.all([
    brand.logoUrl ? probe(brand.logoUrl, "image") : Promise.resolve(false),
    Promise.all(slides.map((s) => checkMedia(s.media))),
  ]);
  return {
    ...spec,
    width: Math.round(clampNum(spec.width, 1080, 240, 3840)),
    height: Math.round(clampNum(spec.height, 1350, 240, 3840)),
    brand: { ...brand, logoUrl: logoOk ? brand.logoUrl : undefined },
    slides: slides.map((s, i) => ({ ...s, headline: String(s.headline ?? ""), media: medias[i] })),
  };
}

// ---------------------------------------------------------------- render API

export async function renderReel(
  spec: ReelSpec,
  outDir: string,
  onProgress?: (p: number) => void,
): Promise<{ videoPath: string; thumbnailPath: string }> {
  const out = path.resolve(outDir);
  await fs.mkdir(out, { recursive: true });
  const prepared = await prepareReel(spec);
  const serveUrl = await getServeUrl();
  const inputProps = { spec: prepared };
  const videoPath = path.join(out, "reel.mp4");
  const thumbnailPath = path.join(out, "thumb.jpg");

  await withBrowser(async (browser) => {
    const composition = await selectComposition({ serveUrl, id: "Reel", inputProps, puppeteerInstance: browser, timeoutInMilliseconds: DELAY_RENDER_TIMEOUT });
    let last = -1;
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      enforceAudioTrack: true,
      outputLocation: videoPath,
      overwrite: true,
      concurrency: CONCURRENCY,
      puppeteerInstance: browser,
      timeoutInMilliseconds: DELAY_RENDER_TIMEOUT,
      onProgress: ({ progress }) => {
        const p = Math.round(progress * 0.95 * 100) / 100;
        if (p !== last) {
          last = p;
          onProgress?.(p);
        }
      },
    });
    // thumbnail: ~1.4s in (after the first scene's entrance), clamped to the video
    const frame = Math.min(composition.durationInFrames - 1, Math.round(composition.fps * 1.4));
    await remotionRenderStill({
      composition,
      serveUrl,
      inputProps,
      frame,
      output: thumbnailPath,
      imageFormat: "jpeg",
      jpegQuality: 88,
      overwrite: true,
      puppeteerInstance: browser,
      timeoutInMilliseconds: DELAY_RENDER_TIMEOUT,
    });
  });
  onProgress?.(1);
  return { videoPath, thumbnailPath };
}

export async function renderCarousel(spec: CarouselSpec, outDir: string): Promise<{ imagePaths: string[] }> {
  const out = path.resolve(outDir);
  await fs.mkdir(out, { recursive: true });
  const prepared = await prepareCarousel(spec);
  const serveUrl = await getServeUrl();
  const imagePaths: string[] = [];
  await withBrowser(async (browser) => {
    for (let i = 0; i < prepared.slides.length; i++) {
      const inputProps = { spec: prepared, index: i };
      const composition = await selectComposition({ serveUrl, id: "CarouselSlide", inputProps, puppeteerInstance: browser, timeoutInMilliseconds: DELAY_RENDER_TIMEOUT });
      const file = path.join(out, `slide-${String(i + 1).padStart(2, "0")}.png`);
      await remotionRenderStill({
        composition,
        serveUrl,
        inputProps,
        frame: Math.min(composition.durationInFrames - 1, 75), // entrances settled
        output: file,
        imageFormat: "png",
        overwrite: true,
        puppeteerInstance: browser,
        timeoutInMilliseconds: DELAY_RENDER_TIMEOUT,
      });
      imagePaths.push(file);
    }
  });
  return { imagePaths };
}

export async function renderStill(spec: ReelSpec, frame: number, outFile: string): Promise<string> {
  const file = path.resolve(outFile);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const prepared = await prepareReel(spec);
  const serveUrl = await getServeUrl();
  const inputProps = { spec: prepared };
  const ext = path.extname(file).toLowerCase();
  const imageFormat = ext === ".jpg" || ext === ".jpeg" ? "jpeg" : ext === ".webp" ? "webp" : "png";
  await withBrowser(async (browser) => {
    const composition = await selectComposition({ serveUrl, id: "Reel", inputProps, puppeteerInstance: browser, timeoutInMilliseconds: DELAY_RENDER_TIMEOUT });
    const f = Math.max(0, Math.min(composition.durationInFrames - 1, Math.round(Number(frame) || 0)));
    await remotionRenderStill({
      composition,
      serveUrl,
      inputProps,
      frame: f,
      output: file,
      imageFormat,
      jpegQuality: imageFormat === "jpeg" ? 90 : undefined,
      overwrite: true,
      puppeteerInstance: browser,
      timeoutInMilliseconds: DELAY_RENDER_TIMEOUT,
    });
  });
  return file;
}

// ---------------------------------------------------------------- single-image feed posts (see ./image.ts)
export { renderImagePost, renderPinImage, IMAGE_DESIGNS } from "./image.ts";

// ---------------------------------------------------------------- clips from long videos (see ./clip.ts)
export { renderClipReel } from "./clip.ts";
