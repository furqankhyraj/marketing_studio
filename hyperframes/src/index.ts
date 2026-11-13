// Social MCP Studio — HyperFrames engine (HTML + GSAP compositions -> MP4).
// Public API (see CONTRACTS.md "HyperFrames engine"):
//   listHtmlTemplates, buildFromTemplate, renderHtmlReel, validateHtml
//
// Rendering uses the programmatic @hyperframes/producer API (createRenderJob / executeRenderJob).
// FFmpeg/FFprobe come from the ffmpeg-static / ffprobe-static npm packages and are handed to
// HyperFrames through HYPERFRAMES_FFMPEG_PATH / HYPERFRAMES_FFPROBE_PATH (+ PATH for child processes).
// Chrome: HyperFrames' own chrome-headless-shell (downloaded by puppeteer on install into ~/.cache/puppeteer).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrandStyleRef, HtmlReelSpec, Scene } from "../../shared/types.ts";
import { COMPOSITION_ID, buildSpec } from "./templates/common.ts";
import { TEMPLATES, getTemplate } from "./templates/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_DIR = resolve(HERE, "..");
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------- binaries
function resolveFfmpeg(): string | undefined {
  try {
    const p = require("ffmpeg-static") as string | null;
    if (p && existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  return undefined;
}

function resolveFfprobe(): string | undefined {
  try {
    const p = (require("ffprobe-static") as { path?: string }).path;
    if (p && existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  return undefined;
}

export const FFMPEG_PATH = resolveFfmpeg();
export const FFPROBE_PATH = resolveFfprobe();

let envReady = false;
/** Point HyperFrames (and any child process it spawns) at the bundled ffmpeg/ffprobe. */
export function configureEnvironment(): void {
  if (envReady) return;
  envReady = true;
  const dirs: string[] = [];
  if (FFMPEG_PATH) {
    if (!process.env.HYPERFRAMES_FFMPEG_PATH) process.env.HYPERFRAMES_FFMPEG_PATH = FFMPEG_PATH;
    dirs.push(dirname(FFMPEG_PATH));
  }
  if (FFPROBE_PATH) {
    if (!process.env.HYPERFRAMES_FFPROBE_PATH) process.env.HYPERFRAMES_FFPROBE_PATH = FFPROBE_PATH;
    dirs.push(dirname(FFPROBE_PATH));
  }
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const cur = process.env[pathKey] ?? "";
  const missing = dirs.filter((d) => !cur.split(delimiter).includes(d));
  if (missing.length) process.env[pathKey] = [...missing, cur].join(delimiter);
  // No telemetry from a local, self-hosted tool.
  if (!process.env.HYPERFRAMES_NO_TELEMETRY) process.env.HYPERFRAMES_NO_TELEMETRY = "1";
  if (!process.env.DO_NOT_TRACK) process.env.DO_NOT_TRACK = "1";
}

function gsapFile(): string {
  try {
    return require.resolve("gsap/dist/gsap.min.js");
  } catch {
    return join(PACKAGE_DIR, "node_modules", "gsap", "dist", "gsap.min.js");
  }
}

// ---------------------------------------------------------------- templates
export function listHtmlTemplates(): { id: string; name: string; description: string; tags: string[] }[] {
  return TEMPLATES.map(({ id, name, description, tags }) => ({ id, name, description, tags }));
}

export function buildFromTemplate(
  templateId: string,
  input: { brand: BrandStyleRef; scenes: Scene[]; cta?: { text: string; keyword?: string }; durationSec?: number },
): HtmlReelSpec {
  const def = getTemplate(templateId);
  if (!def) throw new Error(`Unknown HyperFrames template "${templateId}". Available: ${TEMPLATES.map((t) => t.id).join(", ")}`);
  return buildSpec(def, input);
}

// ---------------------------------------------------------------- validation
export const MAX_HTML_BYTES = 2_000_000;
const ALLOWED_SCRIPT_RE = [
  /^\.?\/?gsap(\.min)?\.js$/i, // local copy we provide
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[\w.\-]+\/dist\/[\w.\-]+\.js$/i,
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/gsap\/[\w.\-]+\/[\w.\-]+\.js$/i,
  /^https:\/\/unpkg\.com\/gsap@[\w.\-]+\/dist\/[\w.\-]+\.js$/i,
];

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}

export function validateHtml(html: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof html !== "string" || !html.trim()) return { ok: false, errors: ["html is empty"] };
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_HTML_BYTES) errors.push(`html is ${bytes} bytes; limit is ${MAX_HTML_BYTES} (reference media as ./assets/<name> instead of inlining data: URIs)`);

  // root composition
  const rootTag = html.match(/<[a-z][\w-]*\b[^>]*\sdata-composition-id\s*=[^>]*>/i)?.[0];
  let compId: string | undefined;
  if (!rootTag) {
    errors.push('missing root element with data-composition-id (e.g. <div id="root" data-composition-id="reel" data-start="0" data-duration="15" data-width="1080" data-height="1920">)');
  } else {
    compId = attr(rootTag, "data-composition-id");
    if (!compId) errors.push("root data-composition-id is empty");
    if (attr(rootTag, "data-start") === undefined) errors.push('root is missing data-start="0"');
    const w = Number(attr(rootTag, "data-width"));
    const h = Number(attr(rootTag, "data-height"));
    if (!w || !h) errors.push('root is missing data-width / data-height (use data-width="1080" data-height="1920")');
    else if (w !== 1080 || h !== 1920) errors.push(`root is ${w}x${h}; reels must be data-width="1080" data-height="1920"`);
    const d = attr(rootTag, "data-duration");
    if (d !== undefined && !(Number(d) > 0 && Number(d) <= 180)) errors.push(`root data-duration="${d}" must be a number of seconds between 0 and 180`);
    if (attr(rootTag, "data-composition-src")) errors.push("root must be inline (no data-composition-src)");
  }

  // timeline
  const noTimeline = rootTag ? /\sdata-no-timeline\b/i.test(rootTag) : false;
  if (!noTimeline) {
    if (!/__timelines/.test(html)) errors.push('no GSAP timeline registered: add window.__timelines = window.__timelines || {}; window.__timelines["<composition-id>"] = tl;');
    else if (compId && !new RegExp(`__timelines\\s*(\\[\\s*["'\`]${escapeRe(compId)}["'\`]\\s*\\]|\\.${escapeRe(compId)}\\b)`).test(html))
      errors.push(`window.__timelines key must match data-composition-id "${compId}"`);
    if (/gsap\.timeline\s*\(/.test(html) && !/gsap\.timeline\s*\(\s*\{[^}]*paused\s*:\s*true/.test(html))
      errors.push("create the timeline with gsap.timeline({ paused: true }) — HyperFrames owns the playhead");
    if (!/<script\b[^>]*\bsrc\s*=\s*["'][^"']*gsap[^"']*["']/i.test(html) && /\bgsap\./.test(html))
      errors.push('GSAP is used but not loaded: add <script src="./gsap.min.js"></script> in <head>');
  }

  // scripts
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = attr(m[0], "src");
    if (src && !ALLOWED_SCRIPT_RE.some((re) => re.test(src.trim())))
      errors.push(`external script not allowed: ${src} (only GSAP is allowed: ./gsap.min.js or a pinned GSAP CDN URL)`);
  }
  if (/<iframe\b/i.test(html)) errors.push("<iframe> is not allowed");
  if (/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/i.test(html)) {
    for (const m of html.matchAll(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi)) {
      const href = attr(m[0], "href") ?? "";
      if (!/^https:\/\/fonts\.googleapis\.com\//i.test(href) && /^https?:/i.test(href)) errors.push(`external stylesheet not allowed: ${href} (Google Fonts only)`);
    }
  }

  // determinism
  const scriptBodies = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
  const banned: [RegExp, string][] = [
    [/\bDate\.now\s*\(|new\s+Date\s*\(\s*\)/, "Date.now()/new Date() (wall clock) breaks deterministic rendering"],
    [/\bMath\.random\s*\(/, "Math.random() breaks deterministic rendering — use a seeded PRNG or fixed values"],
    [/\brequestAnimationFrame\s*\(|\bsetInterval\s*\(/, "requestAnimationFrame/setInterval animation loops are not seekable — animate with the GSAP timeline"],
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket/, "network requests at render time are not allowed — reference files as ./assets/<name>"],
    [/\.play\s*\(\s*\)|\.currentTime\s*=/, "do not call play() or set currentTime on media — use data-start/data-duration on <video>/<audio>"],
  ];
  for (const [re, msg] of banned) if (re.test(scriptBodies)) errors.push(msg);

  // timed clips need ids
  let clipsWithoutId = 0;
  for (const m of html.matchAll(/<(?!div\b[^>]*data-composition-id)([a-z][\w-]*)\b[^>]*\sdata-start\s*=[^>]*>/gi)) {
    if (m[0] === rootTag) continue;
    if (!attr(m[0], "id")) clipsWithoutId++;
  }
  if (clipsWithoutId) errors.push(`${clipsWithoutId} timed element(s) with data-start have no id attribute`);
  for (const m of html.matchAll(/<video\b[^>]*>/gi)) {
    if (!/\smuted\b/i.test(m[0]) && !/data-has-audio\s*=\s*["']?true/i.test(m[0])) errors.push('every <video> must be muted or declare data-has-audio="true"');
  }

  // remote media should go through assets
  for (const m of html.matchAll(/<(img|video|audio|source)\b[^>]*\ssrc\s*=\s*["'](https?:[^"']+)["']/gi)) {
    errors.push(`remote ${m[1]} src ${m[2].slice(0, 80)} — list it in spec.assets and reference ./assets/<name>`);
  }
  return { ok: errors.length === 0, errors };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------- render
// 1x1 transparent PNG written in place of an image asset that could not be downloaded.
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

function safeAssetName(name: string): string {
  const n = String(name).replace(/\\/g, "/").split("/").pop()!.replace(/[^\w.\-]/g, "_");
  return n && n !== "." && n !== ".." ? n : "asset";
}

async function download(src: string, file: string): Promise<boolean> {
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(src, {
        signal: AbortSignal.timeout(60_000),
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0 (SocialMCPStudio; hyperframes renderer)", accept: "*/*" },
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length && buf.length <= 600 * 1024 * 1024) {
          writeFileSync(file, buf);
          return true;
        }
        lastErr = `bad size ${buf.length}`;
      }
    } catch (e) {
      lastErr = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 800 * attempt));
  }
  console.warn(`[hyperframes] download failed (${lastErr}): ${src.slice(0, 120)}`);
  return false;
}

/** Rewrite GSAP CDN script tags to the local copy and make sure the root carries data-duration. */
function prepareHtml(html: string, durationSec: number): string {
  let out = html.replace(/(<script\b[^>]*\bsrc\s*=\s*["'])(https:\/\/[^"']*gsap[^"']*\/gsap(?:\.min)?\.js)(["'])/gi, "$1./gsap.min.js$3");
  out = out.replace(/(<script\b[^>]*\bsrc\s*=\s*["'])\/?gsap\.js(["'])/gi, "$1./gsap.min.js$2");
  out = out.replace(/<[a-z][\w-]*\b[^>]*\sdata-composition-id\s*=[^>]*>/i, (tag) =>
    /\sdata-duration\s*=/.test(tag) || /\sdata-no-timeline\b/.test(tag) ? tag : tag.replace(/>$/, ` data-duration="${durationSec}">`).replace(/\/ data-duration/, ` data-duration`),
  );
  return out;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    if (!FFMPEG_PATH) return rej(new Error("ffmpeg-static binary not found (npm install inside hyperframes/)"));
    const p = spawn(FFMPEG_PATH, args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    p.on("error", rej);
    p.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}: ${err}`))));
  });
}

function quietLogger() {
  const verbose = !!process.env.HF_VERBOSE;
  const noop = () => {};
  return {
    error: (m: string, meta?: Record<string, unknown>) => console.error("[hyperframes]", m, meta ?? ""),
    warn: verbose ? (m: string, meta?: Record<string, unknown>) => console.warn("[hyperframes]", m, meta ?? "") : noop,
    info: verbose ? (m: string) => console.error("[hyperframes]", m) : noop,
    debug: noop,
    isLevelEnabled: (l: string) => l === "error" || (verbose && (l === "warn" || l === "info")),
  };
}

/**
 * Write a self-contained HyperFrames project for `spec` into `dir`:
 * index.html (GSAP rewritten to the local copy), gsap.min.js and assets/<name> (downloaded; failures degrade gracefully).
 */
export async function prepareProject(spec: HtmlReelSpec, dir: string, onProgress?: (p: number) => void): Promise<string> {
  const durationSec = Number(spec.durationSec) > 0 ? Number(spec.durationSec) : 15;
  const assetsDir = join(dir, "assets");
  mkdirSync(assetsDir, { recursive: true });
  let html = prepareHtml(spec.html, durationSec);
  copyFileSync(gsapFile(), join(dir, "gsap.min.js"));
  const assets = (spec.assets ?? []).filter((a) => a && a.name && a.src);
  let done = 0;
  await Promise.all(
    assets.map(async (a) => {
      const name = safeAssetName(a.name);
      const file = join(assetsDir, name);
      const isVideo = /\.(mp4|mov|webm|m4v)$/i.test(name);
      const isAudio = /\.(mp3|wav|m4a|aac|ogg)$/i.test(name);
      let ok = false;
      if (/^https?:\/\//i.test(a.src)) ok = await download(a.src, file);
      else if (existsSync(a.src)) {
        copyFileSync(a.src, file);
        ok = true;
      }
      if (!ok) {
        console.warn(`[hyperframes] asset "${name}" could not be fetched; continuing without it`);
        if (isVideo || isAudio) {
          // drop the media element so the render does not fail; the brand gradient underneath shows instead
          const re = new RegExp(`<(video|audio)\\b[^>]*src\\s*=\\s*["']\\.?\\/?assets\\/${escapeRe(name)}["'][^>]*>\\s*(</\\1>)?`, "gi");
          html = html.replace(re, "");
        } else {
          writeFileSync(file, BLANK_PNG);
        }
      }
      done++;
      onProgress?.(done / Math.max(1, assets.length));
    }),
  );
  const index = join(dir, "index.html");
  writeFileSync(index, html, "utf8");
  return index;
}

let queue: Promise<unknown> = Promise.resolve();

export function renderHtmlReel(
  spec: HtmlReelSpec,
  outDir: string,
  onProgress?: (p: number) => void,
): Promise<{ videoPath: string; thumbnailPath: string }> {
  // One render at a time inside this process (each render already uses several Chrome workers).
  const run = queue.then(() => doRender(spec, outDir, onProgress));
  queue = run.catch(() => undefined);
  return run;
}

async function doRender(spec: HtmlReelSpec, outDir: string, onProgress?: (p: number) => void) {
  configureEnvironment();
  const report = (p: number) => {
    try {
      onProgress?.(Math.max(0, Math.min(1, p)));
    } catch {
      /* ignore listener errors */
    }
  };
  report(0);
  if (!spec || typeof spec.html !== "string") throw new Error("HtmlReelSpec.html is required");
  const v = validateHtml(spec.html);
  // remote-media errors are fixable by us only if listed in assets; everything else is fatal
  const fatal = v.errors.filter((e) => !e.startsWith("remote "));
  if (fatal.length) throw new Error("Invalid HyperFrames composition:\n- " + fatal.join("\n- "));

  const durationSec = Number(spec.durationSec) > 0 ? Number(spec.durationSec) : 15;
  const fps = Number(spec.fps) > 0 ? Math.round(Number(spec.fps)) : 30;
  const absOut = resolve(outDir);
  mkdirSync(absOut, { recursive: true });
  const videoPath = join(absOut, "reel.mp4");
  const thumbnailPath = join(absOut, "thumb.jpg");

  const work = join(tmpdir(), `smcp-hf-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await prepareProject(spec, work, (p) => report(0.1 * p));
    report(0.1);

    const producer = await import("@hyperframes/producer");
    const job = producer.createRenderJob({
      fps,
      quality: "standard",
      format: "mp4",
      entryFile: "index.html",
      logger: quietLogger(),
      ...(Number(process.env.HF_WORKERS) > 0 ? { workers: Number(process.env.HF_WORKERS) } : {}),
    } as Parameters<typeof producer.createRenderJob>[0]);
    if (existsSync(videoPath)) rmSync(videoPath, { force: true });
    await producer.executeRenderJob(job, work, videoPath, (j) => {
      const pct = Number(j.progress) || 0;
      report(0.1 + 0.85 * (pct / 100));
    });
    if (process.env.HF_VERBOSE && job.perfSummary) {
      const ps = job.perfSummary;
      console.error("[hyperframes] perf", JSON.stringify({ workers: ps.workers, totalMs: ps.totalElapsedMs, frames: ps.totalFrames, captureAvgMs: ps.captureAvgMs, stages: ps.stages }));
    }
    if (!existsSync(videoPath) || statSync(videoPath).size < 1000) {
      throw new Error(`HyperFrames render produced no output${job.error ? `: ${job.error}` : ""}`);
    }

    // thumbnail: a frame once the first scene has animated in
    // cover frame: root data-thumb-at="<seconds>" if the composition declares one, else ~12% in
    const declared = Number(spec.html.match(/\sdata-thumb-at\s*=\s*["']?([\d.]+)/i)?.[1]);
    const guess = Math.min(Math.max(0.5, durationSec * 0.12), 1.6);
    const at = Math.max(0, Math.min(Number.isFinite(declared) && declared > 0 ? declared : guess, durationSec - 0.1));
    await runFfmpeg(["-y", "-loglevel", "error", "-ss", at.toFixed(2), "-i", videoPath, "-frames:v", "1", "-q:v", "3", thumbnailPath]);
    report(1);
    return { videoPath, thumbnailPath };
  } finally {
    if (!process.env.HF_KEEP_TEMP) {
      try {
        rmSync(work, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

/** Authoring guide (README "Authoring custom compositions" section) — the MCP server can serve this as a resource. */
export function authoringGuide(): string {
  try {
    const md = readFileSync(join(PACKAGE_DIR, "README.md"), "utf8");
    const i = md.indexOf("## Authoring custom compositions");
    if (i < 0) return md;
    const j = md.indexOf("\n## ", i + 5);
    return md.slice(i, j < 0 ? undefined : j).trim();
  } catch {
    return "";
  }
}

export { COMPOSITION_ID };
