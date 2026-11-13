// Audio for reels/stories (both engines), using the ffmpeg-static / ffprobe-static binaries that ship in
// hyperframes/node_modules.
//
// Flow per render:
//   1. attachAutoMusic()   — before rendering: pick a mood-matched track (unless the user removed music).
//   2. prepareHtmlVoice()  — HyperFrames only: synthesize narration, re-time template scenes, rebuild the HTML.
//   3. rendererSpec()      — Remotion gets the spec WITHOUT voice/music (the renderer outputs a silent track).
//   4. masterRender()      — after rendering: keep the silent render as reel.raw.mp4, then mix voice + music
//                            (music ducked under the voice, faded in/out), loudness-normalize to -14 LUFS /
//                            -1.5 dBTP (two-pass loudnorm), AAC 192k 48 kHz, video stream copied. There is
//                            always an audio track (silence if nothing else).
//   remixPost()            — re-runs step 4 on the kept raw render (music change without a full re-render).
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import type { HtmlReelSpec, MusicRef, Post, ReelSpec, Scene } from "../../shared/types.ts";
import { DATA_DIR, ROOT_DIR, fileUrlFor, localPathForUrl } from "./config.ts";
import { getBrand, getPost, getSettings, updatePost, secrets } from "./db.ts";
import { loadVoice, tryLoad, type HyperframesModule } from "./engines.ts";

// ---------------------------------------------------------------- binaries
const hfRequire = createRequire(path.join(ROOT_DIR, "hyperframes", "package.json"));
function resolveBin(pkg: string, pick: (m: any) => string | undefined, env: string): string | undefined {
  if (process.env[env] && fs.existsSync(process.env[env]!)) return process.env[env];
  try {
    const p = pick(hfRequire(pkg));
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* not installed */
  }
  return undefined;
}
export const FFMPEG = resolveBin("ffmpeg-static", (m) => (typeof m === "string" ? m : m?.default), "FFMPEG_PATH");
export const FFPROBE = resolveBin("ffprobe-static", (m) => m?.path, "FFPROBE_PATH");

function run(bin: string | undefined, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (!bin) return reject(new Error("ffmpeg/ffprobe not found (run npm install inside hyperframes/)"));
    const p = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-60_000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${path.basename(bin)} exited ${code}: ${stderr.slice(-1500)}`))));
  });
}

export async function probeMedia(file: string): Promise<{ durationSec: number; hasAudio: boolean; hasVideo: boolean }> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file]);
  const j = JSON.parse(stdout || "{}");
  const types = (j.streams ?? []).map((s: any) => s.codec_type);
  return { durationSec: Number(j.format?.duration) || 0, hasAudio: types.includes("audio"), hasVideo: types.includes("video") };
}

export interface Loudness {
  I: number;      // integrated LUFS
  TP: number;     // true peak dBTP
  LRA: number;
  thresh: number;
  offset: number;
}
function parseLoudnorm(stderr: string): Loudness | undefined {
  const i = stderr.lastIndexOf("{");
  const j = stderr.lastIndexOf("}");
  if (i < 0 || j < i) return undefined;
  try {
    const o = JSON.parse(stderr.slice(i, j + 1));
    const r = {
      I: Number(o.input_i),
      TP: Number(o.input_tp),
      LRA: Number(o.input_lra),
      thresh: Number(o.input_thresh),
      offset: Number(o.target_offset),
    };
    return Object.values(r).every(Number.isFinite) ? r : undefined;
  } catch {
    return undefined;
  }
}

/** Integrated loudness of a file's first audio stream (loudnorm analysis). */
export async function measureLoudness(file: string): Promise<Loudness | undefined> {
  const { stderr } = await run(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]);
  return parseLoudnorm(stderr);
}
const loudCache = new Map<string, number | undefined>();
async function fileLufs(file: string): Promise<number | undefined> {
  const st = fs.statSync(file);
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  if (!loudCache.has(key)) {
    const l = await measureLoudness(file).catch(() => undefined);
    loudCache.set(key, l && l.I > -70 ? l.I : undefined);
  }
  return loudCache.get(key);
}

// ---------------------------------------------------------------- mixing / mastering
export interface VoiceSegment {
  startMs: number;  // slice of the narration file
  endMs: number;
  atMs: number;     // where it starts on the video timeline
}
export interface MasterInput {
  videoPath: string;           // input render (its own audio stream, if any, is kept in the mix)
  outPath: string;
  voice?: { path: string; segments?: VoiceSegment[] };
  music?: { path: string; volume: number };
}
export const TARGET_LUFS = -14;
export const TARGET_TP = -1.5;
const STEM_LUFS = -16;         // voice / music are first levelled to this, then mixed
const FMT = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
const f3 = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** Build the audio filter graph (without the final loudnorm). Returns the graph and the input args. */
async function buildGraph(inp: MasterInput, D: number, videoHasAudio: boolean) {
  const inputs: string[] = ["-i", inp.videoPath];
  const g: string[] = [];
  const mix: string[] = [];
  let idx = 1;
  let voiceLabel: string | undefined;

  if (inp.voice && fs.existsSync(inp.voice.path)) {
    const vi = idx++;
    inputs.push("-i", inp.voice.path);
    const lufs = await fileLufs(inp.voice.path);
    const gain = lufs === undefined ? 0 : Math.max(-12, Math.min(24, STEM_LUFS - lufs));
    // level → clean-up (rumble high-pass, gentle compression)
    const base = `[${vi}:a]${FMT},volume=${f3(gain)}dB,highpass=f=80,acompressor=threshold=-18dB:ratio=3:attack=5:release=100:makeup=1.5`;
    const segs = (inp.voice.segments ?? []).filter((s) => s.endMs > s.startMs);
    if (segs.length) {
      g.push(`${base},asplit=${segs.length}${segs.map((_, k) => `[vs${k}]`).join("")}`);
      segs.forEach((s, k) => {
        const at = Math.max(0, Math.round(s.atMs));
        g.push(`[vs${k}]atrim=start=${f3(s.startMs / 1000)}:end=${f3(s.endMs / 1000)},asetpts=PTS-STARTPTS,adelay=${at}:all=1[vd${k}]`);
      });
      const joined = segs.length > 1 ? `${segs.map((_, k) => `[vd${k}]`).join("")}amix=inputs=${segs.length}:normalize=0:duration=longest,` : `[vd0]`;
      g.push(`${joined}apad=whole_dur=${f3(D)},atrim=end=${f3(D)}[voice]`);
    } else {
      g.push(`${base},apad=whole_dur=${f3(D)},atrim=end=${f3(D)}[voice]`);
    }
    voiceLabel = "voice";
  }

  if (inp.music && fs.existsSync(inp.music.path) && inp.music.volume > 0) {
    const mi = idx++;
    inputs.push("-stream_loop", "-1", "-i", inp.music.path);
    const lufs = await fileLufs(inp.music.path);
    const level = STEM_LUFS - (lufs ?? STEM_LUFS);
    // relative level only matters when something else is in the mix; alone, the master loudnorm sets the level
    const rel = voiceLabel || videoHasAudio ? 20 * Math.log10(Math.max(0.01, inp.music.volume)) : 0;
    const fadeOut = Math.min(2, D / 4);
    g.push(
      `[${mi}:a]${FMT},volume=${f3(Math.max(-30, Math.min(24, level + rel)))}dB,atrim=end=${f3(D)},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=${f3(Math.min(1, D / 4))},afade=t=out:st=${f3(Math.max(0, D - fadeOut))}:d=${f3(fadeOut)}[mus]`,
    );
    if (voiceLabel) {
      // duck the music ~8–10 dB while the voice speaks
      g.push(`[voice]asplit=2[vmix][vsc]`);
      g.push(`[mus][vsc]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=400[mduck]`);
      mix.push("[vmix]", "[mduck]");
    } else mix.push("[mus]");
  } else if (voiceLabel) mix.push("[voice]");

  if (videoHasAudio) {
    g.push(`[0:a]${FMT}[orig]`);
    mix.push("[orig]");
  }
  if (!mix.length) return undefined;
  const body = mix.length > 1 ? `${mix.join("")}amix=inputs=${mix.length}:normalize=0:duration=longest,` : `${mix[0]}`;
  g.push(`${body}apad=whole_dur=${f3(D)},atrim=end=${f3(D)}[mix]`);
  return { inputs, graph: g.join(";") };
}

/** Mix + master. Writes inp.outPath (video copied). Returns the measured output loudness. */
export async function masterAudio(inp: MasterInput): Promise<{ lufs?: number; truePeak?: number }> {
  const info = await probeMedia(inp.videoPath);
  if (!info.hasVideo) throw new Error("render has no video stream");
  const D = info.durationSec || 1;
  const built = await buildGraph(inp, D, info.hasAudio);
  const tmp = inp.outPath.replace(/\.mp4$/i, "") + `.mastering-${process.pid}.mp4`;
  const outArgs = ["-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", f3(D), "-movflags", "+faststart", "-y", tmp];
  try {
    if (!built) {
      // nothing to mix: add a silent stereo track (Instagram handles stream-less videos poorly)
      await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", inp.videoPath, "-f", "lavfi", "-t", f3(D), "-i", "anullsrc=r=48000:cl=stereo", "-filter_complex", "[1:a]anull[aout]", ...outArgs]);
    } else {
      // pass 1: measure the mix
      const target = `I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=11`;
      const p1 = await run(FFMPEG, ["-hide_banner", "-nostats", ...built.inputs, "-filter_complex", `${built.graph};[mix]loudnorm=${target}:print_format=json[aout]`, "-map", "[aout]", "-f", "null", "-"]);
      const m = parseLoudnorm(p1.stderr);
      // pass 2: linear normalization with the measured values (silent mixes are just encoded)
      const norm =
        m && m.I > -60
          ? `[mix]loudnorm=${target}:measured_I=${m.I}:measured_TP=${m.TP}:measured_LRA=${m.LRA}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true,aresample=48000[aout]`
          : `[mix]anull[aout]`;
      await run(FFMPEG, ["-hide_banner", "-loglevel", "error", ...built.inputs, "-filter_complex", `${built.graph};${norm}`, ...outArgs]);
    }
    fs.renameSync(tmp, inp.outPath);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  const out = await measureLoudness(inp.outPath).catch(() => undefined);
  return { lufs: out?.I, truePeak: out?.TP };
}

// ---------------------------------------------------------------- render integration
type AudioSpec = (ReelSpec | HtmlReelSpec) & { music?: MusicRef; musicOff?: boolean };

/** Before rendering: attach an auto-picked track when auto-music is on and the user has not removed music. */
export async function attachAutoMusic(postId: string): Promise<void> {
  const s = getSettings();
  const post = getPost(postId);
  if (!post || post.type === "carousel" || !s.autoMusic) return;
  const spec = post.spec as AudioSpec;
  if (spec.music?.src || spec.musicOff) return;
  const { autoMusicFor } = await import("./music.ts");
  const ref = await autoMusicFor(post).catch((e) => {
    console.warn("[audio] auto-music pick failed:", e?.message ?? e);
    return undefined;
  });
  if (!ref) return;
  updatePost(postId, (x) => {
    const sp = x.spec as AudioSpec;
    if (!sp.music?.src && !sp.musicOff) sp.music = ref;
  });
}

/** The spec handed to the Remotion renderer: voice and music are mixed by masterRender() instead. */
export function rendererSpec<T extends ReelSpec>(spec: T): T {
  const { music: _m, voiceover: _v, ...rest } = spec;
  return rest as T;
}

async function configureVoiceModule(v: { configure?: (o: any) => void }) {
  try {
    v.configure?.({ pexelsApiKey: secrets.pexels(), pixabayApiKey: secrets.pixabay(), dataDir: DATA_DIR });
  } catch {
    /* optional */
  }
}

/**
 * HyperFrames: synthesize narration (template scenes' voiceoverText, or spec.narration for custom HTML).
 * Template reels get their scenes stretched to the narration and the HTML rebuilt, with each scene's line
 * placed at the scene start. Persists and returns the updated spec.
 */
export async function prepareHtmlVoice(postId: string, spec: HtmlReelSpec, outDir: string, h: HyperframesModule): Promise<HtmlReelSpec> {
  const s = getSettings();
  if (!s.autoVoiceover || spec.voiceover?.src) return spec;
  const ti = spec.templateInput;
  let tplScenes: Scene[] = ti && spec.template && Array.isArray(ti.scenes) ? ti.scenes : [];
  if (tplScenes.length) {
    // Only re-time when the HTML is still exactly the template's output; never overwrite hand/LLM-edited HTML.
    try {
      if (h.buildFromTemplate(spec.template!, ti!).html !== spec.html) {
        console.warn("[audio] HTML was edited after it was built from the template; not re-timing it to a voiceover");
        tplScenes = [];
      }
    } catch {
      tplScenes = [];
    }
  }
  const tplLines = tplScenes.filter((sc) => sc.voiceoverText?.trim());
  const narr = tplLines.length ? [] : (spec.narration ?? []).filter((n) => n?.text?.trim());
  if (!tplLines.length && !narr.length) return spec;
  const v = await tryLoad(loadVoice);
  if (!v) return spec;
  try {
    await configureVoiceModule(v);
    const voDir = path.join(outDir, "voice");
    fs.mkdirSync(voDir, { recursive: true });
    const lines = tplLines.length
      ? tplLines.map((sc) => ({ id: sc.id, text: sc.voiceoverText!.trim() }))
      : narr.map((n, i) => ({ id: String(n.id ?? `n${i + 1}`), text: n.text.trim() }));
    // same voice/language choice as Remotion reels (Urdu script → Urdu voice, brand voice override)
    const { narrationFor } = await import("./language.ts");
    const brandId = getPost(postId)?.brandId;
    const vo = narrationFor({ voice: spec.voice, scenes: lines.map((l) => ({ id: l.id, durationSec: 3, headline: "", voiceoverText: l.text })) } as unknown as ReelSpec, brandId ? getBrand(brandId) : undefined, s.voice);
    const res = await v.synthesizeScenes(lines, { voice: vo.voice, lang: vo.lang, outDir: voDir });
    let audioPath = res.path;
    if (!path.resolve(audioPath).startsWith(path.resolve(DATA_DIR))) {
      const dest = path.join(voDir, "narration" + (path.extname(audioPath) || ".wav"));
      fs.copyFileSync(audioPath, dest);
      audioPath = dest;
    }
    let next: HtmlReelSpec;
    if (tplLines.length) {
      const LEAD = 0.15; // narration starts just after the scene's entrance
      const PAD = 0.4;
      const timing = new Map(res.scenes.map((t) => [t.id, t]));
      const segments: VoiceSegment[] = [];
      let t = 0;
      const scenes = tplScenes.map((sc) => {
        const tm = timing.get(sc.id);
        let dur = Number(sc.durationSec) || 3;
        if (tm) {
          dur = Math.max(dur * 0.6, 1.5, (tm.endMs - tm.startMs) / 1000 + LEAD + PAD);
          segments.push({ startMs: tm.startMs, endMs: tm.endMs, atMs: Math.round((t + LEAD) * 1000) });
        }
        dur = Math.min(12, Math.max(1.2, Math.ceil(dur * 10) / 10)); // same clamp/rounding as the templates
        t += dur;
        return { ...sc, durationSec: dur };
      });
      const rebuilt = h.buildFromTemplate(spec.template!, { brand: ti!.brand ?? spec.brand!, scenes, cta: ti!.cta });
      next = {
        ...spec,
        html: rebuilt.html,
        durationSec: rebuilt.durationSec,
        assets: rebuilt.assets,
        templateInput: { brand: ti!.brand ?? spec.brand!, scenes, ...(ti!.cta ? { cta: ti!.cta } : {}) },
        voiceover: { src: fileUrlFor(audioPath), segments },
      };
    } else {
      next = { ...spec, voiceover: { src: fileUrlFor(audioPath) } };
    }
    updatePost(postId, (x) => {
      x.spec = next;
    });
    return next;
  } catch (e: any) {
    console.warn("[audio] HyperFrames voiceover failed, rendering without narration:", e?.message ?? e);
    return spec;
  }
}

function rawPathFor(videoPath: string) {
  return videoPath.replace(/\.mp4$/i, "") + ".raw.mp4";
}

async function masterFromPost(post: Post, rawPath: string, videoPath: string) {
  const spec = post.spec as AudioSpec;
  const s = getSettings();
  const voicePath = spec.voiceover?.src ? localPathForUrl(spec.voiceover.src) : undefined;
  const segments = (spec as HtmlReelSpec).voiceover?.segments;
  let music: MasterInput["music"];
  if (spec.music?.src && !spec.musicOff) {
    const { musicFileFor } = await import("./music.ts");
    const mp = await musicFileFor(spec.music, path.dirname(videoPath));
    if (mp) music = { path: mp, volume: typeof spec.music.volume === "number" ? spec.music.volume : s.musicVolume };
  }
  const t0 = Date.now();
  const r = await masterAudio({
    videoPath: rawPath,
    outPath: videoPath,
    voice: voicePath && fs.existsSync(voicePath) ? { path: voicePath, segments } : undefined,
    music,
  });
  console.log(
    `[audio] ${post.id}: mastered in ${((Date.now() - t0) / 1000).toFixed(1)}s — voice:${voicePath ? "yes" : "no"} music:${music ? path.basename(music.path) : "no"} → ${r.lufs?.toFixed(1)} LUFS, ${r.truePeak?.toFixed(1)} dBTP`,
  );
  return r;
}

/**
 * After rendering: keep the renderer's output as reel.raw.mp4 and write the mastered file to videoPath.
 * Never fails the render: on error the unmastered video is kept.
 */
export async function masterRender(postId: string, videoPath: string): Promise<void> {
  const raw = rawPathFor(videoPath);
  try {
    fs.renameSync(videoPath, raw);
  } catch (e: any) {
    console.warn("[audio] cannot keep raw render:", e?.message ?? e);
    return;
  }
  try {
    const post = getPost(postId);
    if (!post) throw new Error("post disappeared");
    await masterFromPost(post, raw, videoPath);
  } catch (e: any) {
    console.warn("[audio] mastering failed, keeping the unmastered render:", e?.message ?? e);
    fs.copyFileSync(raw, videoPath);
  }
}

/** Re-mix the audio of the current render (after a music change). Returns false when a full render is needed. */
export async function remixPost(postId: string): Promise<boolean> {
  const post = getPost(postId);
  const url = post?.mediaUrls?.[0];
  if (!post || !url || post.type === "carousel") return false;
  const videoPath = localPathForUrl(url);
  if (!videoPath || !fs.existsSync(rawPathFor(videoPath))) return false;
  await masterFromPost(post, rawPathFor(videoPath), videoPath);
  updatePost(postId, (x) => {
    x.updatedAt = new Date().toISOString();
  });
  return true;
}
