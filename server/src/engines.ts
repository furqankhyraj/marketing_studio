// Lazy loaders for sibling packages (renderer/, hyperframes/, voice/). They are built in parallel and may
// be missing or broken; the server must keep running, so every import is dynamic and failures are cached
// for a short time only (so a package that appears later gets picked up without a restart).
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { fork, type ChildProcess } from "node:child_process";
import { ROOT_DIR } from "./config.ts";
import type {
  StyleMeta,
  CaptionStyleMeta,
  ReelSpec,
  CarouselSpec,
  HtmlReelSpec,
  BrandStyleRef,
  Scene,
} from "../../shared/types.ts";

export interface RendererModule {
  listStyles(): StyleMeta[];
  listCaptionStyles(): CaptionStyleMeta[];
  renderReel(spec: ReelSpec, outDir: string, onProgress?: (p: number) => void): Promise<{ videoPath: string; thumbnailPath: string }>;
  renderCarousel(spec: CarouselSpec, outDir: string): Promise<{ imagePaths: string[] }>;
  renderStill?(spec: ReelSpec, frame: number, outFile: string): Promise<string>;
}
export interface HtmlTemplateMeta {
  id: string;
  name: string;
  description: string;
  tags: string[];
}
export interface HyperframesModule {
  listHtmlTemplates(): HtmlTemplateMeta[];
  buildFromTemplate(
    templateId: string,
    input: { brand: BrandStyleRef; scenes: Scene[]; cta?: { text: string; keyword?: string }; durationSec?: number },
  ): HtmlReelSpec;
  renderHtmlReel(spec: HtmlReelSpec, outDir: string, onProgress?: (p: number) => void): Promise<{ videoPath: string; thumbnailPath: string }>;
  validateHtml?(html: string): { ok: boolean; errors: string[] };
}
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
export interface VoiceModule {
  configure?(opts: { pexelsApiKey?: string; pixabayApiKey?: string; dataDir?: string }): void;
  listVoices(): { id: string; name: string; gender: string; accent: string }[];
  synthesize(text: string, opts: { voice?: string; speed?: number; outFile: string }): Promise<{ path: string; durationMs: number }>;
  synthesizeScenes(
    scenes: { id: string; text: string; captionText?: string }[],
    opts: { voice?: string; speed?: number; lang?: "en" | "ur" | "auto"; outDir: string },
  ): Promise<{ path: string; durationMs: number; scenes: { id: string; startMs: number; endMs: number }[] }>;
  transcribeWords(audioFile: string, opts?: { lang?: "en" | "ur" | "auto" }): Promise<{ text: string; startMs: number; endMs: number }[]>;
  searchStock(query: string, opts: { kind: "video" | "image"; orientation?: "portrait"; perPage?: number }): Promise<StockItem[]>;
  downloadStock(url: string, outFile: string): Promise<string>;
}

const cache = new Map<string, { mod?: any; err?: string; at: number }>();
const RETRY_MS = 30_000;

async function load<T>(pkg: string): Promise<T> {
  const c = cache.get(pkg);
  if (c?.mod) return c.mod as T;
  if (c?.err && Date.now() - c.at < RETRY_MS) throw new Error(c.err);
  const entry = path.join(ROOT_DIR, pkg, "src", "index.ts");
  try {
    if (!fs.existsSync(entry)) throw new Error(`${pkg}/src/index.ts not found`);
    const mod = await import(pathToFileURL(entry).href);
    cache.set(pkg, { mod, at: Date.now() });
    return mod as T;
  } catch (e: any) {
    const err = `${pkg} package unavailable: ${e?.message ?? e}`;
    cache.set(pkg, { err, at: Date.now() });
    throw new Error(err);
  }
}

export const loadRenderer = () => load<RendererModule>("renderer");
export const loadHyperframes = () => load<HyperframesModule>("hyperframes");
// Voice: list/search/download run in-process (cheap); synthesizeScenes/transcribeWords run in a forked
// worker so Kokoro inference never blocks the HTTP server.
let worker: ChildProcess | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let lastConfig: any;

function getWorker(): ChildProcess {
  if (worker && worker.connected) return worker;
  const tsx = import.meta.resolve("tsx");
  worker = fork(fileURLToPath(new URL("./voice-worker.ts", import.meta.url)), [], {
    execArgv: ["--import", tsx],
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    env: process.env,
  });
  worker.on("message", (m: any) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
  });
  worker.on("exit", () => {
    for (const p of pending.values()) p.reject(new Error("voice worker exited"));
    pending.clear();
    worker = undefined;
  });
  if (lastConfig) callWorker("configure", [lastConfig]).catch(() => {});
  return worker;
}

function callWorker(fn: string, args: any[]): Promise<any> {
  const w = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.send({ id, fn, args });
  });
}

export const loadVoice = async (): Promise<VoiceModule> => {
  const mod = await load<VoiceModule>("voice");
  return {
    ...mod,
    configure: (opts) => {
      lastConfig = opts;
      mod.configure?.(opts);
      if (worker?.connected) callWorker("configure", [opts]).catch(() => {});
    },
    synthesizeScenes: (scenes, opts) => callWorker("synthesizeScenes", [scenes, opts]),
    transcribeWords: (audioFile, opts) => callWorker("transcribeWords", [audioFile, opts ?? {}]),
  };
};

export async function tryLoad<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

// Built-in fallback lists (used when renderer/ is not available yet).
export const FALLBACK_STYLES: StyleMeta[] = [
  { id: "cinematic", name: "Cinematic", description: "Slow zooms, letterbox bars, elegant serif titles", tags: ["premium", "story"], supports: ["reel", "story"] },
  { id: "bold-pop", name: "Bold Pop", description: "Punchy colour blocks and big sans headlines", tags: ["energetic"], supports: ["reel", "carousel", "story"] },
  { id: "minimal", name: "Minimal", description: "Clean whitespace, small type, calm motion", tags: ["clean"], supports: ["reel", "carousel", "story"] },
  { id: "kinetic", name: "Kinetic Type", description: "Words fly in one by one", tags: ["text", "energetic"], supports: ["reel", "story"] },
  { id: "editorial", name: "Editorial", description: "Magazine layout with serif headings", tags: ["premium"], supports: ["reel", "carousel"] },
  { id: "neon", name: "Neon", description: "Dark background with glowing accents", tags: ["night", "tech"], supports: ["reel", "story"] },
  { id: "gradient-wave", name: "Gradient Wave", description: "Animated brand-colour gradients", tags: ["colorful"], supports: ["reel", "carousel", "story"] },
  { id: "split-screen", name: "Split Screen", description: "Media on one half, text on the other", tags: ["product"], supports: ["reel", "carousel"] },
  { id: "polaroid", name: "Polaroid", description: "Photos as tilted polaroid prints", tags: ["handmade", "warm"], supports: ["reel", "carousel"] },
  { id: "news-flash", name: "News Flash", description: "Breaking-news lower thirds and tickers", tags: ["announcement"], supports: ["reel", "story"] },
  { id: "notebook", name: "Notebook", description: "Lined paper and handwritten notes, great for lessons", tags: ["education"], supports: ["reel", "carousel"] },
  { id: "luxe", name: "Luxe", description: "Gold accents, slow fades, premium feel", tags: ["premium"], supports: ["reel", "carousel", "story"] },
];
export const FALLBACK_CAPTION_STYLES: CaptionStyleMeta[] = [
  { id: "white-pill", name: "White Pill", description: "Black text on a rounded white pill" },
  { id: "karaoke", name: "Karaoke", description: "Active word highlighted in accent colour" },
  { id: "bold-yellow", name: "Bold Yellow", description: "Big yellow words with black outline" },
  { id: "subtle", name: "Subtle", description: "Small lower-third white text" },
  { id: "boxed", name: "Boxed", description: "Text on a brand-colour box" },
  { id: "outline", name: "Outline", description: "White text with heavy outline" },
];

export async function getStyles(): Promise<{ styles: StyleMeta[]; captionStyles: CaptionStyleMeta[]; htmlTemplates: HtmlTemplateMeta[] }> {
  let styles = FALLBACK_STYLES;
  let captionStyles = FALLBACK_CAPTION_STYLES;
  let htmlTemplates: HtmlTemplateMeta[] = [];
  const r = await tryLoad(loadRenderer);
  if (r) {
    try {
      const s = r.listStyles();
      if (Array.isArray(s) && s.length) styles = s;
      const c = r.listCaptionStyles();
      if (Array.isArray(c) && c.length) captionStyles = c;
    } catch {
      /* keep fallback */
    }
  }
  const h = await tryLoad(loadHyperframes);
  if (h) {
    try {
      const t = h.listHtmlTemplates();
      if (Array.isArray(t)) htmlTemplates = t;
    } catch {
      /* none */
    }
  }
  return { styles, captionStyles, htmlTemplates };
}
