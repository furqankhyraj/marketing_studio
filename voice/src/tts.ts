import fs from "node:fs";
import path from "node:path";
import { modelsDir } from "./config.ts";
import { writeWav } from "./wav.ts";
import { PIPER_VOICES, DEFAULT_URDU_VOICE, isPiperVoice, detectLang, piperSamples } from "./piper.ts";

/** Narration language. "auto" (default) picks per chunk: Arabic-script text → Urdu (Piper), else English (Kokoro). */
export type VoiceLang = "en" | "ur" | "auto";

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const SAMPLE_RATE = 24000;
export const DEFAULT_VOICE = "af_heart";
const SCENE_GAP_MS = 250;
const SENTENCE_GAP_MS = 120;

export interface VoiceMeta {
  id: string;
  name: string;
  gender: string;
  accent: string;
}

/** Kokoro-82M v1.0 English voices (American "a*", British "b*"; f = female, m = male). */
const VOICES: VoiceMeta[] = [
  ["af_heart", "Heart"], ["af_alloy", "Alloy"], ["af_aoede", "Aoede"], ["af_bella", "Bella"],
  ["af_jessica", "Jessica"], ["af_kore", "Kore"], ["af_nicole", "Nicole"], ["af_nova", "Nova"],
  ["af_river", "River"], ["af_sarah", "Sarah"], ["af_sky", "Sky"],
  ["am_adam", "Adam"], ["am_echo", "Echo"], ["am_eric", "Eric"], ["am_fenrir", "Fenrir"],
  ["am_liam", "Liam"], ["am_michael", "Michael"], ["am_onyx", "Onyx"], ["am_puck", "Puck"],
  ["am_santa", "Santa"],
  ["bf_alice", "Alice"], ["bf_emma", "Emma"], ["bf_isabella", "Isabella"], ["bf_lily", "Lily"],
  ["bm_daniel", "Daniel"], ["bm_fable", "Fable"], ["bm_george", "George"], ["bm_lewis", "Lewis"],
].map(([id, name]) => ({
  id,
  name,
  gender: id[1] === "f" ? "female" : "male",
  accent: id[0] === "a" ? "American" : "British",
}));

export function listVoices(): VoiceMeta[] {
  return [
    ...VOICES.map((v) => ({ ...v })),
    ...PIPER_VOICES.map((v) => ({ id: v.id, name: v.name, gender: v.gender, accent: v.accent })),
  ];
}

// ---- lazy model load (once per process) ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KokoroInstance = any;
let ttsPromise: Promise<KokoroInstance> | null = null;
export let lastLoadInfo: { loadMs: number; dtype: string; cacheDir: string } | null = null;

function getTTS(): Promise<KokoroInstance> {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const t0 = Date.now();
      const cacheDir = modelsDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const hf = await import("@huggingface/transformers");
      hf.env.cacheDir = cacheDir;
      hf.env.allowRemoteModels = true;
      const { KokoroTTS } = await import("kokoro-js");
      const dtype = (process.env.KOKORO_DTYPE as "q8" | "fp32" | undefined) || "q8";
      const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, { dtype, device: "cpu" });
      lastLoadInfo = { loadMs: Date.now() - t0, dtype, cacheDir };
      return tts;
    })().catch((e) => {
      ttsPromise = null; // allow retry next call
      throw e;
    });
  }
  return ttsPromise;
}

/** Pre-load the model (downloads it on first run). */
export async function warmup(): Promise<void> {
  await getTTS();
}

function resolveVoice(voice?: string): string {
  if (voice && VOICES.some((v) => v.id === voice)) return voice;
  return DEFAULT_VOICE;
}

/** Split long text into sentence-ish chunks so Kokoro's ~510-token context is never exceeded. */
function chunkText(text: string, maxChars = 350): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [clean];
  const out: string[] = [];
  let cur = "";
  for (const s0 of sentences) {
    const s = s0.trim();
    if (!s) continue;
    if (s.length > maxChars) {
      if (cur) { out.push(cur); cur = ""; }
      // hard-split on commas / words
      let part = "";
      for (const w of s.split(/(?<=,)\s+|\s+/)) {
        if ((part + " " + w).length > maxChars && part) { out.push(part); part = w; }
        else part = part ? part + " " + w : w;
      }
      if (part) out.push(part);
      continue;
    }
    if ((cur + " " + s).length > maxChars && cur) { out.push(cur); cur = s; }
    else cur = cur ? cur + " " + s : s;
  }
  if (cur) out.push(cur);
  return out;
}

function trimSilence(a: Float32Array, threshold = 0.004, padSamples = Math.round(SAMPLE_RATE * 0.03)): Float32Array {
  let s = 0;
  let e = a.length - 1;
  while (s < a.length && Math.abs(a[s]) < threshold) s++;
  while (e > s && Math.abs(a[e]) < threshold) e--;
  if (s >= e) return new Float32Array(0);
  return a.subarray(Math.max(0, s - padSamples), Math.min(a.length, e + padSamples + 1));
}

function concat(parts: Float32Array[]): Float32Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const silence = (ms: number) => new Float32Array(Math.round((SAMPLE_RATE * ms) / 1000));

/**
 * Raw synthesis to samples (24 kHz mono float). Urdu-script text goes to Piper (Urdu voice); Latin text always
 * goes to Kokoro, so Latin is never fed to the Urdu voice (espeak "ur" can't read Roman Urdu / English).
 */
async function synthSamples(text: string, voice?: string, speed?: number, lang: VoiceLang = "auto"): Promise<Float32Array> {
  // `lang` only steers voice defaults: Urdu-script text always needs Piper (Kokoro can't read it even if "en"
  // was requested), and Latin text always needs Kokoro (even if "ur" was requested).
  void lang;
  if (detectLang(text) === "ur") {
    const uv = isPiperVoice(voice) ? voice : DEFAULT_URDU_VOICE;
    return trimSilence(await piperSamples(text, { voice: uv, speed, sampleRate: SAMPLE_RATE }));
  }
  const tts = await getTTS();
  // A Piper voice id with Latin text: fall back to a Kokoro voice of the same gender.
  const v = isPiperVoice(voice) ? (/female/.test(voice!) ? DEFAULT_VOICE : "am_michael") : resolveVoice(voice);
  const sp = Math.min(2, Math.max(0.5, speed ?? 1));
  const parts: Float32Array[] = [];
  for (const chunk of chunkText(text)) {
    const audio = await tts.generate(chunk, { voice: v, speed: sp });
    const data: Float32Array = audio.audio;
    if (audio.sampling_rate && audio.sampling_rate !== SAMPLE_RATE) {
      throw new Error(`Unexpected Kokoro sample rate ${audio.sampling_rate}`);
    }
    if (parts.length) parts.push(silence(SENTENCE_GAP_MS));
    parts.push(trimSilence(data));
  }
  return concat(parts);
}

export async function synthesize(
  text: string,
  opts: { voice?: string; speed?: number; lang?: VoiceLang; outFile: string },
): Promise<{ path: string; durationMs: number }> {
  const samples = await synthSamples(text, opts.voice, opts.speed, opts.lang);
  const outFile = path.resolve(opts.outFile);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  writeWav(outFile, samples, SAMPLE_RATE);
  return { path: outFile, durationMs: Math.round((samples.length / SAMPLE_RATE) * 1000) };
}

export async function synthesizeScenes(
  scenes: { id: string; text: string }[],
  opts: { voice?: string; speed?: number; lang?: VoiceLang; outDir: string },
): Promise<{ path: string; durationMs: number; scenes: { id: string; startMs: number; endMs: number }[] }> {
  const parts: Float32Array[] = [];
  const timings: { id: string; startMs: number; endMs: number }[] = [];
  let cursor = 0; // samples
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    if (i > 0) {
      const gap = silence(SCENE_GAP_MS);
      parts.push(gap);
      cursor += gap.length;
    }
    const s = sc.text?.trim() ? await synthSamples(sc.text, opts.voice, opts.speed, opts.lang) : new Float32Array(0);
    const startMs = Math.round((cursor / SAMPLE_RATE) * 1000);
    parts.push(s);
    cursor += s.length;
    timings.push({ id: sc.id, startMs, endMs: Math.round((cursor / SAMPLE_RATE) * 1000) });
  }
  const all = concat(parts);
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "voiceover.wav");
  writeWav(outFile, all, SAMPLE_RATE);
  return { path: outFile, durationMs: Math.round((all.length / SAMPLE_RATE) * 1000), scenes: timings };
}
