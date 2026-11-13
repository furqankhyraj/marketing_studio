// Long-video transcription for clips: 16 kHz mono wav extraction (ffmpeg-static), audio energy, whisper.cpp in
// CHUNKS (each chunk's result is persisted, so a crash/restart only redoes the current chunk), and transcript
// import (SRT / VTT / JSON). Child processes run at below-normal priority so reel renders keep the CPU.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import type { ClipTranscript, ClipWord, TranscriptSegment } from "../../shared/types.ts";
import { DATA_DIR, ROOT_DIR } from "./config.ts";
import { FFMPEG, FFPROBE } from "./audio.ts";

export const SAMPLE_RATE = 16000;
export const CHUNK_SEC = Number(process.env.CLIPS_CHUNK_SEC) || 300; // 5-minute pieces
export const CHUNK_OVERLAP_SEC = 2;
export const ENERGY_FRAME_MS = 100;
const THREADS = Math.max(1, Math.min(8, Number(process.env.CLIPS_WHISPER_THREADS) || Math.ceil(os.cpus().length / 2)));

/**
 * Whisper models. English → base.en. Urdu / auto → a multilingual model: "base" by default (ggml-small is ~3–4×
 * slower on this CPU and would make an hour-long lesson take hours; see README). Override with CLIPS_UR_MODEL=small.
 */
export const EN_MODEL = "base.en";
export const MULTI_MODEL = (process.env.CLIPS_UR_MODEL || "base") as "base" | "small" | "tiny" | "medium";
/** Rough realtime factors (processing sec per audio sec) used for the ETA before the first chunk has finished. */
const PRIOR_RTF: Record<string, number> = { "base.en": 0.5, base: 0.95, small: 2.1, tiny: 0.25, medium: 6 }; // measured on the i7-1185G7 (4 threads, busy machine)
export const priorRtf = (model: string) => PRIOR_RTF[model] ?? 0.3;
/** Initial prompt nudging whisper towards Urdu script (instead of Hindi/Devanagari) for Urdu speech. */
const URDU_PROMPT = "یہ اردو زبان میں ایک سبق ہے۔ آج ہم سیکھیں گے کہ یہ کیسے کرتے ہیں۔";

// ---------------------------------------------------------------- process helpers
/** Child processes run below normal priority (reel renders and the UI stay snappy). CLIPS_PRIORITY=normal disables it. */
export function lowPriority(p: ChildProcess) {
  if (process.env.CLIPS_PRIORITY === "normal") return;
  try {
    if (p.pid) os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    /* not permitted: fine */
  }
}

export interface RunOpts {
  onStdout?: (s: string) => void;
  onStderr?: (s: string) => void;
  onSpawn?: (p: ChildProcess) => void;
  timeoutMs?: number;
}
export function runProc(bin: string | undefined, args: string[], o: RunOpts = {}): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    if (!bin) return reject(new Error("ffmpeg/ffprobe not found (run npm install inside hyperframes/)"));
    const p = spawn(bin, args, { windowsHide: true });
    lowPriority(p);
    o.onSpawn?.(p);
    let stderr = "";
    const timer = o.timeoutMs ? setTimeout(() => p.kill(), o.timeoutMs) : undefined;
    p.stdout.on("data", (d) => o.onStdout?.(String(d)));
    p.stderr.on("data", (d) => {
      const s = String(d);
      stderr = (stderr + s).slice(-20_000);
      o.onStderr?.(s);
    });
    p.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stderr });
      else reject(new Error(`${path.basename(bin)} ${signal ? `killed (${signal})` : `exited ${code}`}: ${stderr.slice(-1200)}`));
    });
  });
}

/** Parses ffmpeg `-progress pipe:1` output into seconds processed. */
export function ffProgress(onSec: (sec: number) => void) {
  let buf = "";
  return (s: string) => {
    buf += s;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const l of lines) {
      const m = l.match(/^out_time_(?:us|ms)=(\d+)/);
      if (m) onSec(Number(m[1]) / 1e6);
    }
  };
}

export async function probeVideo(file: string): Promise<{ durationMs: number; width?: number; height?: number; hasAudio: boolean; hasVideo: boolean }> {
  let out = "";
  await runProc(FFPROBE, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file], { onStdout: (s) => (out += s) });
  const j = JSON.parse(out || "{}");
  const streams: any[] = j.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  return {
    durationMs: Math.round((Number(j.format?.duration) || 0) * 1000),
    width: v?.width,
    height: v?.height,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    hasVideo: !!v,
  };
}

// ---------------------------------------------------------------- audio extraction + energy
/** Extract 16 kHz mono 16-bit wav. Writes to a temp name and renames, so a half-written file is never reused. */
export async function extractWav(src: string, out: string, durationSec: number, onProgress: (p: number) => void, onSpawn?: (p: ChildProcess) => void) {
  const tmp = out + ".part.wav";
  await runProc(FFMPEG, ["-hide_banner", "-nostats", "-loglevel", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", "-progress", "pipe:1", tmp], {
    onStdout: ffProgress((sec) => durationSec > 0 && onProgress(Math.min(0.99, sec / durationSec))),
    onSpawn,
  });
  fs.renameSync(tmp, out);
}

/** Byte offset + length of the PCM data chunk of a wav file. */
export function wavData(file: string): { offset: number; bytes: number; sampleRate: number; channels: number } {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a wav file");
    let pos = 12;
    let sampleRate = SAMPLE_RATE;
    let channels = 1;
    const size = fs.fstatSync(fd).size;
    const ch = Buffer.alloc(8);
    while (pos + 8 <= size) {
      fs.readSync(fd, ch, 0, 8, pos);
      const id = ch.toString("ascii", 0, 4);
      const len = ch.readUInt32LE(4);
      if (id === "fmt ") {
        const fmt = Buffer.alloc(16);
        fs.readSync(fd, fmt, 0, 16, pos + 8);
        channels = fmt.readUInt16LE(2);
        sampleRate = fmt.readUInt32LE(4);
      }
      if (id === "data") return { offset: pos + 8, bytes: Math.min(len || size - pos - 8, size - pos - 8), sampleRate, channels };
      pos += 8 + len + (len % 2);
    }
    throw new Error("wav has no data chunk");
  } finally {
    fs.closeSync(fd);
  }
}

function wavHeader(dataBytes: number, sampleRate = SAMPLE_RATE): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** Copy [startSec, endSec) of a 16 kHz mono wav into its own wav file. */
export function sliceWav(src: string, out: string, startSec: number, endSec: number) {
  const d = wavData(src);
  const bps = d.sampleRate * 2 * d.channels;
  const a = Math.max(0, Math.floor(startSec * d.sampleRate)) * 2 * d.channels;
  const b = Math.min(d.bytes, Math.floor(endSec * d.sampleRate) * 2 * d.channels);
  const len = Math.max(0, b - a);
  const fdIn = fs.openSync(src, "r");
  const fdOut = fs.openSync(out, "w");
  try {
    fs.writeSync(fdOut, wavHeader(len, d.sampleRate));
    const buf = Buffer.alloc(Math.min(len, bps * 30) || 1);
    let done = 0;
    while (done < len) {
      const n = fs.readSync(fdIn, buf, 0, Math.min(buf.length, len - done), d.offset + a + done);
      if (n <= 0) break;
      fs.writeSync(fdOut, buf, 0, n);
      done += n;
    }
  } finally {
    fs.closeSync(fdIn);
    fs.closeSync(fdOut);
  }
}

export function wavDurationSec(file: string): number {
  const d = wavData(file);
  return d.bytes / (d.sampleRate * 2 * d.channels);
}

/** RMS per 100 ms frame in dBFS (rounded), streamed so hour-long files need little memory. */
export function computeEnergy(wav: string): number[] {
  const d = wavData(wav);
  const frame = Math.round((d.sampleRate * ENERGY_FRAME_MS) / 1000) * 2 * d.channels;
  const fd = fs.openSync(wav, "r");
  const out: number[] = [];
  try {
    const buf = Buffer.alloc(frame * 200);
    let pos = 0;
    while (pos < d.bytes) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, d.bytes - pos), d.offset + pos);
      if (n <= 0) break;
      for (let f = 0; f + 2 <= n; f += frame) {
        const end = Math.min(n, f + frame);
        let acc = 0;
        let cnt = 0;
        for (let i = f; i + 1 < end; i += 2 * d.channels) {
          const v = buf.readInt16LE(i) / 32768;
          acc += v * v;
          cnt++;
        }
        const rms = Math.sqrt(acc / Math.max(1, cnt));
        out.push(Math.round(Math.max(-90, 20 * Math.log10(rms + 1e-9)) * 10) / 10);
      }
      pos += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return out;
}

// ---------------------------------------------------------------- whisper.cpp
type VoiceWhisper = {
  ensureWhisper(model?: string): Promise<void>;
  tokensToWords(json: any): ClipWord[];
  WHISPER_CPP_VERSION: string;
};
let vw: Promise<VoiceWhisper> | undefined;
function voiceWhisper(): Promise<VoiceWhisper> {
  vw ??= import(pathToFileURL(path.join(ROOT_DIR, "voice", "src", "whisper.ts")).href) as Promise<VoiceWhisper>;
  return vw;
}
function whisperDir() {
  return path.join(DATA_DIR, "whisper");
}
function whisperExe(version: string) {
  // whisper.cpp 1.5.x prebuilt Windows zip (installed by @remotion/install-whisper-cpp) ships main.exe
  const [ma, mi, pa] = version.split(".").map(Number);
  const newLayout = ma > 1 || (ma === 1 && (mi > 7 || (mi === 7 && pa >= 4)));
  const bin = newLayout ? path.join("build", "bin", "whisper-cli") : "main";
  return path.join(whisperDir(), `whisper.cpp-${version}`, process.platform === "win32" ? bin + ".exe" : bin);
}
export function modelPath(model: string) {
  return path.join(whisperDir(), "models", `ggml-${model}.bin`);
}

/** Install whisper.cpp and download the model if needed (same official source the voice package uses). */
export async function ensureModel(model: string): Promise<void> {
  const w = await voiceWhisper();
  // voice/src/whisper.ts resolves its data dir from DATA_DIR too (configure() or env), so both share data/whisper.
  process.env.DATA_DIR ||= DATA_DIR;
  await w.ensureWhisper(model as any);
  if (!fs.existsSync(modelPath(model))) throw new Error(`whisper model missing after download: ${modelPath(model)}`);
}

export interface ChunkResult {
  index: number;
  startMs: number;              // nominal chunk start in the source
  endMs: number;
  language?: string;
  segments: TranscriptSegment[];
  procMs: number;               // wall time spent
  audioMs: number;
}

/**
 * Transcribe one wav file with whisper.cpp (greedy, token timestamps via -ojf). Returns segments with words, times
 * relative to the file start. `-pp` progress lines are reported through onProgress (0..1).
 */
export async function whisperFile(
  wav: string,
  opts: { model: string; lang: string; onProgress?: (p: number) => void; onSpawn?: (p: ChildProcess) => void; durationMs?: number; detectOnly?: boolean },
): Promise<{ segments: TranscriptSegment[]; language?: string }> {
  const w = await voiceWhisper();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-clips-"));
  try {
    const outBase = path.join(tmp, "out");
    const args = ["-f", wav, "-m", modelPath(opts.model), "-l", opts.lang, "-t", String(THREADS), "-bs", "1", "-bo", "1", "-ojf", "-of", outBase, "-pp"];
    if (opts.lang === "ur") args.push("--prompt", URDU_PROMPT);
    if (opts.durationMs) args.push("-d", String(Math.round(opts.durationMs)));
    let detected: string | undefined;
    await runProc(whisperExe(w.WHISPER_CPP_VERSION), args, {
      onSpawn: opts.onSpawn,
      onStderr: (s) => {
        for (const m of s.matchAll(/progress\s*=\s*(\d+)%/g)) opts.onProgress?.(Number(m[1]) / 100);
        const d = s.match(/auto-detected language:\s*([a-z]{2,3})/);
        if (d) detected = d[1];
      },
      timeoutMs: 60 * 60_000,
    });
    if (opts.detectOnly) return { segments: [], language: detected };
    const json = JSON.parse(fs.readFileSync(`${outBase}.json`, "utf8"));
    const language = json?.result?.language || detected;
    const segments: TranscriptSegment[] = [];
    for (const item of json.transcription ?? []) {
      const text = String(item.text ?? "").trim();
      if (!text || /^\[.*\]$|^\(.*\)$/.test(text)) continue; // [Music], (silence)
      const startMs = Number(item.offsets?.from) || 0;
      const endMs = Number(item.offsets?.to) || startMs;
      // whisper glues currency symbols to the previous word ("pay$150"): split them back out
      let words = w.tokensToWords({ transcription: [item] }).flatMap((x) => {
        const m = x.text.match(/^(.*\p{L})([$£€₹]\d.*)$/u);
        if (!m) return [x];
        const mid = Math.round((x.startMs + x.endMs) / 2);
        return [{ text: m[1], startMs: x.startMs, endMs: mid }, { text: m[2], startMs: mid, endMs: x.endMs }];
      });
      words = words.map((x) => ({ text: x.text, startMs: Math.max(startMs, x.startMs), endMs: Math.min(Math.max(endMs, x.startMs + 60), Math.max(x.endMs, x.startMs + 60)) }));
      // Non-Latin scripts (Urdu): a token can hold half of a multi-byte letter, which decodes as U+FFFD. The segment
      // text is always whole, so take the spelling from it — keeping token timings when the word counts agree.
      const textWords = text.split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x));
      if (textWords.length === words.length) words = words.map((x, i) => ({ ...x, text: textWords[i] }));
      else if (words.some((x) => x.text.includes("�"))) words = estimateWords(text, startMs, endMs);
      segments.push({ startMs, endMs, text, words: words.length ? words : undefined });
    }
    return { segments, language };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Whisper's code for Urdu speech is sometimes "hi" (Hindi). For this app's audience treat it as Urdu. */
export function normalizeDetected(lang: string | undefined): "en" | "ur" | string {
  if (!lang) return "en";
  if (lang === "hi" || lang === "pa" || lang === "ur") return "ur";
  return lang;
}

/** Chunk plan: nominal [k*L, (k+1)*L) ranges; each is transcribed with OVERLAP seconds of context on both sides. */
export function planChunks(durationSec: number, chunkSec = CHUNK_SEC): { index: number; start: number; end: number }[] {
  const n = Math.max(1, Math.ceil(durationSec / chunkSec - 0.02));
  return Array.from({ length: n }, (_, k) => ({ index: k, start: k * chunkSec, end: k === n - 1 ? durationSec : (k + 1) * chunkSec }));
}

/**
 * Merge chunk results: a segment belongs to the chunk whose nominal range contains its midpoint, and near-duplicate
 * segments at the seams (same words heard twice in the overlap) are dropped.
 */
export function mergeChunks(chunks: ChunkResult[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const c of [...chunks].sort((a, b) => a.index - b.index)) {
    for (const s of c.segments) {
      const mid = (s.startMs + s.endMs) / 2;
      if (mid < c.startMs || mid >= c.endMs) continue;
      const prev = out[out.length - 1];
      if (prev && s.startMs < prev.endMs - 400) {
        const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
        if (norm(prev.text).includes(norm(s.text)) || norm(s.text).includes(norm(prev.text))) continue;
        s.startMs = Math.max(s.startMs, prev.endMs);
        if (s.words) s.words = s.words.filter((w) => w.startMs >= prev.endMs - 100);
      }
      out.push(s);
    }
  }
  return out;
}

/** Shift segment times by `ms` (chunk offset). */
export function shiftSegments(segs: TranscriptSegment[], ms: number): TranscriptSegment[] {
  return segs.map((s) => ({
    ...s,
    startMs: s.startMs + ms,
    endMs: s.endMs + ms,
    words: s.words?.map((w) => ({ ...w, startMs: w.startMs + ms, endMs: w.endMs + ms })),
  }));
}

// ---------------------------------------------------------------- transcript import (SRT / VTT / JSON)
function parseTime(t: string): number {
  const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return NaN;
  const [, h, mi, s, ms] = m;
  return ((Number(h ?? 0) * 60 + Number(mi)) * 60 + Number(s)) * 1000 + Number((ms ?? "0").padEnd(3, "0"));
}

/** Spread a segment's words over its time range by letter count (imported transcripts have no word timings). */
export function estimateWords(text: string, startMs: number, endMs: number): ClipWord[] {
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (!words.length) return [];
  const weights = words.map((w) => w.replace(/[^\p{L}\p{N}\p{M}]/gu, "").length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(1, endMs - startMs);
  let t = startMs;
  return words.map((w, i) => {
    const d = (span * weights[i]) / total;
    const r = { text: w, startMs: Math.round(t), endMs: Math.round(t + d) };
    t += d;
    return r;
  });
}

/** Parse SRT / WebVTT text, or JSON ([{start,end,text}] in seconds or ms, or a ClipTranscript). */
export function parseTranscript(input: string, durationMs?: number): TranscriptSegment[] {
  const s = String(input ?? "").replace(/^﻿/, "").trim();
  if (!s) throw new Error("transcript is empty");
  if (/^[[{]/.test(s)) {
    const j = JSON.parse(s);
    const arr: any[] = Array.isArray(j) ? j : Array.isArray(j.segments) ? j.segments : Array.isArray(j.transcription) ? j.transcription : [];
    if (!arr.length) throw new Error("JSON transcript needs an array of {start, end, text} (or {segments: [...]})");
    const ms = (v: any, key: string) => {
      if (v == null) return NaN;
      if (typeof v === "string") return parseTime(v);
      return /ms$/i.test(key) ? Number(v) : Number(v) * 1000;
    };
    return arr
      .map((x) => {
        const sk = "startMs" in x ? "startMs" : "start" in x ? "start" : "from";
        const ek = "endMs" in x ? "endMs" : "end" in x ? "end" : "to";
        const startMs = Math.round(ms(x[sk] ?? x.offsets?.from / 1000, sk));
        const endMs = Math.round(ms(x[ek] ?? x.offsets?.to / 1000, ek));
        const text = String(x.text ?? "").trim();
        return { startMs, endMs, text, words: Array.isArray(x.words) && x.words.length ? x.words : estimateWords(text, startMs, endMs) };
      })
      .filter((x) => x.text && Number.isFinite(x.startMs) && Number.isFinite(x.endMs) && x.endMs > x.startMs);
  }
  const segs: TranscriptSegment[] = [];
  for (const block of s.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split("-->");
    const startMs = parseTime(a);
    const endMs = parseTime(b.trim().split(/\s+/)[0]);
    const text = lines.slice(ti + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    segs.push({ startMs, endMs, text, words: estimateWords(text, startMs, endMs) });
  }
  if (!segs.length) throw new Error("Could not read the transcript: paste SRT or WebVTT (with --> timestamps) or JSON segments");
  if (durationMs) return segs.filter((x) => x.startMs < durationMs + 1000);
  return segs;
}

export function transcriptFromSegments(segments: TranscriptSegment[], o: { language: string; model?: string; source: "whisper" | "import"; durationMs: number }): ClipTranscript {
  return { version: 1, language: o.language, model: o.model, source: o.source, durationMs: o.durationMs, segments, createdAt: new Date().toISOString() };
}

/** SRT text for a transcript (download / reuse). */
export function toSrt(t: ClipTranscript): string {
  const ts = (ms: number) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(Math.round(ms % 1000)).padStart(3, "0")}`;
  };
  return t.segments.map((s, i) => `${i + 1}\n${ts(s.startMs)} --> ${ts(s.endMs)}\n${s.text}\n`).join("\n");
}
