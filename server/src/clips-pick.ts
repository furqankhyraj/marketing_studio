// Moment picking for long video → short clips. Pure functions (no DB) so they are unit-testable.
//  - sentences(): words/segments → sentences (punctuation or pauses)
//  - pickHeuristic(): no-LLM scoring (hook phrases incl. Urdu, audio energy, speech rate, brand keywords, clean
//    start/end, duration), greedy non-overlapping selection
//  - pickWithLlm(): Claude reads the timestamped transcript in chunks and proposes moments; results are snapped to
//    sentence boundaries and de-duplicated
import type { ClipMoment, ClipTranscript, ClipWord, TranscriptSegment } from "../../shared/types.ts";
import { ENERGY_FRAME_MS, estimateWords } from "./clips-transcribe.ts";

export interface Sentence {
  startMs: number;
  endMs: number;
  text: string;
  words: ClipWord[];
}

const END_PUNCT = /[.!?۔؟…]["'”’)]*$/;
const PAUSE_MS = 800;

/** All words of a transcript in order (estimated for segments without word timings). */
export function allWords(t: Pick<ClipTranscript, "segments">): ClipWord[] {
  const out: ClipWord[] = [];
  for (const s of t.segments) {
    const ws = s.words?.length ? s.words : estimateWords(s.text, s.startMs, s.endMs);
    for (const w of ws) if (!out.length || w.startMs >= out[out.length - 1].startMs) out.push(w);
  }
  return out;
}

/** Split into sentences at end punctuation, long pauses, or very long runs (> 20 s, at the next comma/pause). */
export function sentences(t: Pick<ClipTranscript, "segments">): Sentence[] {
  const words = allWords(t);
  const out: Sentence[] = [];
  let cur: ClipWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ startMs: cur[0].startMs, endMs: cur[cur.length - 1].endMs, text: cur.map((w) => w.text).join(" "), words: cur });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    cur.push(w);
    const gap = next ? next.startMs - w.endMs : Infinity;
    const long = w.endMs - cur[0].startMs > 20_000;
    if (END_PUNCT.test(w.text) || gap > PAUSE_MS || (long && (/[,،;:]$/.test(w.text) || gap > 300))) flush();
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- scoring
const HOOK_EN =
  /\b(how to|how do|how can|why|what if|what's the|secret|secrets|mistake|mistakes|never|stop|don't|biggest|best|worst|truth|nobody|everyone|you need|here's|here is|the reason|tips?|tricks?|hack|number one|first|simple|easy|formula|step|steps|wish|lost|money|free|actually|important)\b/gi;
const HOOK_UR = /(کیسے|کیوں|کیا آپ|غلطی|غلطیاں|راز|سب سے|کبھی|ضرور|طریقہ|آسان|اہم|سوال|جانتے|نمبر|پہلی|دوسری|تیسری|ٹپ|فارمولا|کامیابی|پیسے|مفت|حیران|چابی)/g;
const NUMBER = /\b\d+(?:[.,]\d+)?%?|\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\b|[۰-۹]+|(ایک|دو|تین|چار|پانچ|دس|سو)(?=\s)/gi;
const WEAK_START = /^(and|so|but|because|or|then|also|which|that|it|this|they|he|she|um|uh|okay|ok|اور|لیکن|تو|کیونکہ|پھر|یعنی|جو|کہ)\b/i;
/** A short opening sentence that points back at something said earlier ("How do you handle that?", "I sold 40 of them"). */
const DANGLING = /\b(that|this|those|these|them|it|there)\b[?.!]?$|\b(of them|do that|handle that|like that|said before|mentioned|as I said|earlier)\b/i;

const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

export function hookStrength(text: string): number {
  const q = /[?؟]/.test(text) ? 1.2 : 0;
  return q + count(HOOK_EN, text) * 0.6 + count(HOOK_UR, text) * 0.6 + Math.min(1, count(NUMBER, text) * 0.4);
}

export interface PickOptions {
  maxClips: number;
  minSec: number;
  maxSec: number;
  keywords?: string[];           // brand keywords / products (lowercase words)
  energy?: number[];             // dBFS per ENERGY_FRAME_MS frame
  exclude?: { startMs: number; endMs: number }[]; // existing clips (Make more)
}

interface Candidate {
  i: number;
  j: number;
  startMs: number;
  endMs: number;
  score: number;
  why: string[];
  text: string;
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function energyIn(energy: number[] | undefined, a: number, b: number): number | undefined {
  if (!energy?.length) return undefined;
  const f0 = Math.max(0, Math.floor(a / ENERGY_FRAME_MS));
  const f1 = Math.min(energy.length, Math.ceil(b / ENERGY_FRAME_MS));
  if (f1 <= f0) return undefined;
  // mean of voiced frames (> -50 dB) in dB
  let s = 0;
  let n = 0;
  for (let f = f0; f < f1; f++) if (energy[f] > -50) (s += energy[f]), n++;
  return n ? s / n : -60;
}

export function overlaps(a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }, marginMs = 1000) {
  return a.startMs < b.endMs + marginMs && b.startMs < a.endMs + marginMs;
}

/** Clip edges with a little air: start just before the first word, end after the last word (not into the next). */
export function padRange(sents: Sentence[], i: number, j: number): { startMs: number; endMs: number } {
  const prevEnd = i > 0 ? sents[i - 1].endMs : 0;
  const nextStart = j + 1 < sents.length ? sents[j + 1].startMs : Infinity;
  const startMs = Math.max(0, prevEnd, sents[i].startMs - 200);
  const endMs = Math.min(sents[j].endMs + 350, Math.max(sents[j].endMs, nextStart - 60));
  return { startMs: Math.round(Math.min(startMs, sents[i].startMs)), endMs: Math.round(endMs) };
}

/** Short title from the opening sentence(s): the most hook-like sentence of the first two, ≤ 9 words. */
export function makeTitle(sents: Sentence[], i: number, j: number): string {
  const opts = sents.slice(i, Math.min(j + 1, i + 3));
  // most hook-like of the opening sentences; long sentences lose points (titles must read in a glance)
  const rank = (x: Sentence) => hookStrength(x.text) - 0.25 * Math.max(0, x.text.split(/\s+/).length - 11);
  const best = opts.reduce((a, b) => (rank(b) > rank(a) + 0.4 ? b : a), opts[0]);
  let t = best.text.replace(/\s+/g, " ").trim().replace(/^(so|and|but|okay|ok|well|honestly|اور|تو)[,\s]+/i, "");
  const words = t.split(" ");
  if (words.length > 12) {
    // cut at a natural break (comma / clause word) between words 4 and 11, else the first clause-ish 8 words + …
    const cut = words.slice(0, 12);
    let p = -1;
    cut.forEach((w, k) => k >= 3 && /[,،:;.!?۔؟]$/.test(w) && (p = k));
    if (p < 0) {
      const c = cut.findIndex((w, k) => k >= 4 && /^(but|and|because|so|which|that|when|if|لیکن|کیونکہ|جب|اگر)$/i.test(w));
      t = c > 0 ? cut.slice(0, c).join(" ") : cut.slice(0, 10).join(" ") + "…";
    } else t = cut.slice(0, p + 1).join(" ");
  }
  t = t.replace(/[,،:;.۔]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function rangeText(sents: Sentence[], startMs: number, endMs: number, max = 600): string {
  const t = sents
    .filter((s) => s.endMs > startMs && s.startMs < endMs)
    .map((s) => s.text)
    .join(" ");
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** Heuristic moment picking (no LLM). */
export function pickHeuristic(t: Pick<ClipTranscript, "segments">, o: PickOptions): ClipMoment[] {
  const sents = sentences(t);
  if (!sents.length) return [];
  const minMs = o.minSec * 1000;
  const maxMs = o.maxSec * 1000;
  const sweet = Math.min(maxMs, Math.max(minMs, 35_000));
  const kw = (o.keywords ?? []).map((k) => k.toLowerCase()).filter((k) => k.length >= 3);

  // global baselines
  const rates = sents.map((s) => s.words.length / Math.max(0.5, (s.endMs - s.startMs) / 1000));
  const rateMed = median(rates) || 2.5;
  const voiced = (o.energy ?? []).filter((e) => e > -50);
  const eMed = median(voiced);
  const eSpread = Math.max(2, median(voiced.map((e) => Math.abs(e - eMed))) * 1.5);

  const cands: Candidate[] = [];
  for (let i = 0; i < sents.length; i++) {
    for (let j = i; j < sents.length; j++) {
      const { startMs, endMs } = padRange(sents, i, j);
      const dur = endMs - startMs;
      if (dur > maxMs) break;
      if (dur < minMs) continue;
      const span = sents.slice(i, j + 1);
      const text = span.map((s) => s.text).join(" ");
      const why: string[] = [];
      // hook: the first ~6 s
      const opening = span[0].text + (span[0].endMs - span[0].startMs < 4000 && span[1] ? " " + span[1].text : "");
      const hook = clamp01(hookStrength(opening) / 2.4);
      if (hook > 0.45) why.push(/[?؟]/.test(opening) ? "opens with a question" : "strong opening line");
      // body: hook-ish phrases per 30 s
      const body = clamp01((hookStrength(text) / Math.max(1, dur / 30_000)) / 3);
      if (body > 0.6) why.push("dense with tips/numbers");
      // energy
      let energy = 0.5;
      const e = energyIn(o.energy, startMs, endMs);
      if (e !== undefined && voiced.length) {
        energy = sigmoid((e - eMed) / eSpread * 1.5);
        if (energy > 0.65) why.push("energetic delivery");
      }
      // speech rate + dead air
      const words = span.reduce((n, s) => n + s.words.length, 0);
      const rate = words / (dur / 1000);
      let gaps = 0;
      for (let k = 1; k < span.length; k++) gaps += Math.max(0, span[k].startMs - span[k - 1].endMs - 600);
      const rateScore = clamp01(1 - Math.abs(rate / rateMed - 1.1) * 1.2) * clamp01(1 - gaps / dur * 3);
      if (gaps / dur > 0.15) why.push("some dead air");
      // brand keywords
      const low = text.toLowerCase();
      const hits = kw.filter((k) => low.includes(k));
      const keyword = clamp01(hits.length / 3);
      if (hits.length) why.push(`mentions ${hits.slice(0, 3).map((h) => `"${h}"`).join(", ")}`);
      // clean start / end
      const first8 = span[0].words.slice(0, 8).map((w) => w.text).join(" ");
      const dangling = (span[0].words.length <= 12 && DANGLING.test(span[0].text)) || /\b(of them|do that|handle that|like that|as I said|mentioned)\b/i.test(first8);
      const clean = (WEAK_START.test(span[0].text) ? 0 : dangling ? 0.15 : 0.5) + (END_PUNCT.test(span[span.length - 1].text) ? 0.5 : 0.2);
      if (clean >= 1) why.push("self-contained (clean start and end)");
      const durScore = clamp01(1 - Math.abs(dur - sweet) / sweet);
      const score = 0.3 * hook + 0.13 * body + 0.15 * energy + 0.1 * rateScore + 0.1 * keyword + 0.14 * clean + 0.08 * durScore;
      cands.push({ i, j, startMs, endMs, score, why, text });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const chosen: Candidate[] = [];
  const taken = [...(o.exclude ?? [])];
  for (const c of cands) {
    if (chosen.length >= o.maxClips) break;
    if (taken.some((x) => overlaps(x, c))) continue;
    chosen.push(c);
    taken.push(c);
  }
  return chosen.map((c) => ({
    id: "",
    startMs: c.startMs,
    endMs: c.endMs,
    title: makeTitle(sents, c.i, c.j),
    why: c.why.length ? c.why.join("; ") : "balanced pacing and a complete thought",
    score: Math.max(1, Math.min(99, Math.round(c.score * 100))),
    source: "heuristic",
    text: rangeText(sents, c.startMs, c.endMs),
    status: "pending",
  }));
}

/** Snap an arbitrary range to sentence boundaries within [minSec, maxSec] (grow/shrink by whole sentences). */
export function snapRange(sents: Sentence[], startMs: number, endMs: number, minSec: number, maxSec: number): { startMs: number; endMs: number } | undefined {
  if (!sents.length) return undefined;
  const near = (target: number, key: "startMs" | "endMs") => {
    let best = 0;
    for (let k = 1; k < sents.length; k++) if (Math.abs(sents[k][key] - target) < Math.abs(sents[best][key] - target)) best = k;
    return best;
  };
  let i = near(startMs, "startMs");
  let j = Math.max(i, near(endMs, "endMs"));
  const dur = () => padRange(sents, i, j).endMs - padRange(sents, i, j).startMs;
  while (dur() > maxSec * 1000 && j > i) j--;
  while (dur() < minSec * 1000 && j + 1 < sents.length && padRange(sents, i, j + 1).endMs - padRange(sents, i, j + 1).startMs <= maxSec * 1000) j++;
  while (dur() < minSec * 1000 && i > 0 && padRange(sents, i - 1, j).endMs - padRange(sents, i - 1, j).startMs <= maxSec * 1000) i--;
  const r = padRange(sents, i, j);
  if (r.endMs - r.startMs > maxSec * 1000) r.endMs = r.startMs + maxSec * 1000; // one very long sentence
  return r;
}

/** Timestamped transcript lines for the LLM ("[12.3-18.9] text"), split into chunks of ~chunkMin minutes. */
export function llmChunks(sents: Sentence[], chunkMin = 12): { from: number; to: number; text: string }[] {
  const out: { from: number; to: number; text: string }[] = [];
  let cur: string[] = [];
  let from = sents[0]?.startMs ?? 0;
  for (const s of sents) {
    cur.push(`[${(s.startMs / 1000).toFixed(1)}-${(s.endMs / 1000).toFixed(1)}] ${s.text}`);
    if (s.endMs - from >= chunkMin * 60_000) {
      out.push({ from, to: s.endMs, text: cur.join("\n") });
      // keep ~30 s of context
      const ctx = cur.slice(-4);
      cur = [...ctx];
      from = s.endMs;
    }
  }
  if (cur.length) out.push({ from, to: sents[sents.length - 1]?.endMs ?? from, text: cur.join("\n") });
  return out;
}

export const LLM_SYSTEM = `You are an expert short-form video editor (like Opus Clip) for Instagram Reels.
You read a timestamped transcript of a long lesson or process video and pick the moments that work as stand-alone vertical clips.
A good clip: starts with a hook (question, bold claim, mistake, secret, number, surprising fact) in the first 3 seconds; is self-contained (no "as I said before", no dangling references); delivers one clear idea, tip or story; ends on a complete sentence.
Input: {"brand": {...}, "minSec", "maxSec", "count", "language", "transcript": "[start-end] sentence\\n..."} (times in seconds).
Return JSON {"clips": [{"start": number, "end": number, "title": string, "why": string, "score": number, "caption": string, "hashtags": string[]}]}.
- start/end in seconds taken from the transcript line boundaries; duration between minSec and maxSec.
- title: the hook shown on screen, max 8 words, in the transcript's language and script (Urdu script for Urdu).
- why: one short sentence on why it will hold attention.
- score: 0-100 virality estimate (be honest; most clips 50-80).
- caption: Instagram caption, line 1 = hook with the main search keyword, 1-2 value lines, one CTA (no hashtags inside).
- hashtags: 3-5 specific niche tags without '#'.
Do not overlap clips. Best clips first. Never invent content that is not in the transcript.`;
