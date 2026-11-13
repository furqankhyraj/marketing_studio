// Render queue: one render at a time. Dispatches to renderer/ (Remotion) or hyperframes/ (HTML) and
// optionally generates a voiceover + word captions with voice/ before rendering Remotion reels.
import path from "node:path";
import fs from "node:fs";
import type { Post, ReelSpec, CarouselSpec, HtmlReelSpec } from "../../shared/types.ts";
import { RENDERS_DIR, DATA_DIR, fileUrlFor } from "./config.ts";
import { getPost, updatePost, listPosts, getSettings, secrets, getBrand } from "./db.ts";
import { narrationFor, brandLanguage } from "./language.ts";
import { loadRenderer, loadHyperframes, loadVoice, tryLoad, type VoiceModule } from "./engines.ts";
import { isCarouselSpec, isHtmlSpec } from "./posts.ts";
import { attachAutoMusic, prepareHtmlVoice, rendererSpec, masterRender } from "./audio.ts";
import { renderImageOutputs } from "./imagepost.ts";

const queue: string[] = [];
let running: string | undefined;
const rerun = new Set<string>();

export function enqueueRender(postId: string): Post | undefined {
  const p = updatePost(postId, (x) => {
    x.status = "rendering";
    x.renderProgress = 0;
    x.error = undefined;
  });
  if (!p) return undefined;
  if (running === postId) rerun.add(postId); // edited while rendering: render again with the new spec when this one ends
  else if (!queue.includes(postId)) queue.push(postId);
  setImmediate(pump);
  return p;
}

export function queueState() {
  return { running, queued: [...queue] };
}

/** On boot: re-queue posts left in "rendering" by a previous process. */
export function resumeRenderQueue() {
  for (const p of listPosts({ status: "rendering" })) enqueueRender(p.id);
}

async function pump() {
  if (running) return;
  const id = queue.shift();
  if (!id) return;
  running = id;
  try {
    await renderOne(id);
  } catch (e: any) {
    console.error(`[render] ${id} failed:`, e?.message ?? e);
    updatePost(id, (x) => {
      x.status = "failed";
      delete x.approvedPending;
      x.error = `Render failed: ${e?.message ?? e}`;
      x.renderProgress = undefined;
    });
  } finally {
    running = undefined;
    if (rerun.delete(id)) enqueueRender(id);
    setImmediate(pump);
  }
}

let lastProgressWrite = 0;
function progress(id: string, p: number) {
  const now = Date.now();
  if (now - lastProgressWrite < 500 && p < 1) return;
  lastProgressWrite = now;
  updatePost(id, (x) => {
    if (x.status === "rendering") x.renderProgress = Math.max(0, Math.min(1, p));
  });
}

export async function configureVoice(v: VoiceModule) {
  try {
    v.configure?.({ pexelsApiKey: secrets.pexels(), pixabayApiKey: secrets.pixabay(), dataDir: DATA_DIR });
  } catch {
    /* optional */
  }
}

/** Synthesize narration for scenes with voiceoverText; stretch durations; add word captions. */
async function addVoiceover(spec: ReelSpec, outDir: string, brandId?: string): Promise<ReelSpec> {
  const s = getSettings();
  const lines = spec.scenes.filter((sc) => sc.voiceoverText?.trim());
  if (!s.autoVoiceover || !lines.length || spec.voiceover?.src) return spec;
  const v = await tryLoad(loadVoice);
  if (!v) return spec;
  try {
    await configureVoice(v);
    const voDir = path.join(outDir, "voice");
    fs.mkdirSync(voDir, { recursive: true });
    const vo = narrationFor(spec, brandId ? getBrand(brandId) : undefined, s.voice); // Urdu script → Piper Urdu voice
    const res = await v.synthesizeScenes(
      lines.map((sc) => ({ id: sc.id, text: sc.voiceoverText!.trim(), captionText: sc.captionText })),
      { voice: vo.voice, lang: vo.lang, outDir: voDir },
    );
    // Move/copy audio into the render dir so it is served under /files
    let audioPath = res.path;
    if (!path.resolve(audioPath).startsWith(path.resolve(DATA_DIR))) {
      const dest = path.join(voDir, "narration" + (path.extname(audioPath) || ".wav"));
      fs.copyFileSync(audioPath, dest);
      audioPath = dest;
    }
    // Stretch scenes. The narration is concatenated in scene order; scenes without narration keep their
    // duration and are inserted as gaps, so we rebuild the timeline: each narrated scene lasts its span + padding.
    const PAD = 0.35;
    const timing = new Map(res.scenes.map((t) => [t.id, t]));
    const sceneStartMs = new Map<string, number>(); // video timeline start for each scene
    let videoMs = 0;
    const segs: { audioStart: number; audioEnd: number; videoStart: number }[] = [];
    const scenes = spec.scenes.map((sc) => {
      const t = timing.get(sc.id);
      let dur = sc.durationSec;
      if (t) {
        dur = Math.max(1.5, (t.endMs - t.startMs) / 1000 + PAD);
        segs.push({ audioStart: t.startMs, audioEnd: t.endMs, videoStart: videoMs });
      }
      sceneStartMs.set(sc.id, videoMs);
      videoMs += dur * 1000;
      return { ...sc, durationSec: Math.round(dur * 100) / 100 };
    });
    const next: ReelSpec = { ...spec, scenes, voiceover: { src: fileUrlFor(audioPath) } };
    // The renderer plays the narration as one track from t=0, so offsets only line up exactly when
    // narrated scenes are contiguous from the start. That is the planner's normal output.
    try {
      const words = await v.transcribeWords(audioPath, { lang: vo.lang });
      if (Array.isArray(words) && words.length) {
        next.captions = words.map((w) => {
          // map audio time → video time via the segment containing it
          const seg = segs.find((g) => w.startMs >= g.audioStart - 50 && w.startMs <= g.audioEnd + 50);
          const shift = seg ? seg.videoStart - seg.audioStart : 0;
          return { text: w.text, startMs: Math.max(0, w.startMs + shift), endMs: Math.max(0, w.endMs + shift) };
        });
      }
    } catch (e: any) {
      console.warn("[render] transcribeWords failed:", e?.message ?? e);
    }
    return next;
  } catch (e: any) {
    console.warn("[render] voiceover failed, rendering without narration:", e?.message ?? e);
    return spec;
  }
}

async function renderOne(id: string) {
  const post = getPost(id);
  if (!post) return;
  const outDir = path.join(RENDERS_DIR, post.id, `r${post.revision}`);
  fs.mkdirSync(outDir, { recursive: true });
  const spec = post.spec as any;
  // Arabic brands: stamp the language on the post so the renderer uses Naskh (not Urdu Nastaliq) for Arabic script.
  if (spec && typeof spec === "object" && !spec.language && brandLanguage(getBrand(post.brandId)) === "ar") {
    spec.language = "ar";
    updatePost(id, (x) => void (x.spec.language = "ar"));
  }

  if (post.type === "image") {
    // single 4:5 graphic (Remotion still) → image.jpg + thumb.jpg
    const r = await renderImageOutputs(post, outDir, (p) => progress(id, p));
    finish(id, r.urls, r.thumb);
    return;
  }

  if (post.type === "carousel" || isCarouselSpec(spec)) {
    const r = await loadRenderer();
    progress(id, 0.1);
    const { imagePaths } = await r.renderCarousel(spec as CarouselSpec, outDir);
    if (!imagePaths?.length) throw new Error("renderer returned no slides");
    const urls = imagePaths.map(fileUrlFor);
    finish(id, urls, urls[0]);
    return;
  }

  if (spec?.engine === "clip") {
    // clip cut from a long video (clips agent): ffmpeg cut/reframe → Remotion ClipReel → mastering
    const res = await (await import("./clips.ts")).renderClipPost(id, outDir, (p) => progress(id, p));
    finish(id, [fileUrlFor(res.videoPath)], res.thumbnailPath ? fileUrlFor(res.thumbnailPath) : undefined);
    return;
  }

  if (isHtmlSpec(spec)) {
    const h = await loadHyperframes();
    await attachAutoMusic(id);
    const html = await prepareHtmlVoice(id, (getPost(id)?.spec ?? spec) as HtmlReelSpec, outDir, h);
    const res = await h.renderHtmlReel(html, outDir, (p) => progress(id, p * 0.97));
    await masterRender(id, res.videoPath); // mux voice + music, loudness-normalize
    finish(id, [fileUrlFor(res.videoPath)], res.thumbnailPath ? fileUrlFor(res.thumbnailPath) : undefined);
    return;
  }

  // Remotion reel / story
  const r = await loadRenderer();
  await attachAutoMusic(id);
  let reel = (getPost(id)?.spec ?? spec) as ReelSpec;
  const voiced = await addVoiceover(reel, outDir, post.brandId);
  if (voiced !== reel) {
    reel = voiced;
    updatePost(id, (x) => {
      // Save only what the voice step produced, onto the LATEST spec: an edit made while this render ran
      // (style, media, music…) must not be overwritten by the copy this render started with.
      const cur = x.spec as ReelSpec | undefined;
      const same = !!cur && Array.isArray(cur.scenes) && cur.scenes.length === voiced.scenes.length && cur.scenes.every((s, i) => (s.voiceoverText ?? "") === (voiced.scenes[i].voiceoverText ?? ""));
      if (!cur || !Array.isArray(cur.scenes)) x.spec = voiced;
      else if (same) {
        cur.voiceover = voiced.voiceover;
        cur.captions = voiced.captions;
        cur.scenes = cur.scenes.map((s, i) => ({ ...s, durationSec: voiced.scenes[i].durationSec }));
      } // narration text changed meanwhile → keep the edit; the next render makes a fresh voiceover
    });
  }
  // voice + music are mixed after the render (ducking + loudness normalization), not by Remotion
  const res = await r.renderReel(rendererSpec(reel), outDir, (p) => progress(id, p));
  await masterRender(id, res.videoPath);
  finish(id, [fileUrlFor(res.videoPath)], res.thumbnailPath ? fileUrlFor(res.thumbnailPath) : undefined);
}

function finish(id: string, mediaUrls: string[], thumb?: string) {
  updatePost(id, (x) => {
    x.mediaUrls = mediaUrls;
    x.thumbnailUrl = thumb;
    x.renderProgress = 1;
    x.error = undefined;
    if (x.status === "rendering" || x.status === "changes_requested") x.status = x.approvedPending ? "approved" : "ready";
    delete x.approvedPending;
  });
}
