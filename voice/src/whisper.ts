import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { whisperDir } from "./config.ts";
import { readWav, resample, writeWav } from "./wav.ts";

const require = createRequire(import.meta.url);

/**
 * 1.5.5 is the build Remotion hosts as a prebuilt Windows x64 zip (main.exe); it supports --dtw
 * token-level timestamps. Override with WHISPER_CPP_VERSION if needed.
 */
export const WHISPER_CPP_VERSION = process.env.WHISPER_CPP_VERSION || "1.5.5";
export const WHISPER_MODEL = (process.env.WHISPER_MODEL || "base.en") as "base.en" | "small.en" | "tiny.en";

/** Multilingual model used for non-English (Urdu) timing passes. Override with WHISPER_MODEL_MULTI. */
export const WHISPER_MODEL_MULTI = (process.env.WHISPER_MODEL_MULTI || "small") as "small" | "base" | "tiny" | "medium";
export type WhisperModel = typeof WHISPER_MODEL | typeof WHISPER_MODEL_MULTI;

export type Word = { text: string; startMs: number; endMs: number };

export let lastWhisperInfo: { installMs: number; modelMs: number; installed: boolean; error?: string } | null = null;

function whisperInstallPath() {
  return path.join(whisperDir(), `whisper.cpp-${WHISPER_CPP_VERSION}`);
}
function whisperModelFolder() {
  return path.join(whisperDir(), "models");
}

/** Mirrors @remotion/install-whisper-cpp getWhisperExecutablePath (not exported from its index). */
function whisperExecutable(to: string): string {
  const [ma, mi, pa] = WHISPER_CPP_VERSION.split(".").map(Number);
  const newLayout = ma > 1 || (ma === 1 && (mi > 7 || (mi === 7 && pa >= 4)));
  const bin = newLayout ? path.join("build", "bin", "whisper-cli") : "main";
  return path.join(to, process.platform === "win32" ? bin + ".exe" : bin);
}

let readyPromise: Promise<void> | null = null;
const modelReady = new Map<string, Promise<void>>();

/**
 * Install whisper.cpp + a model once per process (downloads on first run). The default English model is
 * base.en; Urdu timing passes use the multilingual WHISPER_MODEL_MULTI (ggml-small.bin ≈ 466 MB, fetched
 * lazily from the same official Hugging Face repo, ggerganov/whisper.cpp, via @remotion/install-whisper-cpp).
 */
export async function ensureWhisper(model: WhisperModel = WHISPER_MODEL): Promise<void> {
  await ensureWhisperBinary();
  if (model === WHISPER_MODEL) return;
  let p = modelReady.get(model);
  if (!p) {
    p = (async () => {
      const w = await import("@remotion/install-whisper-cpp");
      fs.mkdirSync(whisperModelFolder(), { recursive: true });
      await w.downloadWhisperModel({ model: model as any, folder: whisperModelFolder(), printOutput: false });
    })().catch((e) => {
      modelReady.delete(model);
      throw e;
    });
    modelReady.set(model, p);
  }
  return p;
}

function ensureWhisperBinary(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      const w = await import("@remotion/install-whisper-cpp");
      fs.mkdirSync(whisperDir(), { recursive: true });
      const to = whisperInstallPath();
      const t0 = Date.now();
      const exe = whisperExecutable(to);
      if (fs.existsSync(to) && !fs.existsSync(exe)) fs.rmSync(to, { recursive: true, force: true }); // broken partial install
      if (!fs.existsSync(exe)) {
        // Note: on Windows Remotion downloads the zip to process.cwd() and deletes it after extracting.
        // We deliberately do not chdir (process-global) since the server keeps running meanwhile.
        await w.installWhisperCpp({ to, version: WHISPER_CPP_VERSION, printOutput: false });
      }
      if (!fs.existsSync(exe)) throw new Error(`whisper.cpp executable missing after install: ${exe}`);
      const t1 = Date.now();
      fs.mkdirSync(whisperModelFolder(), { recursive: true });
      await w.downloadWhisperModel({ model: WHISPER_MODEL, folder: whisperModelFolder(), printOutput: false });
      lastWhisperInfo = { installMs: t1 - t0, modelMs: Date.now() - t1, installed: true };
    })().catch((e) => {
      readyPromise = null;
      lastWhisperInfo = { installMs: 0, modelMs: 0, installed: false, error: String(e?.message ?? e) };
      throw e;
    });
  }
  return readyPromise;
}

function ffmpegPath(): string | null {
  try {
    const p = require("ffmpeg-static") as string | null;
    return p && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function run(bin: string, args: string[], timeoutMs = 10 * 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    const timer = setTimeout(() => {
      c.kill();
      reject(new Error(`${path.basename(bin)} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    c.stderr.on("data", (d) => { err += d; if (err.length > 8000) err = err.slice(-8000); });
    c.on("error", (e) => { clearTimeout(timer); reject(e); });
    c.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${err.slice(-1500)}`));
    });
  });
}

/** Convert any audio to 16 kHz mono 16-bit wav. Uses ffmpeg-static; falls back to a JS resampler for .wav input. */
export async function to16kMonoWav(input: string, out: string): Promise<string> {
  const ff = ffmpegPath();
  if (ff) {
    await run(ff, ["-y", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", out]);
    return out;
  }
  if (!/\.wav$/i.test(input)) throw new Error("ffmpeg-static binary not available and input is not a .wav file");
  const { samples, sampleRate } = readWav(input);
  writeWav(out, resample(samples, sampleRate, 16000), 16000);
  return out;
}

/** Merge whisper sub-word tokens into words with ms timings. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tokensToWords(json: any): Word[] {
  const words: Word[] = [];
  for (const item of json.transcription ?? []) {
    for (const tok of item.tokens ?? []) {
      const raw: string = tok.text ?? "";
      if (!raw || /^\s*\[_|^\s*\[BLANK|^<\|/.test(raw) || /^\s*\[.*\]\s*$/.test(raw)) continue;
      const start = tok.t_dtw != null && tok.t_dtw >= 0 ? tok.t_dtw * 10 : tok.offsets?.from ?? 0;
      const end = tok.offsets?.to ?? start;
      const startsWord = /^\s/.test(raw) || words.length === 0;
      const isPunct = /^[^\p{L}\p{N}\p{M}\s]+$/u.test(raw.trim()); // unicode-aware: Urdu letters are not \w
      if (startsWord && !isPunct) {
        words.push({ text: raw.trim(), startMs: start, endMs: Math.max(end, start) });
      } else if (words.length) {
        const w = words[words.length - 1];
        w.text += raw.trim();
        if (!isPunct) w.endMs = Math.max(w.endMs, end); // trailing punctuation tokens sit at segment end
      }
    }
  }
  // Monotonic cleanup: dtw starts can wobble; make each word end at the next word's start at most.
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (i > 0 && w.startMs < words[i - 1].startMs) w.startMs = words[i - 1].startMs;
    const next = words[i + 1];
    if (next && next.startMs > w.startMs) w.endMs = Math.min(Math.max(w.endMs, w.startMs + 60), next.startMs);
    if (w.endMs <= w.startMs) w.endMs = w.startMs + 60;
    w.startMs = Math.round(w.startMs);
    w.endMs = Math.round(w.endMs);
  }
  return words.filter((w) => /[\p{L}\p{N}]/u.test(w.text));
}

/** whisper.cpp word timings. Throws on failure (index.ts wraps it with an estimating fallback). */
//
// We spawn whisper.cpp ourselves instead of using Remotion's transcribe(): that helper writes its JSON
// to `<process.cwd()>/tmp.json` (collides between concurrent calls and litters the server folder) and
// always uses whisper's default 5-beam search, which together with --dtw was extremely slow on this
// CPU. Greedy decoding + -ojf (full JSON, enables token-level timestamps) is fast and accurate enough
// for captions. Set WHISPER_DTW=1 to add DTW token alignment (more precise, slower).
export async function transcribeWithWhisper(audioFile: string, opts: { lang?: string } = {}): Promise<Word[]> {
  const lang = opts.lang && opts.lang !== "en" ? opts.lang : "en";
  const model: WhisperModel = lang === "en" ? WHISPER_MODEL : WHISPER_MODEL_MULTI;
  await ensureWhisper(model);
  const w = await import("@remotion/install-whisper-cpp");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-whisper-"));
  try {
    const wav16 = await to16kMonoWav(path.resolve(audioFile), path.join(tmp, "in16k.wav"));
    const durSec = readWav(wav16).samples.length / 16000;
    const threads = Math.max(1, Math.min(8, os.cpus().length));
    const outBase = path.join(tmp, "out");
    const args = [
      "-f", wav16,
      "-m", path.join(whisperModelFolder(), `ggml-${model}.bin`),
      "-l", lang,
      "-t", String(threads),
      "-bs", "1", "-bo", "1", // greedy
      "-ojf", "-of", outBase,
      "-np",
    ];
    if (process.env.WHISPER_DTW === "1") args.push("--dtw", model);
    // Normally ~0.1-0.3x realtime on a laptop CPU; generous cap for a heavily loaded machine.
    // Non-English (ggml-small, ~4x base.en's compute) gets a tighter cap: its result only refines timings and
    // the caller has a good pause-based estimate to fall back on, so don't hog a busy CPU for minutes.
    const timeoutMs = Number(process.env.WHISPER_TIMEOUT_MS) || (lang === "en" ? Math.max(180_000, durSec * 60_000) : Math.max(90_000, durSec * 8_000));
    await run(whisperExecutable(whisperInstallPath()), args, timeoutMs);
    const json = JSON.parse(fs.readFileSync(`${outBase}.json`, "utf8"));
    const words = tokensToWords(json);
    if (!words.length) {
      const { captions } = w.toCaptions({ whisperCppOutput: json });
      return captions
        .map((c) => ({ text: c.text.trim(), startMs: c.startMs, endMs: c.endMs }))
        .filter((c) => c.text);
    }
    return words;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
