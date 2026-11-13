/**
 * Social MCP Studio — voice & media package (CONTRACTS.md "Voice & media package").
 * Local, CPU-only, no Python: Kokoro-82M TTS (kokoro-js / onnxruntime-node), whisper.cpp word
 * timings (@remotion/install-whisper-cpp), Pexels / Pixabay stock search.
 */
import fs from "node:fs";
import path from "node:path";
import * as tts from "./tts.ts";
import { transcribeWithWhisper, type Word } from "./whisper.ts";
import { readWav } from "./wav.ts";

export { configure, type VoiceConfig } from "./config.ts";
export { searchStock, downloadStock, type StockItem } from "./stock.ts";
export { listVoices, warmup, type VoiceMeta, type VoiceLang } from "./tts.ts";
export { ensureWhisper } from "./whisper.ts";
export { detectLang, PIPER_VOICES, DEFAULT_URDU_VOICE, ensurePiperBinary, ensurePiperVoice } from "./piper.ts";
import { detectLang } from "./piper.ts";
import type { VoiceLang } from "./tts.ts";

/**
 * Sidecar written next to each synthesized wav so transcribeWords can align / estimate word timings.
 * captionText (optional): what captions should show for that scene when it differs from the spoken text,
 * e.g. a Roman Urdu transliteration of Urdu-script narration. lang: language of the narration.
 */
type SidecarScene = { id: string; text: string; captionText?: string; startMs: number; endMs: number };
type Sidecar = { lang?: "en" | "ur"; scenes: SidecarScene[] };
/** Scene input for synthesizeScenes. */
export type SceneInput = { id: string; text: string; captionText?: string };
const sidecarPath = (wav: string) => `${wav}.scenes.json`;

function writeSidecar(wav: string, data: Sidecar) {
  try { fs.writeFileSync(sidecarPath(wav), JSON.stringify(data)); } catch { /* non-fatal */ }
}

/** Narration language for a set of texts: "ur" when at least half of the text is Urdu (Arabic) script. */
function narrationLang(texts: string[], lang?: VoiceLang): "en" | "ur" {
  const ur = texts.filter((t) => detectLang(t) === "ur").join("").length;
  if (lang === "en" && !ur) return "en";
  if (lang === "ur" && ur) return "ur";
  const all = texts.join("").length;
  return all && ur / all >= 0.5 ? "ur" : "en";
}

export async function synthesize(
  text: string,
  opts: { voice?: string; speed?: number; lang?: VoiceLang; outFile: string },
): Promise<{ path: string; durationMs: number }> {
  const r = await tts.synthesize(text, opts);
  writeSidecar(r.path, { lang: narrationLang([text], opts.lang), scenes: [{ id: "all", text, startMs: 0, endMs: r.durationMs }] });
  return r;
}

/**
 * One narration for all scenes. Urdu-script scene text is voiced by Piper (Urdu voice: opts.voice when it is
 * "ur_fasih"/"ur_aegis_female", else ur_fasih); Latin text by Kokoro. Same wav format + sidecar either way.
 */
export async function synthesizeScenes(
  scenes: SceneInput[],
  opts: { voice?: string; speed?: number; lang?: VoiceLang; outDir: string },
): Promise<{ path: string; durationMs: number; scenes: { id: string; startMs: number; endMs: number }[] }> {
  const r = await tts.synthesizeScenes(scenes, opts);
  writeSidecar(r.path, {
    lang: narrationLang(scenes.map((s) => s.text ?? ""), opts.lang),
    scenes: r.scenes.map((s, i) => ({
      ...s,
      text: scenes[i]?.text ?? "",
      ...(scenes[i]?.captionText?.trim() ? { captionText: scenes[i].captionText!.trim() } : {}),
    })),
  });
  return r;
}

/** Which method produced the last transcribeWords result ("whisper" | "estimate" | "none"). */
export let lastTranscribeMethod: "whisper" | "estimate" | "none" = "none";
export let lastTranscribeError: string | undefined;

/**
 * Estimate word timings from the per-scene spans recorded at synthesis time: each word gets a slice
 * of its scene proportional to its character length (plus a small constant for short words).
 */
export function estimateWordTimings(scenes: Pick<SidecarScene, "text" | "startMs" | "endMs">[]): Word[] {
  const out: Word[] = [];
  for (const s of scenes) out.push(...spreadWords(s.text.split(/\s+/).filter(Boolean), s.startMs, s.endMs));
  return out;
}

/** Give each word a slice of [startMs, endMs] proportional to its letter count (+2 so short words stay readable). */
function spreadWords(words: string[], startMs: number, endMs: number): Word[] {
  if (!words.length) return [];
  const weights = words.map((w) => w.replace(/[^\p{L}\p{N}\p{M}]/gu, "").length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(1, endMs - startMs);
  let t = startMs;
  return words.map((w, i) => {
    const d = (span * weights[i]) / total;
    const word = { text: w, startMs: Math.round(t), endMs: Math.round(t + d) };
    t += d;
    return word;
  });
}

/**
 * Urdu: whisper's Urdu *text* is unreliable (often Hindi script or misspelt), so only its *timings* are used.
 * Per scene, the heard words inside that scene's audio span are matched to the known script words in order
 * when the counts agree; otherwise the script words are spread by letter count over the voiced part of the
 * span (first heard start to last heard end), or over the whole span when whisper heard little there.
 */
export function alignUrduToScript(heard: Word[], scenes: SidecarScene[], fallback?: (s: SidecarScene) => Word[]): Word[] {
  const out: Word[] = [];
  for (const s of scenes) {
    const script = s.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
    if (!script.length) continue;
    const inSpan = heard.filter((w) => {
      const mid = (w.startMs + w.endMs) / 2;
      return mid >= s.startMs - 80 && mid <= s.endMs + 80;
    });
    if (inSpan.length === script.length) {
      script.forEach((text, i) => {
        const next = inSpan[i + 1];
        const startMs = Math.max(s.startMs, inSpan[i].startMs);
        const endMs = Math.min(s.endMs, next ? Math.max(inSpan[i].endMs, Math.min(next.startMs, inSpan[i].endMs + 400)) : Math.max(inSpan[i].endMs, s.endMs));
        out.push({ text, startMs, endMs: Math.max(endMs, startMs + 60) });
      });
    } else if (fallback) {
      out.push(...fallback(s));
    } else {
      const from = inSpan.length ? Math.max(s.startMs, Math.min(...inSpan.map((w) => w.startMs))) : s.startMs;
      const to = inSpan.length ? Math.min(s.endMs, Math.max(...inSpan.map((w) => w.endMs))) : s.endMs;
      // A short voiced region usually means whisper only caught a fragment: use the full span instead.
      const full = to - from < (s.endMs - s.startMs) * 0.6;
      out.push(...spreadWords(script, full ? s.startMs : from, full ? s.endMs : to));
    }
  }
  return out;
}

/**
 * Pause-aware estimate for one narration file (used for Urdu when whisper is unavailable / disagrees).
 * Piper leaves short silences at sentence and comma boundaries, so each scene's script is split into
 * punctuation chunks, the longest silences inside the scene's span become chunk boundaries, and words are
 * spread by letter count inside each voiced chunk. Falls back to the plain span estimate.
 */
function pauseEstimator(wavFile: string): (s: Pick<SidecarScene, "text" | "startMs" | "endMs">) => Word[] {
  let rms: Float32Array | null = null;
  const FRAME_MS = 10;
  try {
    const { samples, sampleRate } = readWav(wavFile);
    const hop = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
    rms = new Float32Array(Math.ceil(samples.length / hop));
    for (let f = 0; f < rms.length; f++) {
      let acc = 0;
      const end = Math.min(samples.length, (f + 1) * hop);
      for (let i = f * hop; i < end; i++) acc += samples[i] * samples[i];
      rms[f] = Math.sqrt(acc / Math.max(1, end - f * hop));
    }
  } catch { /* unreadable: plain estimate */ }
  const peak = rms ? rms.reduce((m, v) => (v > m ? v : m), 0) : 0;
  const thr = Math.max(0.003, peak * 0.05);
  return (s) => {
    const words = s.text.split(/\s+/).filter(Boolean);
    if (!rms || !words.length) return spreadWords(words, s.startMs, s.endMs);
    const f0 = Math.floor(s.startMs / FRAME_MS), f1 = Math.min(rms.length, Math.ceil(s.endMs / FRAME_MS));
    // voiced extent inside the span
    let a = f0, b = f1 - 1;
    while (a < b && rms[a] < thr) a++;
    while (b > a && rms[b] < thr) b--;
    const vStart = a * FRAME_MS, vEnd = (b + 1) * FRAME_MS;
    // punctuation chunks
    const chunks: string[][] = [[]];
    for (const w of words) {
      chunks[chunks.length - 1].push(w);
      if (/[.,!?;:،؛؟۔]$/.test(w)) chunks.push([]);
    }
    if (!chunks[chunks.length - 1].length) chunks.pop();
    if (chunks.length < 2) return spreadWords(words, vStart, vEnd);
    // silent runs >= 80 ms strictly inside the voiced extent
    const runs: { start: number; end: number }[] = [];
    for (let f = a + 1; f < b; f++) {
      if (rms[f] >= thr) continue;
      let g = f;
      while (g < b && rms[g] < thr) g++;
      if ((g - f) * FRAME_MS >= 80) runs.push({ start: f * FRAME_MS, end: g * FRAME_MS });
      f = g;
    }
    const need = chunks.length - 1;
    // Each boundary's expected time comes from letter counts; snap it to the best nearby silence (long and
    // close), else keep the expected time. Keeps one odd gap (e.g. a stop consonant) from skewing a chunk.
    const letters = (c: string[]) => c.reduce((n, w) => n + w.replace(/[^\p{L}\p{N}\p{M}]/gu, "").length + 2, 0);
    const total = chunks.reduce((n, c) => n + letters(c), 0);
    const span = vEnd - vStart;
    const cuts: { start: number; end: number }[] = [];
    let acc = 0;
    for (let i = 0; i < need; i++) {
      acc += letters(chunks[i]);
      const exp = vStart + (span * acc) / total;
      const prevEnd = cuts.length ? cuts[cuts.length - 1].end : vStart;
      let best: { start: number; end: number } | undefined;
      let bestScore = 0;
      for (const r of runs) {
        if (r.start <= prevEnd) continue;
        const score = (r.end - r.start) - 0.35 * Math.abs((r.start + r.end) / 2 - exp);
        if (score > bestScore) { bestScore = score; best = r; }
      }
      cuts.push(best ?? { start: Math.max(prevEnd, exp), end: Math.max(prevEnd, exp) });
    }
    const out: Word[] = [];
    chunks.forEach((c, i) => {
      const from = i === 0 ? vStart : cuts[i - 1].end;
      const to = i === need ? vEnd : cuts[i].start;
      out.push(...spreadWords(c, from, Math.max(from + 60 * c.length, to)));
    });
    return out;
  };
}

/** Urdu estimate for all scenes of a narration file (pause-aware). */
export function estimateWithPauses(wavFile: string, scenes: Pick<SidecarScene, "text" | "startMs" | "endMs">[]): Word[] {
  const est = pauseEstimator(wavFile);
  return scenes.flatMap((s) => est(s));
}

/**
 * Replace the words of scenes that carry captionText (e.g. Roman Urdu) with that text, keeping the timings:
 * 1:1 when word counts match, otherwise spread over the scene's spoken range by letter count.
 */
function applyCaptionText(words: Word[], scenes: SidecarScene[]): Word[] {
  if (!scenes.some((s) => s.captionText)) return words;
  const out: Word[] = [];
  const used = new Set<Word>();
  for (const s of scenes) {
    const mine = words.filter((w) => !used.has(w) && w.startMs >= s.startMs - 80 && w.startMs <= s.endMs + 80);
    mine.forEach((w) => used.add(w));
    if (!s.captionText) { out.push(...mine); continue; }
    const cap = s.captionText.split(/\s+/).filter(Boolean);
    if (cap.length === mine.length) out.push(...mine.map((w, i) => ({ ...w, text: cap[i] })));
    else out.push(...spreadWords(cap, mine.length ? mine[0].startMs : s.startMs, mine.length ? mine[mine.length - 1].endMs : s.endMs));
  }
  out.push(...words.filter((w) => !used.has(w))); // outside every scene span (unexpected): keep
  return out.sort((a, b) => a.startMs - b.startMs);
}

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Align whisper's words to the known script so captions use the script's spelling (brand names like
 * "Saqqa" are often misheard) while keeping whisper's timings. Levenshtein alignment over words;
 * script words whisper dropped get interpolated time slots.
 */
export function alignToScript(heard: Word[], scriptText: string): Word[] {
  const script = scriptText.split(/\s+/).filter((w) => norm(w));
  if (!heard.length || !script.length) return heard;
  const n = script.length, m = heard.length;
  const cost = (i: number, j: number) => {
    const a = norm(script[i]), b = norm(heard[j].text);
    if (a === b) return 0;
    return a[0] === b[0] || a.includes(b) || b.includes(a) ? 0.5 : 1;
  };
  const dp: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = Math.min(dp[i - 1][j - 1] + cost(i - 1, j - 1), dp[i - 1][j] + 1, dp[i][j - 1] + 1);
  // backtrack: map script index -> heard index (or -1)
  const map = new Array<number>(n).fill(-1);
  for (let i = n, j = m; i > 0 && j >= 0; ) {
    if (j > 0 && dp[i][j] === dp[i - 1][j - 1] + cost(i - 1, j - 1)) { map[i - 1] = j - 1; i--; j--; }
    else if (dp[i][j] === dp[i - 1][j] + 1 || j === 0) { i--; }
    else { j--; }
  }
  // Too different (e.g. wrong file / different text) → keep whisper's own words.
  if (map.filter((x) => x >= 0).length < n * 0.6) return heard;
  const out: Word[] = script.map((text, i) => (map[i] >= 0 ? { text, startMs: heard[map[i]].startMs, endMs: heard[map[i]].endMs } : { text, startMs: -1, endMs: -1 }));
  // Fill unmatched words by splitting the gap between neighbours.
  for (let i = 0; i < n; i++) {
    if (out[i].startMs >= 0) continue;
    let k = i;
    while (k < n && out[k].startMs < 0) k++;
    const from = i > 0 ? out[i - 1].endMs : (k < n ? Math.max(0, out[k].startMs - 300 * (k - i)) : 0);
    const to = k < n ? out[k].startMs : from + 300 * (k - i);
    const step = Math.max(0, to - from) / (k - i);
    for (let x = i; x < k; x++) { out[x].startMs = Math.round(from + step * (x - i)); out[x].endMs = Math.round(from + step * (x - i + 1)); }
    i = k - 1;
  }
  return out;
}

/**
 * Word-level timings for an audio file. Uses whisper.cpp; if that fails (install/run error) and the
 * file was produced by synthesize/synthesizeScenes, falls back to proportional estimates.
 */
export async function transcribeWords(
  audioFile: string,
  opts: { lang?: VoiceLang } = {},
): Promise<{ text: string; startMs: number; endMs: number }[]> {
  const abs = path.resolve(audioFile);
  let sidecar: Sidecar | null = null;
  try { sidecar = JSON.parse(fs.readFileSync(sidecarPath(abs), "utf8")); } catch { /* not ours */ }
  // Language: explicit opt > recorded at synthesis > script detection on the sidecar text.
  const lang: "en" | "ur" =
    opts.lang === "en" || opts.lang === "ur" ? opts.lang
    : sidecar?.lang ?? (sidecar ? narrationLang(sidecar.scenes.map((s) => s.text)) : "en");
  if (process.env.VOICE_DISABLE_WHISPER !== "1") {
    try {
      // Urdu uses the multilingual ggml-small model with -l ur (timings only, see alignUrduToScript).
      const words = await transcribeWithWhisper(abs, { lang });
      lastTranscribeMethod = "whisper";
      lastTranscribeError = undefined;
      if (!sidecar) return words;
      const aligned = lang === "ur"
        ? alignUrduToScript(words, sidecar.scenes, pauseEstimator(abs))
        : alignToScript(words, sidecar.scenes.map((s) => s.text).join(" "));
      return applyCaptionText(aligned, sidecar.scenes);
    } catch (e: any) {
      lastTranscribeError = String(e?.message ?? e);
      console.warn(`[voice] whisper.cpp failed, using estimated word timings: ${lastTranscribeError}`);
    }
  }
  if (sidecar) {
    lastTranscribeMethod = "estimate";
    const est = lang === "ur" ? estimateWithPauses(abs, sidecar.scenes) : estimateWordTimings(sidecar.scenes);
    return applyCaptionText(est, sidecar.scenes);
  }
  lastTranscribeMethod = "none";
  return [];
}
