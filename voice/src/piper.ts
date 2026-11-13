/**
 * Piper TTS provider (MIT, https://github.com/rhasspy/piper) for Urdu narration.
 *
 * Kokoro is English-only, so Urdu voiceovers use the official Piper Windows binary (bundles espeak-ng data
 * + onnxruntime) and the official Urdu voices from Hugging Face rhasspy/piper-voices. Everything downloads
 * lazily on first use into <DATA_DIR>/voice-models/piper/, only from those official URLs.
 *
 * Input must be Urdu (Arabic) script; espeak-ng's "ur" phonemizer does not read Roman Urdu.
 * Output is resampled to Kokoro's 24 kHz so both engines produce the same wav format.
 *
 * Compatibility shims (the Urdu voices were trained with Piper 1.5, newer than the last Windows binary):
 *  - the .onnx files use ONNX IR 10 / opset 18, which the binary's bundled onnxruntime 1.14 cannot load, so
 *    after extracting we swap in the onnxruntime.dll from the already-installed onnxruntime-node package
 *    (Microsoft, same C API, backward compatible);
 *  - the 1.5 configs list a few multi-codepoint diphthong keys ("aɪ" ...) that the old binary rejects, so we
 *    write a "<key>.compat.onnx.json" copy without them (espeak "ur" output does not use those diphthongs).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dataDir } from "./config.ts";
import { readWav, resample } from "./wav.ts";

export const PIPER_RELEASE = "2023.11.14-2";
const PIPER_ZIP_URL = `https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}/piper_windows_amd64.zip`;
const require = createRequire(import.meta.url);
const HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

export interface PiperVoice {
  id: string;        // our voice id, e.g. "ur_fasih"
  name: string;
  gender: "male" | "female";
  accent: string;    // "ur-PK"
  lang: "ur" | "ar";
  key: string;       // piper model key, e.g. "ur_PK-fasih-medium"
  hfDir: string;     // folder inside rhasspy/piper-voices
}

export const PIPER_VOICES: PiperVoice[] = [
  { id: "ur_fasih", name: "Fasih (Urdu)", gender: "male", accent: "ur-PK", lang: "ur", key: "ur_PK-fasih-medium", hfDir: "ur/ur_PK/fasih/medium" },
  { id: "ur_aegis_female", name: "Aegis (Urdu)", gender: "female", accent: "ur-PK", lang: "ur", key: "ur_PK-aegis_female-medium", hfDir: "ur/ur_PK/aegis_female/medium" },
  // Arabic (Modern Standard Arabic, espeak "ar"). Same Arabic-script pipeline as Urdu; picked by voice id.
  { id: "ar_kareem", name: "Kareem (Arabic)", gender: "male", accent: "ar-JO", lang: "ar", key: "ar_JO-kareem-medium", hfDir: "ar/ar_JO/kareem/medium" },
];
export const DEFAULT_URDU_VOICE = "ur_fasih";
export const DEFAULT_ARABIC_VOICE = "ar_kareem";

export function piperDir(): string {
  return path.join(dataDir(), "voice-models", "piper");
}

export function isPiperVoice(id?: string): boolean {
  return !!id && PIPER_VOICES.some((v) => v.id === id);
}

function resolvePiperVoice(id?: string): PiperVoice {
  return PIPER_VOICES.find((v) => v.id === id) ?? PIPER_VOICES.find((v) => v.id === DEFAULT_URDU_VOICE)!;
}

async function download(url: string, outFile: string): Promise<void> {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const part = `${outFile}.part`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${url}`);
  const ws = fs.createWriteStream(part);
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!ws.write(value)) await new Promise<void>((r) => ws.once("drain", () => r()));
    }
  } finally {
    await new Promise<void>((r) => ws.end(() => r()));
  }
  fs.renameSync(part, outFile);
}

function run(bin: string, args: string[], opts: { input?: string; cwd?: string; timeoutMs?: number } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, args, { cwd: opts.cwd, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let err = "";
    const timer = setTimeout(() => {
      c.kill();
      reject(new Error(`${path.basename(bin)} timed out`));
    }, opts.timeoutMs ?? 5 * 60_000);
    c.stderr.on("data", (d) => { err += d; if (err.length > 8000) err = err.slice(-8000); });
    c.on("error", (e) => { clearTimeout(timer); reject(e); });
    c.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${err.slice(-1500)}`));
    });
    c.stdin.end(opts.input != null ? Buffer.from(opts.input, "utf8") : undefined);
  });
}

function piperExe(): string {
  return path.join(piperDir(), "piper", process.platform === "win32" ? "piper.exe" : "piper");
}

let binPromise: Promise<string> | null = null;
/** Download + extract the Piper binary once (≈ 22 MB zip). */
export function ensurePiperBinary(): Promise<string> {
  if (!binPromise) {
    binPromise = (async () => {
      const exe = piperExe();
      if (fs.existsSync(exe)) {
        upgradeOnnxRuntime(path.dirname(exe));
        return exe;
      }
      if (process.platform !== "win32") throw new Error("Piper auto-install is only wired up for Windows x64");
      const zip = path.join(piperDir(), "piper_windows_amd64.zip");
      if (!fs.existsSync(zip)) await download(PIPER_ZIP_URL, zip);
      // Windows 10+ ships bsdtar, which extracts .zip files.
      const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
      await run(tar, ["-xf", zip, "-C", piperDir()]);
      if (!fs.existsSync(exe)) throw new Error(`piper.exe missing after extracting ${zip}`);
      fs.rmSync(zip, { force: true });
      upgradeOnnxRuntime(path.dirname(exe));
      return exe;
    })().catch((e) => {
      binPromise = null;
      throw e;
    });
  }
  return binPromise;
}

/** Replace the bundled onnxruntime 1.14 with onnxruntime-node's newer build (see header). Idempotent. */
function upgradeOnnxRuntime(binDir: string): void {
  const marker = path.join(binDir, "onnxruntime.upgraded");
  if (fs.existsSync(marker)) return;
  const pkg = path.dirname(require.resolve("onnxruntime-node/package.json"));
  const src = path.join(pkg, "bin", "napi-v3", "win32", process.arch === "arm64" ? "arm64" : "x64", "onnxruntime.dll");
  if (!fs.existsSync(src)) throw new Error(`onnxruntime.dll not found in onnxruntime-node (${src})`);
  const dst = path.join(binDir, "onnxruntime.dll");
  if (fs.existsSync(dst) && !fs.existsSync(dst + ".orig")) fs.renameSync(dst, dst + ".orig");
  fs.copyFileSync(src, dst);
  fs.writeFileSync(marker, src);
}

/** Write the old-binary-compatible config next to the model (drops multi-codepoint phoneme keys). */
function compatConfig(json: string): string {
  const out = json.replace(/.onnx.json$/, ".compat.onnx.json");
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(json).mtimeMs) return out;
  const cfg = JSON.parse(fs.readFileSync(json, "utf8"));
  for (const k of Object.keys(cfg.phoneme_id_map ?? {})) if ([...k].length > 1) delete cfg.phoneme_id_map[k];
  fs.writeFileSync(out, JSON.stringify(cfg));
  return out;
}

const modelPromises = new Map<string, Promise<string>>();
/** Download a voice's .onnx + .onnx.json once (≈ 64 MB each voice). Returns the .onnx path. */
export function ensurePiperVoice(id?: string): Promise<string> {
  const v = resolvePiperVoice(id);
  let p = modelPromises.get(v.id);
  if (!p) {
    p = (async () => {
      const dir = path.join(piperDir(), "voices");
      const onnx = path.join(dir, `${v.key}.onnx`);
      const json = `${onnx}.json`;
      if (!fs.existsSync(json)) await download(`${HF_BASE}/${v.hfDir}/${v.key}.onnx.json`, json);
      if (!fs.existsSync(onnx)) await download(`${HF_BASE}/${v.hfDir}/${v.key}.onnx`, onnx);
      return onnx;
    })().catch((e) => {
      modelPromises.delete(v.id);
      throw e;
    });
    modelPromises.set(v.id, p);
  }
  return p;
}

/** Text with Arabic-script letters (Urdu) → "ur", otherwise "en". */
export function detectLang(text: string | undefined): "ur" | "en" {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text ?? "") ? "ur" : "en";
}

/** Normalise Urdu text for espeak: collapse whitespace; keep Urdu punctuation (۔ ، ؟) which Piper maps to pauses. */
function cleanUrdu(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Synthesize Urdu text with Piper. Returns float samples resampled to `sampleRate` (24 kHz to match Kokoro).
 * `speed` > 1 is faster (mapped to Piper's length_scale = 1/speed).
 */
export async function piperSamples(text: string, opts: { voice?: string; speed?: number; sampleRate: number }): Promise<Float32Array> {
  const clean = cleanUrdu(text);
  if (!clean) return new Float32Array(0);
  const [exe, model] = await Promise.all([ensurePiperBinary(), ensurePiperVoice(opts.voice)]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-piper-"));
  try {
    const out = path.join(tmp, "out.wav");
    const sp = Math.min(2, Math.max(0.5, opts.speed ?? 1));
    // Piper reads one utterance per line; keep it on one line so sentence pauses come from punctuation.
    await run(exe, ["--model", model, "--config", compatConfig(`${model}.json`), "--output_file", out, "--length_scale", String(Math.round((1 / sp) * 100) / 100), "--sentence_silence", "0.15", "--quiet"], {
      input: clean + "\n",
      cwd: path.dirname(exe), // espeak-ng-data + onnxruntime.dll sit next to piper.exe
    });
    const { samples, sampleRate } = readWav(out);
    return sampleRate === opts.sampleRate ? samples : resample(samples, sampleRate, opts.sampleRate);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
