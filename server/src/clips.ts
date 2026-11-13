// Long video → short clips (Opus-Clip style) for Instagram Reels.
//
// Job pipeline (one job at a time, persisted in table clip_jobs, resumed after a restart):
//   extract    16 kHz mono wav + audio energy (ffmpeg-static)                       → data/clips/work/<key>/
//   transcribe whisper.cpp in 5-min chunks (each chunk saved; ETA from measured speed); transcript JSON is cached
//              next to the asset (<asset>.transcript.json) or in the work dir, so re-runs are instant
//   pick       Claude (with an Anthropic key) or heuristics → moments {start,end,title,why,score}
//   render     each moment becomes a normal Post (type "reel", spec.engine "clip") rendered through the normal render
//              queue, but only while that queue is idle, so reel renders are never starved
// A clip render (renderClipPost, called from render.ts): ffmpeg cut + reframe to 1080x1920 (fill-blur / center-crop /
// split) + the clip's audio → Remotion "ClipReel" (captions, hook title, logo bug, progress bar) → audio mastering
// (-14 LUFS) via audio.ts with the clip audio as the "voice" track.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { ChildProcess } from "node:child_process";
import type { Express, Request } from "express";
import { nanoid } from "nanoid";
import type { Asset, Brand, ClipJob, ClipJobOptions, ClipJobStage, ClipMoment, ClipReelSpec, ClipTranscript, Post } from "../../shared/types.ts";
import { DATA_DIR, UPLOADS_DIR, fileUrlFor, nowIso } from "./config.ts";
import * as db from "./db.ts";
import { brandStyleRef } from "./brain.ts";
import { newPost } from "./posts.ts";
import { enqueueRender, queueState } from "./render.ts";
import { masterRender, attachAutoMusic, FFMPEG } from "./audio.ts";
import { loadRenderer } from "./engines.ts";
import { heuristicHashtags, keywordFirstCaption, mainKeyword, capHashtags } from "./hashtags.ts";
import { askJson, llmAvailable } from "./llm.ts";
import {
  CHUNK_OVERLAP_SEC,
  EN_MODEL,
  MULTI_MODEL,
  computeEnergy,
  ensureModel,
  extractWav,
  ffProgress,
  mergeChunks,
  normalizeDetected,
  parseTranscript,
  planChunks,
  priorRtf,
  probeVideo,
  runProc,
  shiftSegments,
  sliceWav,
  toSrt,
  transcriptFromSegments,
  wavDurationSec,
  whisperFile,
  type ChunkResult,
} from "./clips-transcribe.ts";
import { LLM_SYSTEM, llmChunks, overlaps, pickHeuristic, rangeText, sentences, snapRange } from "./clips-pick.ts";

export const CLIPS_DIR = path.join(DATA_DIR, "clips");
const WORK_DIR = path.join(CLIPS_DIR, "work");
export const MAX_UPLOAD_BYTES = 4 * 1024 ** 3; // 4 GB
/** Render seconds per second of clip, before we have measured it (Remotion on this CPU). */
const PRIOR_RENDER_FACTOR = Number(process.env.CLIPS_RENDER_FACTOR) || 6;
const VIDEO_EXT = [".mp4", ".mov", ".webm", ".mkv", ".m4v"];
const MIME: Record<string, string> = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska" };

// ---------------------------------------------------------------- storage
db.db.exec(`CREATE TABLE IF NOT EXISTS clip_jobs (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, status TEXT, data TEXT NOT NULL, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_clip_jobs_brand ON clip_jobs(brand_id);`);

export function getJob(id: string): ClipJob | undefined {
  const r = db.db.prepare("SELECT data FROM clip_jobs WHERE id = ?").get(id) as { data: string } | undefined;
  return r ? (JSON.parse(r.data) as ClipJob) : undefined;
}
export function listJobs(brandId?: string): ClipJob[] {
  const rows = (brandId
    ? db.db.prepare("SELECT data FROM clip_jobs WHERE brand_id = ? ORDER BY created_at DESC").all(brandId)
    : db.db.prepare("SELECT data FROM clip_jobs ORDER BY created_at DESC").all()) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as ClipJob);
}
function saveJob(j: ClipJob): ClipJob {
  j.updatedAt = nowIso();
  db.db.prepare("INSERT OR REPLACE INTO clip_jobs(id, brand_id, status, data, created_at) VALUES(?, ?, ?, ?, ?)").run(j.id, j.brandId, j.status, JSON.stringify(j), j.createdAt);
  return j;
}
export function updateJob(id: string, fn: (j: ClipJob) => void): ClipJob | undefined {
  const j = getJob(id);
  if (!j) return undefined;
  fn(j);
  return saveJob(j);
}

const STAGE_LABELS: Record<ClipJobStage, string> = {
  extract: "Extract audio",
  transcribe: "Transcribe",
  pick: "Pick moments",
  render: "Render clips",
};
const STAGES: ClipJobStage[] = ["extract", "transcribe", "pick", "render"];
const STAGE_WEIGHT: Record<ClipJobStage, number> = { extract: 0.05, transcribe: 0.45, pick: 0.05, render: 0.45 };

function overall(j: ClipJob): number {
  let p = 0;
  for (const s of j.stages) p += STAGE_WEIGHT[s.id] * (s.status === "done" || s.status === "skipped" ? 1 : s.progress);
  return Math.round(Math.min(1, p) * 1000) / 1000;
}

function setStage(id: string, stage: ClipJobStage, patch: Partial<ClipJob["stages"][number]>, extra?: (j: ClipJob) => void) {
  return updateJob(id, (j) => {
    const s = j.stages.find((x) => x.id === stage)!;
    if (patch.status === "running" && s.status !== "running") s.startedAt = nowIso();
    if ((patch.status === "done" || patch.status === "skipped" || patch.status === "failed") && !s.finishedAt) s.finishedAt = nowIso();
    Object.assign(s, patch);
    if (patch.status === "running") j.stage = stage;
    extra?.(j);
    j.progress = overall(j);
  });
}

// ---------------------------------------------------------------- source + caches
const httpErr = (status: number, msg: string) => Object.assign(new Error(msg), { status });

function sourceKey(file: string): string {
  const st = fs.statSync(file);
  return crypto.createHash("sha1").update(`${path.resolve(file).toLowerCase()}|${st.size}|${Math.round(st.mtimeMs)}`).digest("hex").slice(0, 16);
}
function workDir(file: string): string {
  const d = path.join(WORK_DIR, sourceKey(file));
  fs.mkdirSync(path.join(d, "chunks"), { recursive: true });
  return d;
}
/** Transcript cache: next to the asset when it is one of our uploads, else in the work dir. */
function transcriptPath(source: ClipJob["source"]): string {
  if (source.assetId && path.resolve(source.path).startsWith(path.resolve(UPLOADS_DIR))) return `${source.path}.transcript.json`;
  return path.join(workDir(source.path), "transcript.json");
}
type CachedTranscript = ClipTranscript & { sourceKey?: string };
export function loadTranscript(source: ClipJob["source"], language?: string): ClipTranscript | undefined {
  try {
    const p = transcriptPath(source);
    if (!fs.existsSync(p)) return undefined;
    const t = JSON.parse(fs.readFileSync(p, "utf8")) as CachedTranscript;
    if (t.sourceKey && fs.existsSync(source.path) && t.sourceKey !== sourceKey(source.path)) return undefined; // file changed
    if (language && language !== "auto" && t.source === "whisper" && t.language !== language) return undefined;
    return t;
  } catch {
    return undefined;
  }
}
function saveTranscript(source: ClipJob["source"], t: ClipTranscript) {
  const p = transcriptPath(source);
  fs.writeFileSync(p, JSON.stringify({ ...t, sourceKey: sourceKey(source.path) }));
}
function loadEnergy(source: ClipJob["source"]): number[] | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(workDir(source.path), "energy.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function resolveSource(brandId: string, body: any): ClipJob["source"] {
  if (body?.assetId) {
    const a = db.getAsset(String(body.assetId));
    if (!a || a.brandId !== brandId) throw httpErr(404, "Asset not found for this brand");
    if (a.kind !== "video" && a.kind !== "audio") throw httpErr(400, "The asset must be a video (or audio) file");
    if (!fs.existsSync(a.path)) throw httpErr(400, "The asset file is missing on disk");
    return { assetId: a.id, path: a.path, name: a.originalName };
  }
  const p = typeof body?.path === "string" ? body.path.trim().replace(/^"|"$/g, "") : "";
  if (!p) throw httpErr(400, "assetId or path is required");
  const abs = path.resolve(p);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw httpErr(400, `File not found: ${p}`);
  if (![...VIDEO_EXT, ".mp3", ".wav", ".m4a"].includes(path.extname(abs).toLowerCase())) throw httpErr(400, `Unsupported file type: ${path.basename(abs)}`);
  return { path: abs, name: path.basename(abs) };
}

function parseOptions(b: any): ClipJobOptions {
  const lang = b?.language === "en" || b?.language === "ur" ? b.language : "auto";
  const maxClips = Math.max(1, Math.min(20, Math.round(Number(b?.maxClips) || 5)));
  let t: [number, number] = [20, 60];
  if (Array.isArray(b?.targetSec) && b.targetSec.length === 2) {
    const a = Math.max(5, Math.min(170, Number(b.targetSec[0]) || 20));
    const z = Math.max(a + 5, Math.min(180, Number(b.targetSec[1]) || 60));
    t = [a, z];
  }
  const layout = ["fill-blur", "center-crop", "split"].includes(b?.layout) ? b.layout : "auto";
  return {
    language: lang,
    maxClips,
    targetSec: t,
    layout,
    captionStyle: typeof b?.captionStyle === "string" ? b.captionStyle || undefined : "white-pill",
    music: b?.music === true,
    showProgress: b?.showProgress !== false,
  };
}

function newJob(brandId: string, source: ClipJob["source"], options: ClipJobOptions): ClipJob {
  const now = nowIso();
  return saveJob({
    id: nanoid(12),
    brandId,
    status: "queued",
    source,
    options,
    stages: STAGES.map((id) => ({ id, label: STAGE_LABELS[id], status: "pending", progress: 0 })),
    progress: 0,
    moments: [],
    createdAt: now,
    updatedAt: now,
  });
}

// ---------------------------------------------------------------- worker
let busy = false;
let currentJob: string | undefined;
let currentProc: ChildProcess | undefined;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
class Cancelled extends Error {}
function checkCancel(id: string) {
  const s = getJob(id)?.status;
  if (!s || s === "cancelled") throw new Cancelled("cancelled");
}
const onSpawn = (p: ChildProcess) => {
  currentProc = p;
  p.on("close", () => currentProc === p && (currentProc = undefined));
};

export function pumpJobs() {
  if (busy) return;
  const next = listJobs()
    .filter((j) => ["queued", "running", "waiting"].includes(j.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!next) return;
  busy = true;
  currentJob = next.id;
  runJob(next.id)
    .catch((e) => {
      if (e instanceof Cancelled) return;
      console.error(`[clips] job ${next.id} failed:`, e?.stack ?? e);
      updateJob(next.id, (j) => {
        j.status = "failed";
        j.error = String(e?.message ?? e);
        const s = j.stages.find((x) => x.status === "running");
        if (s) s.status = "failed";
        j.etaSec = undefined;
      });
    })
    .finally(() => {
      busy = false;
      currentJob = undefined;
      currentProc = undefined;
      setTimeout(pumpJobs, 500);
    });
}

let lastWrite = 0;
function throttled(fn: () => void, force = false) {
  const now = Date.now();
  if (!force && now - lastWrite < 1000) return;
  lastWrite = now;
  fn();
}

function renderEta(j: ClipJob): number {
  const done = j.metrics?.renderSecPerClip ?? [];
  const pending = j.moments.filter((m) => m.status === "pending" || m.status === "rendering");
  const avgClipSec = pending.length ? pending.reduce((s, m) => s + (m.endMs - m.startMs) / 1000, 0) / pending.length : (j.options.targetSec[0] + j.options.targetSec[1]) / 2;
  const per = done.length ? done.reduce((a, b) => a + b, 0) / done.length : avgClipSec * PRIOR_RENDER_FACTOR;
  const n = j.stages.find((s) => s.id === "pick")?.status === "done" ? pending.length : j.options.maxClips;
  return Math.round(n * per);
}

async function runJob(id: string) {
  let job = updateJob(id, (j) => {
    j.status = "running";
    j.error = undefined;
  })!;
  const src = job.source.path;
  if (!fs.existsSync(src)) throw new Error(`Source video not found: ${src}`);

  // ---- probe
  if (!job.source.durationMs) {
    const info = await probeVideo(src);
    if (!info.hasAudio) throw new Error("This video has no audio track, so there is nothing to transcribe");
    job = updateJob(id, (j) => Object.assign(j.source, { durationMs: info.durationMs, width: info.width, height: info.height }))!;
  }
  const durSec = (job.source.durationMs ?? 0) / 1000;

  // ---- transcript (cached?)
  let transcript = loadTranscript(job.source, job.options.language);
  if (transcript) {
    for (const st of ["extract", "transcribe"] as const) {
      const cur = job.stages.find((s) => s.id === st)!;
      if (cur.status !== "done") setStage(id, st, { status: cur.status === "running" ? "done" : "skipped", progress: 1, detail: st === "transcribe" ? `Cached transcript (${transcript.source === "import" ? "imported" : transcript.model})` : "Not needed (cached transcript)" });
    }
    job = updateJob(id, (j) => {
      j.transcriptCached = true;
      j.language = transcript!.language;
      j.model = transcript!.model;
    })!;
  } else {
    const wd = workDir(src);
    const wav = path.join(wd, "audio16k.wav");
    // ---- extract
    checkCancel(id);
    if (!fs.existsSync(wav)) {
      setStage(id, "extract", { status: "running", progress: 0, detail: "16 kHz mono wav" }, (j) => (j.etaSec = Math.round(durSec * priorRtf(EN_MODEL) + renderEta(j))));
      await extractWav(src, wav, durSec, (p) => throttled(() => setStage(id, "extract", { progress: p })), onSpawn);
    }
    if (!fs.existsSync(path.join(wd, "energy.json"))) fs.writeFileSync(path.join(wd, "energy.json"), JSON.stringify(computeEnergy(wav)));
    setStage(id, "extract", { status: "done", progress: 1, detail: `${Math.round(wavDurationSec(wav))} s of audio` });
    // ---- transcribe
    checkCancel(id);
    transcript = await transcribeChunks(id, wav, wd);
    saveTranscript(job.source, transcript);
    fs.rmSync(wav, { force: true }); // big; the transcript + energy are all we need from now on
    fs.rmSync(path.join(wd, "chunks"), { recursive: true, force: true });
    job = updateJob(id, (j) => {
      j.language = transcript!.language;
      j.model = transcript!.model;
    })!;
  }

  // ---- pick
  checkCancel(id);
  job = getJob(id)!;
  const pickMore = (job as ClipJob & { pickMore?: number }).pickMore;
  if (!job.moments.length || pickMore) {
    setStage(id, "pick", { status: "running", progress: 0.1, detail: llmAvailable() ? "Claude is reading the transcript" : "Scoring sentences (no API key: heuristics)" });
    const brand = db.getBrand(job.brandId);
    const existing = job.moments.filter((m) => m.status !== "deleted");
    const want = pickMore || job.options.maxClips;
    const { moments, by, note } = await pickMoments(job, transcript, brand, want, existing);
    if (!moments.length && !existing.length) throw new Error("No clip-worthy moments found (is the transcript empty?)");
    job = updateJob(id, (j) => {
      for (const m of moments) j.moments.push({ ...m, id: nanoid(8) });
      j.pickedBy = by;
      delete (j as ClipJob & { pickMore?: number }).pickMore;
      const s = j.stages.find((x) => x.id === "pick")!;
      s.status = "done";
      s.progress = 1;
      s.finishedAt = nowIso();
      s.detail = `${moments.length} moment${moments.length === 1 ? "" : "s"} (${by === "llm" ? "Claude" : "heuristics"})${note ? ` — ${note}` : ""}`;
      // new moments → the render stage runs again
      const r = j.stages.find((x) => x.id === "render")!;
      if (moments.length) Object.assign(r, { status: "pending", progress: 0, finishedAt: undefined });
      j.progress = overall(j);
    })!;
  } else if (job.stages.find((s) => s.id === "pick")!.status !== "done") {
    setStage(id, "pick", { status: "done", progress: 1 });
  }

  // ---- render
  await renderMoments(id);
  updateJob(id, (j) => {
    syncMoments(j);
    j.status = "done";
    j.etaSec = 0;
    const r = j.stages.find((x) => x.id === "render")!;
    r.status = "done";
    r.progress = 1;
    r.finishedAt = nowIso();
    const ok = j.moments.filter((m) => m.status === "ready").length;
    const failed = j.moments.filter((m) => m.status === "failed").length;
    r.detail = `${ok} clip${ok === 1 ? "" : "s"} ready${failed ? `, ${failed} failed` : ""}`;
    j.progress = 1;
  });
}

async function transcribeChunks(id: string, wav: string, wd: string): Promise<ClipTranscript> {
  let job = getJob(id)!;
  const durSec = wavDurationSec(wav);
  // language
  let lang: string = job.options.language;
  if (lang === "auto" && job.language) lang = job.language; // resumed job: detected before the restart
  if (lang === "auto") {
    setStage(id, "transcribe", { status: "running", progress: 0, detail: "Detecting language" });
    await ensureModel(MULTI_MODEL);
    const probe = path.join(wd, "detect.wav");
    sliceWav(wav, probe, Math.min(60, durSec * 0.2), Math.min(durSec, Math.min(60, durSec * 0.2) + 30));
    try {
      const r = await whisperFile(probe, { model: MULTI_MODEL, lang: "auto", onSpawn });
      lang = normalizeDetected(r.language);
    } finally {
      fs.rmSync(probe, { force: true });
    }
  }
  const model = lang === "en" ? EN_MODEL : MULTI_MODEL;
  setStage(id, "transcribe", { status: "running", detail: `Preparing whisper (${model})` }, (j) => {
    j.language = lang;
    j.model = model;
  });
  await ensureModel(model);
  const plan = planChunks(durSec);
  const results: ChunkResult[] = [];
  const t0 = Date.now();
  const rtfNow = () => {
    const done = results.filter((r) => r.procMs > 0);
    const audio = done.reduce((s, r) => s + r.audioMs, 0);
    return audio > 0 ? done.reduce((s, r) => s + r.procMs, 0) / audio : priorRtf(model);
  };
  for (const c of plan) {
    checkCancel(id);
    const file = path.join(wd, "chunks", `${model}-${lang}-${c.index}.json`);
    if (fs.existsSync(file)) {
      try {
        results.push(JSON.parse(fs.readFileSync(file, "utf8")));
        continue;
      } catch {
        /* redo */
      }
    }
    const from = Math.max(0, c.start - CHUNK_OVERLAP_SEC);
    const to = Math.min(durSec, c.end + CHUNK_OVERLAP_SEC);
    const piece = path.join(wd, `chunk-${c.index}.wav`);
    sliceWav(wav, piece, from, to);
    const doneAudio = () => results.reduce((s, r) => s + r.audioMs, 0) / 1000;
    const update = (p: number) =>
      setStage(id, "transcribe", {
        progress: Math.min(0.99, (doneAudio() + p * (c.end - c.start)) / durSec),
        detail: `Chunk ${c.index + 1}/${plan.length} (${model}, ${lang})`,
      }, (j) => (j.etaSec = Math.round((durSec - doneAudio() - p * (c.end - c.start)) * rtfNow() + renderEta(j))));
    update(0);
    const s0 = Date.now();
    try {
      const r = await whisperFile(piece, { model, lang, onSpawn, onProgress: (p) => throttled(() => update(p)) });
      const res: ChunkResult = {
        index: c.index,
        startMs: Math.round(c.start * 1000),
        endMs: Math.round(c.end * 1000),
        language: r.language,
        segments: shiftSegments(r.segments, Math.round(from * 1000)),
        procMs: Date.now() - s0,
        audioMs: Math.round((c.end - c.start) * 1000),
      };
      fs.writeFileSync(file, JSON.stringify(res));
      results.push(res);
    } finally {
      fs.rmSync(piece, { force: true });
    }
    const audioSec = results.reduce((s, r) => s + r.audioMs, 0) / 1000;
    updateJob(id, (j) => {
      j.metrics = { ...(j.metrics ?? {}), transcribeRtf: Math.round(rtfNow() * 1000) / 1000, audioSec: Math.round(audioSec), transcribeSec: Math.round((Date.now() - t0) / 1000) };
    });
  }
  const segments = mergeChunks(results);
  setStage(id, "transcribe", { status: "done", progress: 1, detail: `${segments.length} segments, ${model} (${lang}), ${rtfNow().toFixed(2)}× realtime` });
  job = getJob(id)!;
  return transcriptFromSegments(segments, { language: lang, model, source: "whisper", durationMs: Math.round(durSec * 1000) });
}

function brandKeywords(brand: Brand | undefined): string[] {
  const b = brand?.brain;
  if (!b) return [];
  const words = [...(b.keywords ?? []), ...(b.products ?? []), b.niche ?? ""]
    .flatMap((k) => String(k).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^\p{L}\p{N}]+/u))
    .filter((w) => w.length >= 4 && !/^(with|from|your|that|this|course|online|shop)$/.test(w));
  return [...new Set(words)].slice(0, 40);
}

async function pickMoments(job: ClipJob, t: ClipTranscript, brand: Brand | undefined, count: number, existing: ClipMoment[]): Promise<{ moments: ClipMoment[]; by: "llm" | "heuristic"; note?: string }> {
  const [minSec, maxSec] = job.options.targetSec;
  const exclude = existing.map((m) => ({ startMs: m.startMs, endMs: m.endMs }));
  const heuristic = () => pickHeuristic(t, { maxClips: count, minSec, maxSec, keywords: brandKeywords(brand), energy: loadEnergy(job.source), exclude });
  if (!llmAvailable()) return { moments: heuristic(), by: "heuristic" };
  try {
    const sents = sentences(t);
    const chunks = llmChunks(sents);
    const per = Math.max(2, Math.ceil((count * 1.6) / chunks.length) + 1);
    const cands: ClipMoment[] = [];
    const b = brand?.brain;
    for (let k = 0; k < chunks.length; k++) {
      setStage(job.id, "pick", { progress: 0.1 + (0.8 * k) / chunks.length, detail: `Claude is reading part ${k + 1}/${chunks.length}` });
      const r = await askJson<{ clips?: any[] }>(
        LLM_SYSTEM,
        JSON.stringify({
          brand: { name: brand?.name, niche: b?.niche, audience: b?.audience, voice: b?.voice, keywords: b?.keywords?.slice(0, 12), ctas: b?.ctas?.slice(0, 2), claimsToAvoid: b?.claimsToAvoid },
          minSec,
          maxSec,
          count: per,
          language: t.language,
          avoidRanges: exclude.map((x) => [x.startMs / 1000, x.endMs / 1000]),
          transcript: chunks[k].text,
        }),
        4000,
      );
      for (const c of r?.clips ?? []) {
        const s = Number(c.start) * 1000;
        const e = Number(c.end) * 1000;
        if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
        const snapped = snapRange(sents, s, e, minSec, maxSec);
        if (!snapped) continue;
        cands.push({
          id: "",
          ...snapped,
          title: String(c.title ?? "").trim().slice(0, 90) || rangeText(sents, snapped.startMs, snapped.endMs, 60),
          why: String(c.why ?? "").trim().slice(0, 240) || undefined,
          score: Math.max(1, Math.min(99, Math.round(Number(c.score) || 60))),
          source: "llm",
          text: rangeText(sents, snapped.startMs, snapped.endMs),
          caption: typeof c.caption === "string" ? c.caption.trim().slice(0, 1800) : undefined,
          hashtags: Array.isArray(c.hashtags) ? capHashtags(c.hashtags) : undefined,
          status: "pending",
        });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const out: ClipMoment[] = [];
    const taken = [...exclude];
    for (const c of cands) {
      if (out.length >= count) break;
      if (taken.some((x) => overlaps(x, c, 0))) continue;
      out.push(c);
      taken.push(c);
    }
    if (out.length < count) {
      // top up with heuristics when Claude found too few
      for (const h of pickHeuristic(t, { maxClips: count, minSec, maxSec, keywords: brandKeywords(brand), energy: loadEnergy(job.source), exclude: taken })) {
        if (out.length >= count) break;
        out.push(h);
      }
    }
    return { moments: out, by: "llm" };
  } catch (e: any) {
    console.warn("[clips] LLM picking failed, using heuristics:", e?.message ?? e);
    return { moments: heuristic(), by: "heuristic", note: `Claude failed (${String(e?.message ?? e).slice(0, 80)}), used heuristics` };
  }
}

// ---------------------------------------------------------------- moments → posts
function resolvedLayout(job: Pick<ClipJob, "options" | "source">): ClipReelSpec["layout"] {
  if (job.options.layout !== "auto") return job.options.layout;
  const { width, height } = job.source;
  return width && height && height > width ? "center-crop" : "fill-blur";
}

export function captionsFor(t: ClipTranscript | undefined, startMs: number, endMs: number): ClipReelSpec["captions"] {
  if (!t) return undefined;
  const out: NonNullable<ClipReelSpec["captions"]> = [];
  for (const s of t.segments) {
    if (s.endMs < startMs || s.startMs > endMs) continue;
    const ws = s.words?.length ? s.words : [];
    for (const w of ws) {
      if (w.startMs < startMs - 50 || w.startMs >= endMs - 80) continue;
      out.push({ text: w.text, startMs: Math.max(0, w.startMs - startMs), endMs: Math.min(endMs - startMs, Math.max(w.endMs, w.startMs + 80) - startMs) });
    }
  }
  return out;
}

function clipCaption(brand: Brand | undefined, m: ClipMoment): { caption: string; hashtags: string[] } {
  const brain = brand?.brain;
  const hashtags = m.hashtags?.length ? capHashtags(m.hashtags) : brain ? heuristicHashtags(brain, `${m.title} ${m.text ?? ""}`) : [];
  if (m.caption) return { caption: m.caption, hashtags };
  // value lines: the clip's first sentences, minus the one already used as the hook
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const body = (m.text ?? "")
    .split(/(?<=[.!?۔؟])\s+/)
    .filter((s) => !norm(m.title).startsWith(norm(s).slice(0, 40)) && !norm(s).startsWith(norm(m.title)))
    .slice(0, 2)
    .join(" ")
    .slice(0, 300);
  const cta = brain?.ctas?.[0];
  const caption = brain ? keywordFirstCaption({ hook: m.title, keyword: mainKeyword(brain, m.title), body, cta }) : [m.title, body, cta].filter(Boolean).join("\n\n");
  return { caption, hashtags };
}

function createClipPost(job: ClipJob, m: ClipMoment, t: ClipTranscript | undefined): Post {
  const brand = db.getBrand(job.brandId);
  if (!brand) throw new Error("brand disappeared");
  const spec: ClipReelSpec = {
    engine: "clip",
    width: 1080,
    height: 1920,
    fps: 30,
    source: { assetId: job.source.assetId, path: job.source.path, name: job.source.name },
    startMs: m.startMs,
    endMs: m.endMs,
    layout: resolvedLayout(job),
    captionStyle: job.options.captionStyle,
    hookTitle: m.title,
    showProgress: job.options.showProgress !== false,
    brand: brandStyleRef(brand),
    captions: captionsFor(t, m.startMs, m.endMs),
    language: t?.language === "ur" ? "ur" : t?.language === "en" ? "en" : undefined,
    musicOff: !job.options.music,
  };
  const { caption, hashtags } = clipCaption(brand, m);
  const p = newPost({ brandId: brand.id, type: "reel", title: m.title, hook: m.title, caption, hashtags, spec: spec as unknown as Post["spec"] });
  return db.updatePost(p.id, (x) => {
    x.clipSource = { jobId: job.id, assetId: job.source.assetId, path: job.source.path, startMs: m.startMs, endMs: m.endMs, score: m.score, why: m.why };
  })!;
}

/** Mirror post state into the job's moments (rendered / failed / deleted). */
function syncMoments(j: ClipJob) {
  for (const m of j.moments) {
    if (!m.postId) continue;
    const p = db.getPost(m.postId);
    if (!p) {
      m.status = "deleted";
      continue;
    }
    if (p.status === "failed") {
      m.status = "failed";
      m.error = p.error;
    } else if (p.status === "rendering" || p.status === "changes_requested") m.status = m.status === "pending" ? "pending" : "rendering";
    else if (p.mediaUrls?.length) m.status = "ready";
    const cs = p.clipSource;
    if (cs) {
      m.startMs = cs.startMs;
      m.endMs = cs.endMs;
    }
    m.title = p.hook || p.title || m.title;
  }
}

async function waitForIdleQueue(id: string, ownPostId: string) {
  let waited = false;
  for (;;) {
    checkCancel(id);
    const q = queueState();
    const others = q.queued.filter((x) => x !== ownPostId).length + (q.running && q.running !== ownPostId ? 1 : 0);
    if (!others) break;
    if (!waited) {
      waited = true;
      updateJob(id, (j) => {
        j.status = "waiting";
        const r = j.stages.find((s) => s.id === "render")!;
        r.detail = "Waiting: reel renders go first";
      });
    }
    await sleep(3000);
  }
  if (waited) updateJob(id, (j) => (j.status = "running"));
}

async function renderMoments(id: string) {
  let job = getJob(id)!;
  const t = loadTranscript(job.source);
  const todo = () => getJob(id)!.moments.filter((m) => m.status === "pending" || m.status === "rendering");
  const total = Math.max(1, job.moments.filter((m) => m.status !== "deleted").length);
  setStage(id, "render", { status: "running", progress: (total - todo().length) / total, detail: `0/${todo().length} clips` }, (j) => (j.etaSec = renderEta(j)));
  for (const m0 of todo()) {
    checkCancel(id);
    job = getJob(id)!;
    let m = job.moments.find((x) => x.id === m0.id)!;
    let post = m.postId ? db.getPost(m.postId) : undefined;
    if (m.postId && !post) {
      updateJob(id, (j) => (j.moments.find((x) => x.id === m.id)!.status = "deleted"));
      continue;
    }
    if (!post) {
      post = createClipPost(job, m, t);
      updateJob(id, (j) => (j.moments.find((x) => x.id === m.id)!.postId = post!.id));
    }
    if (post.mediaUrls?.length && post.status !== "rendering" && post.status !== "failed") {
      updateJob(id, (j) => (j.moments.find((x) => x.id === m.id)!.status = "ready"));
      continue;
    }
    await waitForIdleQueue(id, post.id);
    const idx = total - todo().length;
    setStage(id, "render", { detail: `Clip ${idx + 1}/${total}: “${m.title.slice(0, 60)}”` }, (j) => {
      j.moments.find((x) => x.id === m.id)!.status = "rendering";
      j.etaSec = renderEta(j);
    });
    const t0 = Date.now();
    if (db.getPost(post.id)?.status !== "rendering") enqueueRender(post.id);
    // wait for the render queue to finish this post
    for (;;) {
      await sleep(2000);
      const p = db.getPost(post.id);
      if (!p) break;
      if (p.status !== "rendering" && p.status !== "changes_requested") break;
      if (getJob(id)?.status === "cancelled") throw new Cancelled("cancelled");
      throttled(() =>
        setStage(id, "render", { progress: Math.min(0.99, (idx + (p.renderProgress ?? 0)) / total) }, (j) => {
          j.etaSec = Math.max(0, renderEta(j) - Math.round((Date.now() - t0) / 1000));
        }),
      );
    }
    const p = db.getPost(post.id);
    const secs = Math.round((Date.now() - t0) / 1000);
    updateJob(id, (j) => {
      const mm = j.moments.find((x) => x.id === m.id)!;
      if (!p) mm.status = "deleted";
      else if (p.status === "failed") {
        mm.status = "failed";
        mm.error = p.error;
      } else {
        mm.status = "ready";
        j.metrics = { ...(j.metrics ?? {}), renderSecPerClip: [...(j.metrics?.renderSecPerClip ?? []), secs] };
      }
      const left = j.moments.filter((x) => x.status === "pending" || x.status === "rendering").length;
      const s = j.stages.find((x) => x.id === "render")!;
      s.progress = (total - left) / total;
      s.detail = `${total - left}/${total} clips`;
      j.etaSec = renderEta(j);
      j.progress = overall(j);
    });
    m = getJob(id)!.moments.find((x) => x.id === m.id)!;
    console.log(`[clips] ${id}: clip ${post.id} ${m.status} in ${secs}s`);
  }
}

// ---------------------------------------------------------------- clip render (called by render.ts)
export const isClipSpec = (s: unknown): s is ClipReelSpec => !!s && (s as { engine?: string }).engine === "clip";

function reframeGraph(layout: ClipReelSpec["layout"], W: number, H: number): string {
  if (layout === "center-crop") return `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p[v]`;
  if (layout === "split") {
    const h2 = H / 2;
    return (
      `[0:v]split=2[a][c];` +
      `[a]scale=${W}:${h2}:force_original_aspect_ratio=decrease,setsar=1,split=2[fg][b0];` +
      `[b0]scale=${W / 4}:${h2 / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${h2 / 4},boxblur=8:2,scale=${W}:${h2},eq=brightness=-0.08[bg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[top];` +
      // bottom: the lower-right corner of the frame, where a webcam overlay usually sits in screen recordings
      `[c]crop=iw*0.42:ih*0.48:iw*0.58:ih*0.52,scale=${W}:${h2}:force_original_aspect_ratio=increase,crop=${W}:${h2},setsar=1[bot];` +
      `[top][bot]vstack=inputs=2,format=yuv420p[v]`
    );
  }
  // fill-blur: blurred, darkened full-frame background + the whole video centred (safe for screen recordings)
  return (
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1,split=2[fg][b0];` +
    `[b0]scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${H / 4},boxblur=10:2,scale=${W}:${H},eq=brightness=-0.1:saturation=1.15[bg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`
  );
}

/** Cut [start,end) with an accurate seek, reframe to WxH, and write the clip audio separately (48 kHz wav). */
export async function cutAndReframe(src: string, spec: ClipReelSpec, outDir: string, onProgress?: (p: number) => void): Promise<{ video: string; audio?: string }> {
  const W = spec.width || 1080;
  const H = spec.height || 1920;
  const video = path.join(outDir, "cut.mp4");
  const audio = path.join(outDir, "clip-audio.wav");
  const dur = Math.max(1, (spec.endMs - spec.startMs) / 1000);
  const info = await probeVideo(src);
  const args = ["-hide_banner", "-nostats", "-loglevel", "error", "-y", "-ss", (spec.startMs / 1000).toFixed(3), "-i", src, "-t", dur.toFixed(3)];
  if (info.hasVideo) {
    args.push("-filter_complex", reframeGraph(spec.layout, W, H), "-map", "[v]", "-r", String(spec.fps || 30), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "17", "-pix_fmt", "yuv420p", "-g", String(spec.fps || 30), "-an", video);
  }
  if (info.hasAudio) args.push("-map", "0:a:0", "-vn", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", audio);
  args.push("-progress", "pipe:1");
  if (!info.hasVideo) {
    // audio-only source: a dark background card video
    await runProc(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=0x111111:s=${W}x${H}:r=${spec.fps || 30}`, "-t", dur.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", video]);
  }
  await runProc(FFMPEG, args, { onStdout: ffProgress((s) => onProgress?.(Math.min(1, s / dur))) });
  return { video, audio: info.hasAudio && fs.existsSync(audio) ? audio : undefined };
}

type ClipRenderer = { renderClipReel?: (spec: ClipReelSpec & { videoSrc: string }, outDir: string, onProgress?: (p: number) => void) => Promise<{ videoPath: string; thumbnailPath: string }> };

/** Render one clip post into outDir. Called by render.ts for posts whose spec.engine is "clip". */
export async function renderClipPost(postId: string, outDir: string, onProgress: (p: number) => void): Promise<{ videoPath: string; thumbnailPath?: string }> {
  const post = db.getPost(postId);
  if (!post || !isClipSpec(post.spec)) throw new Error("not a clip post");
  let spec = post.spec;
  const src = spec.source.path ?? (spec.source.assetId ? db.getAsset(spec.source.assetId)?.path : undefined);
  if (!src || !fs.existsSync(src)) throw new Error(`Source video not found: ${src ?? spec.source.name}`);
  // fresh captions for the current range (after trim/extend), from the cached transcript
  const t = loadTranscript({ assetId: spec.source.assetId, path: src, name: spec.source.name ?? "" });
  if (t && spec.captionStyle) spec = { ...spec, captions: captionsFor(t, spec.startMs, spec.endMs) };
  const t0 = Date.now();
  const cut = await cutAndReframe(src, spec, outDir, (p) => onProgress(p * 0.15));
  const tCut = Date.now();
  // optional low background music (off by default for lessons)
  if (!spec.musicOff && !spec.music?.src) {
    db.updatePost(postId, (x) => ((x.spec as ClipReelSpec) = spec));
    await attachAutoMusic(postId);
    const m = (db.getPost(postId)?.spec as ClipReelSpec | undefined)?.music;
    if (m) spec = { ...spec, music: { ...m, volume: Math.min(m.volume ?? 0.12, 0.15) } };
  }
  spec = { ...spec, voiceover: cut.audio ? { src: fileUrlFor(cut.audio) } : undefined };
  db.updatePost(postId, (x) => ((x.spec as ClipReelSpec) = spec));
  const r = (await loadRenderer()) as unknown as ClipRenderer;
  if (!r.renderClipReel) throw new Error("renderer has no renderClipReel (update renderer/)");
  const { music: _m, voiceover: _v, ...visual } = spec;
  const res = await r.renderClipReel({ ...visual, videoSrc: fileUrlFor(cut.video) }, outDir, (p) => onProgress(0.15 + p * 0.8));
  const tRender = Date.now();
  await masterRender(postId, res.videoPath); // clip audio levelled + (optional) music, -14 LUFS
  fs.rmSync(cut.video, { force: true });
  console.log(`[clips] ${postId}: ${((spec.endMs - spec.startMs) / 1000).toFixed(1)}s clip — cut ${((tCut - t0) / 1000).toFixed(1)}s, remotion ${((tRender - tCut) / 1000).toFixed(1)}s, master ${((Date.now() - tRender) / 1000).toFixed(1)}s`);
  return res;
}

// ---------------------------------------------------------------- adjustments (UI + change requests)
export interface ClipAdjust {
  startDeltaMs?: number;        // negative = start earlier
  endDeltaMs?: number;          // positive = end later
  startMs?: number;
  endMs?: number;
  hookTitle?: string;
  captionStyle?: string | null; // null = no captions
  layout?: ClipReelSpec["layout"];
  music?: boolean;
  showProgress?: boolean;
}

export async function adjustClip(postId: string, a: ClipAdjust, note?: string): Promise<Post> {
  const post = db.getPost(postId);
  if (!post || !isClipSpec(post.spec)) throw httpErr(400, "Not a clip post");
  if (["posted", "publishing"].includes(post.status)) throw httpErr(409, `Post is already ${post.status}`);
  const spec = structuredClone(post.spec);
  const src = spec.source.path ?? "";
  const durMs = fs.existsSync(src) ? (await probeVideo(src)).durationMs : Infinity;
  let s = typeof a.startMs === "number" ? a.startMs : spec.startMs + (Number(a.startDeltaMs) || 0);
  let e = typeof a.endMs === "number" ? a.endMs : spec.endMs + (Number(a.endDeltaMs) || 0);
  s = Math.max(0, Math.round(s));
  e = Math.min(durMs, Math.round(e));
  if (e - s < 3000) throw httpErr(400, "A clip must be at least 3 seconds long");
  if (e - s > 180_000) throw httpErr(400, "Instagram reels from clips are limited to 3 minutes here");
  const changes: string[] = [];
  if (s !== spec.startMs || e !== spec.endMs) changes.push(`range ${(s / 1000).toFixed(1)}–${(e / 1000).toFixed(1)}s`);
  spec.startMs = s;
  spec.endMs = e;
  if (typeof a.hookTitle === "string" && a.hookTitle.trim() !== spec.hookTitle) {
    spec.hookTitle = a.hookTitle.trim();
    changes.push("hook title");
  }
  if (a.captionStyle !== undefined) {
    spec.captionStyle = a.captionStyle || undefined;
    changes.push(a.captionStyle ? `captions ${a.captionStyle}` : "no captions");
  }
  if (a.layout && ["fill-blur", "center-crop", "split"].includes(a.layout)) {
    spec.layout = a.layout;
    changes.push(`layout ${a.layout}`);
  }
  if (typeof a.showProgress === "boolean") spec.showProgress = a.showProgress;
  if (typeof a.music === "boolean") {
    spec.musicOff = !a.music;
    if (!a.music) delete spec.music;
    changes.push(a.music ? "music on" : "music off");
  }
  if (!changes.length && typeof a.showProgress !== "boolean") return post;
  const updated = db.updatePost(postId, (x) => {
    x.spec = spec;
    if (typeof a.hookTitle === "string" && a.hookTitle.trim()) {
      x.hook = a.hookTitle.trim();
      x.title = a.hookTitle.trim();
    }
    x.clipSource = { ...(x.clipSource ?? {}), startMs: s, endMs: e };
    x.revision = (x.revision ?? 1) + 1;
    x.changeRequests = [...(x.changeRequests ?? []), { text: note ?? `Clip: ${changes.join(", ")}`, createdAt: nowIso() }];
  })!;
  return enqueueRender(updated.id) ?? updated;
}

/** Plain-words change requests for clip posts ("extend by 5s", "start 3 seconds earlier", "trim the end by 2s", "hook: ..."). */
export function parseClipChange(text: string): ClipAdjust | undefined {
  const t = text.toLowerCase();
  const secs = (re: RegExp) => {
    const m = t.match(re);
    return m ? Math.round(parseFloat(m[1]) * 1000) : undefined;
  };
  const a: ClipAdjust = {};
  const num = String.raw`(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)?`;
  const startEarlier = secs(new RegExp(`(?:start|begin)\\w*\\s+${num}\\s+earlier`)) ?? secs(new RegExp(`(?:extend|add)\\s+(?:the\\s+)?(?:start|beginning)\\s+(?:by\\s+)?${num}`));
  const trimStart = secs(new RegExp(`(?:trim|cut|remove)\\s+(?:the\\s+)?(?:start|beginning|first)\\s+(?:by\\s+)?${num}`)) ?? secs(new RegExp(`(?:start|begin)\\w*\\s+${num}\\s+later`));
  const trimEnd = secs(new RegExp(`(?:trim|cut|remove)\\s+(?:the\\s+)?(?:end|ending|last)\\s+(?:by\\s+)?${num}`)) ?? secs(new RegExp(`(?:end|stop)\\w*\\s+${num}\\s+earlier`));
  const extendEnd =
    secs(new RegExp(`(?:extend|add)\\s+(?:the\\s+)?(?:end|ending)\\s+(?:by\\s+)?${num}`)) ??
    secs(new RegExp(`(?:end|stop)\\w*\\s+${num}\\s+later`)) ??
    secs(new RegExp(`(?:extend|longer)\\s+(?:it\\s+)?(?:by\\s+)?${num}`));
  if (startEarlier) a.startDeltaMs = -startEarlier;
  if (trimStart) a.startDeltaMs = (a.startDeltaMs ?? 0) + trimStart;
  if (trimEnd) a.endDeltaMs = -trimEnd;
  if (extendEnd && !t.match(/start|begin/)) a.endDeltaMs = (a.endDeltaMs ?? 0) + extendEnd;
  const hook = text.match(/(?:hook|title|headline)\s*(?:to|:|=|should be)\s*["“']?(.+?)["”']?\s*$/i)?.[1];
  if (hook) a.hookTitle = hook;
  if (/\bno captions?\b|remove captions?/.test(t)) a.captionStyle = null;
  if (/center[- ]?crop|crop (?:to|the) (?:face|centre|center)|fill the screen/.test(t)) a.layout = "center-crop";
  if (/blur(?:red)? background|fill[- ]?blur|show the whole (?:screen|frame)/.test(t)) a.layout = "fill-blur";
  if (/\bsplit\b/.test(t)) a.layout = "split";
  if (/\b(add|with) (?:some )?(?:background )?music\b/.test(t)) a.music = true;
  if (/\bno music\b|remove (?:the )?music/.test(t)) a.music = false;
  return Object.keys(a).length ? a : undefined;
}

/** change.ts hands clip posts here (POST /api/posts/:id/change). */
export async function clipChange(postId: string, text: string): Promise<Post> {
  const a = parseClipChange(text);
  if (!a) {
    const p = db.updatePost(postId, (x) => {
      x.changeRequests = [...(x.changeRequests ?? []), { text, createdAt: nowIso() }];
      x.error = 'For clips, ask e.g. "extend the end by 5s", "start 3s earlier", "trim the start by 2s", "hook: <new title>", "no captions", "center crop", "add music".';
    });
    return p!;
  }
  return adjustClip(postId, a, text);
}

// ---------------------------------------------------------------- public helpers (routes, MCP, chat)
export function startJob(brandId: string, body: any): ClipJob {
  const brand = db.getBrand(brandId);
  if (!brand) throw httpErr(404, "Brand not found");
  const source = resolveSource(brandId, body);
  const options = parseOptions(body);
  if (typeof body?.transcript === "string" && body.transcript.trim()) importTranscript(source, body.transcript, body.transcriptLanguage ?? options.language);
  const j = newJob(brandId, source, options);
  setImmediate(pumpJobs);
  return j;
}

export function importTranscript(source: ClipJob["source"], text: string, language?: string): ClipTranscript {
  let segments;
  try {
    segments = parseTranscript(text);
  } catch (e: any) {
    throw httpErr(400, e?.message ?? String(e));
  }
  const all = segments.map((s) => s.text).join(" ");
  const lang = language && language !== "auto" ? language : /[؀-ۿ]/.test(all) ? "ur" : "en";
  const t = transcriptFromSegments(segments, { language: lang, model: "import", source: "import", durationMs: segments[segments.length - 1]?.endMs ?? 0 });
  saveTranscript(source, t);
  return t;
}

export function jobView(j: ClipJob): ClipJob {
  syncMoments(j);
  return j;
}

export function makeMore(jobId: string, count = 3): ClipJob {
  const j = getJob(jobId);
  if (!j) throw httpErr(404, "Clip job not found");
  if (["queued", "running", "waiting"].includes(j.status)) throw httpErr(409, "This job is still running");
  const out = updateJob(jobId, (x) => {
    (x as ClipJob & { pickMore?: number }).pickMore = Math.max(1, Math.min(10, Math.round(count)));
    x.status = "queued";
    x.error = undefined;
    const p = x.stages.find((s) => s.id === "pick")!;
    Object.assign(p, { status: "pending", progress: 0, finishedAt: undefined });
    const r = x.stages.find((s) => s.id === "render")!;
    Object.assign(r, { status: "pending", progress: 0, finishedAt: undefined });
    x.progress = overall(x);
  })!;
  setImmediate(pumpJobs);
  return out;
}

export function customClip(jobId: string, body: any): ClipJob {
  const j = getJob(jobId);
  if (!j) throw httpErr(404, "Clip job not found");
  let s = Math.round(Number(body?.startMs ?? Number(body?.startSec) * 1000));
  let e = Math.round(Number(body?.endMs ?? Number(body?.endSec) * 1000));
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) throw httpErr(400, "startMs/endMs (or startSec/endSec) are required, end after start");
  const t = loadTranscript(j.source);
  s = Math.max(0, s);
  if (j.source.durationMs) e = Math.min(j.source.durationMs, e);
  if (e - s < 3000) throw httpErr(400, "A clip must be at least 3 seconds long");
  if (e - s > 180_000) throw httpErr(400, "Maximum clip length is 3 minutes");
  const sents = t ? sentences(t) : [];
  const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim() : sents.length ? rangeText(sents, s, e, 70).split(/(?<=[.!?۔؟])\s/)[0] : "Clip";
  const m: ClipMoment = { id: nanoid(8), startMs: s, endMs: e, title, score: 0, source: "custom", why: "Custom range", text: sents.length ? rangeText(sents, s, e) : undefined, status: "pending" };
  const out = updateJob(jobId, (x) => {
    x.moments.push(m);
    if (!["queued", "running", "waiting"].includes(x.status)) {
      x.status = "queued";
      const r = x.stages.find((st) => st.id === "render")!;
      Object.assign(r, { status: "pending", progress: 0, finishedAt: undefined });
    }
    x.progress = overall(x);
  })!;
  setImmediate(pumpJobs);
  return out;
}

export function cancelJob(jobId: string): ClipJob {
  const j = updateJob(jobId, (x) => {
    if (["done", "failed", "cancelled"].includes(x.status)) return;
    x.status = "cancelled";
    x.etaSec = undefined;
    const s = x.stages.find((st) => st.status === "running");
    if (s) s.status = "failed";
  });
  if (!j) throw httpErr(404, "Clip job not found");
  if (currentJob === jobId) currentProc?.kill();
  return j;
}

/** Recover jobs after a restart: running/waiting → queued, then start the worker. */
export function resumeClipJobs() {
  for (const j of listJobs())
    if (j.status === "running" || j.status === "waiting")
      updateJob(j.id, (x) => {
        x.status = "queued";
        for (const s of x.stages) if (s.status === "running") s.status = "pending";
      });
  setTimeout(pumpJobs, 4000);
}

// ---------------------------------------------------------------- routes
async function streamUpload(req: Request, brandId: string): Promise<Asset> {
  const raw = String(req.query.name ?? req.headers["x-filename"] ?? "video.mp4");
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    /* keep */
  }
  name = path.basename(name).slice(0, 200) || "video.mp4";
  const ext = path.extname(name).toLowerCase();
  if (!VIDEO_EXT.includes(ext)) throw httpErr(400, `Unsupported video type: ${name} (mp4, mov, webm, mkv, m4v)`);
  const len = Number(req.headers["content-length"] || 0);
  if (len > MAX_UPLOAD_BYTES) throw httpErr(413, "File too large (max 4 GB)");
  const dir = path.join(UPLOADS_DIR, brandId);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${nanoid(10)}${ext}`);
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      if (bytes > MAX_UPLOAD_BYTES) return cb(httpErr(413, "File too large (max 4 GB)"));
      cb(null, chunk);
    },
  });
  try {
    await pipeline(req, counter, fs.createWriteStream(dest));
  } catch (e) {
    fs.rmSync(dest, { force: true });
    throw e;
  }
  if (!bytes) {
    fs.rmSync(dest, { force: true });
    throw httpErr(400, "Empty upload (send the file as the raw request body)");
  }
  return db.saveAsset({ id: nanoid(12), brandId, kind: "video", url: fileUrlFor(dest), path: dest, originalName: name, mime: MIME[ext] ?? "video/mp4", size: bytes, createdAt: nowIso() });
}

export function registerClipRoutes(app: Express) {
  const brandOr404 = (id: string) => {
    const b = db.getBrand(id);
    if (!b) throw httpErr(404, "Brand not found");
    return b;
  };
  const jobOr404 = (id: string) => {
    const j = getJob(id);
    if (!j) throw httpErr(404, "Clip job not found");
    return j;
  };
  // Long-video upload: raw body streaming (up to 4 GB), ?name=<file name>
  app.post("/api/brands/:id/clips/upload", async (req, res) => {
    const b = brandOr404(String(req.params.id));
    res.status(201).json(await streamUpload(req, b.id));
  });
  app.post("/api/brands/:id/clips/jobs", (req, res) => {
    const b = brandOr404(String(req.params.id));
    res.status(201).json(startJob(b.id, req.body ?? {}));
  });
  app.get("/api/brands/:id/clips/jobs", (req, res) => res.json(listJobs(brandOr404(String(req.params.id)).id).map(jobView)));
  // Paste / upload an existing transcript (SRT, VTT or JSON) for a source; jobs on that source skip transcription
  app.post("/api/brands/:id/clips/transcript", (req, res) => {
    const b = brandOr404(String(req.params.id));
    const source = resolveSource(b.id, req.body ?? {});
    const text = typeof req.body?.transcript === "string" ? req.body.transcript : "";
    if (!text.trim()) throw httpErr(400, "transcript (SRT / VTT / JSON text) is required");
    const t = importTranscript(source, text, req.body?.language);
    res.status(201).json({ ok: true, language: t.language, segments: t.segments.length, durationMs: t.durationMs });
  });
  app.get("/api/clips/jobs/:id", (req, res) => res.json(jobView(jobOr404(String(req.params.id)))));
  app.get("/api/clips/jobs/:id/transcript", (req, res) => {
    const j = jobOr404(String(req.params.id));
    const t = loadTranscript(j.source);
    if (!t) throw httpErr(404, "No transcript yet");
    if (req.query.format === "srt") {
      res.type("text/plain; charset=utf-8").send(toSrt(t));
      return;
    }
    res.json(t);
  });
  app.post("/api/clips/jobs/:id/more", (req, res) => res.json(makeMore(String(req.params.id), Number(req.body?.count) || 3)));
  app.post("/api/clips/jobs/:id/custom", (req, res) => res.status(201).json(customClip(String(req.params.id), req.body ?? {})));
  app.post("/api/clips/jobs/:id/cancel", (req, res) => res.json(cancelJob(String(req.params.id))));
  app.post("/api/clips/jobs/:id/retry", (req, res) => {
    const j = jobOr404(String(req.params.id));
    if (!["failed", "cancelled"].includes(j.status)) throw httpErr(409, `Job is ${j.status}`);
    const out = updateJob(j.id, (x) => {
      x.status = "queued";
      x.error = undefined;
      for (const s of x.stages) if (s.status === "failed" || s.status === "running") Object.assign(s, { status: "pending", progress: 0 });
      for (const m of x.moments) if (m.status === "failed") m.status = "pending";
    });
    setImmediate(pumpJobs);
    res.json(out);
  });
  app.delete("/api/clips/jobs/:id", (req, res) => {
    const j = jobOr404(String(req.params.id));
    if (currentJob === j.id) cancelJob(j.id);
    db.db.prepare("DELETE FROM clip_jobs WHERE id = ?").run(j.id);
    res.json({ ok: true }); // clip posts stay (they are normal posts)
  });
  // Trim / extend / retitle a clip post and re-render: {startDeltaMs?, endDeltaMs?, startMs?, endMs?, hookTitle?, captionStyle?, layout?, music?}
  app.post("/api/posts/:id/clip-adjust", async (req, res) => res.json(await adjustClip(String(req.params.id), req.body ?? {})));
  resumeClipJobs();
}
