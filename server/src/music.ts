// Music library: built-in procedural tracks (generated locally → licence-free), files dropped in
// data/music/library/ (optional metadata), and audio assets uploaded per brand.
// Also: auto-pick of a mood-matched track per post, the music routes and the music settings.
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import type { Brand, MusicRef, MusicTrack, Post } from "../../shared/types.ts";
import { DATA_DIR, SERVER_URL, localPathForUrl } from "./config.ts";
import * as db from "./db.ts";
import { MOODS, getMood, moodDurationSec } from "./musicgen.ts";
import { probeMedia } from "./audio.ts";

export const MUSIC_DIR = path.join(DATA_DIR, "music");
export const BUILTIN_DIR = path.join(MUSIC_DIR, "builtin");
export const LIBRARY_DIR = path.join(MUSIC_DIR, "library");
for (const d of [BUILTIN_DIR, LIBRARY_DIR]) fs.mkdirSync(d, { recursive: true });

/** Bump when musicgen.ts changes so cached WAVs are regenerated. */
const GEN_VERSION = "v1";
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
export const MOOD_IDS = MOODS.map((m) => m.id);

// ---------------------------------------------------------------- optional online providers
/**
 * Interface for online royalty-free sources. None is enabled: Pixabay's API has no music endpoint and
 * Jamendo's API terms are non-commercial. A Freesound (CC0 filter) or Openverse provider can implement this,
 * download into LIBRARY_DIR and write a sidecar JSON with licence + credit.
 */
export interface MusicProvider {
  id: string;
  available(): boolean;
  search(query: string, opts: { mood?: string; minSec?: number; maxSec?: number }): Promise<MusicTrack[]>;
  download(track: MusicTrack): Promise<MusicTrack>; // must end up as a "library:" track with licence metadata
}
export const providers: MusicProvider[] = [];

// ---------------------------------------------------------------- built-in tracks
const builtinFile = (mood: string) => path.join(BUILTIN_DIR, `${mood}-${GEN_VERSION}.wav`);
const tsxLoader = (() => {
  try {
    return import.meta.resolve("tsx");
  } catch {
    return undefined;
  }
})();
const generating = new Map<string, Promise<string>>();
let genChain: Promise<unknown> = Promise.resolve();

/** Path of a built-in track's WAV, rendering it first (in a child process, one at a time) if needed. */
export function ensureBuiltin(mood: string): Promise<string> {
  const m = getMood(mood);
  if (!m) return Promise.reject(new Error(`Unknown mood "${mood}". Moods: ${MOOD_IDS.join(", ")}`));
  const file = builtinFile(m.id);
  if (fs.existsSync(file)) return Promise.resolve(file);
  const cur = generating.get(m.id);
  if (cur) return cur;
  const job = genChain.then(
    () =>
      new Promise<string>((resolve, reject) => {
        if (fs.existsSync(file)) return resolve(file);
        const script = fileURLToPath(new URL("./musicgen.ts", import.meta.url));
        const args = tsxLoader ? ["--import", tsxLoader, script, m.id, file] : [script, m.id, file];
        const t0 = Date.now();
        const p = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
        let err = "";
        p.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
        p.on("error", reject);
        p.on("close", (code) => {
          if (code === 0 && fs.existsSync(file)) {
            console.log(`[music] generated built-in "${m.id}" in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
            resolve(file);
          } else reject(new Error(`music generator failed (${code}): ${err.trim()}`));
        });
      }),
  );
  genChain = job.catch(() => undefined);
  generating.set(m.id, job);
  job.finally(() => generating.delete(m.id)).catch(() => undefined);
  return job;
}

function builtinTracks(): MusicTrack[] {
  return MOODS.map((m) => ({
    id: `builtin:${m.id}`,
    name: m.name,
    mood: m.id,
    energy: m.energy,
    source: "builtin",
    url: `${SERVER_URL}/files/music/builtin/${m.id}-${GEN_VERSION}.wav`,
    durationSec: Math.round(moodDurationSec(m) * 10) / 10,
    license: "Generated locally by Social MCP Studio — royalty-free, no attribution needed",
    description: m.description,
  })) as MusicTrack[];
}

// ---------------------------------------------------------------- library + assets
interface TrackMeta {
  name?: string;
  mood?: string;
  energy?: number;
  bpm?: number;
  license?: string;
  sourceUrl?: string;
  credit?: string;
}
function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}
const durationCache = new Map<string, number>();
async function durationOf(file: string): Promise<number | undefined> {
  try {
    const st = fs.statSync(file);
    const key = `${file}|${st.size}|${st.mtimeMs}`;
    if (durationCache.has(key)) return durationCache.get(key);
    const d = (await probeMedia(file)).durationSec;
    if (d > 0) durationCache.set(key, Math.round(d * 10) / 10);
    return durationCache.get(key);
  } catch {
    return undefined;
  }
}

async function libraryTracks(): Promise<(MusicTrack & { path: string })[]> {
  let files: string[] = [];
  try {
    files = fs.readdirSync(LIBRARY_DIR).filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()));
  } catch {
    return [];
  }
  const manifest = readJson(path.join(LIBRARY_DIR, "manifest.json")) ?? {};
  const out: (MusicTrack & { path: string })[] = [];
  for (const f of files) {
    const abs = path.join(LIBRARY_DIR, f);
    const side = readJson(path.join(LIBRARY_DIR, f.replace(/\.[^.]+$/, ".json"))) ?? {};
    const meta: TrackMeta = { ...(manifest[f] ?? {}), ...side };
    const mood = meta.mood && MOOD_IDS.includes(String(meta.mood).toLowerCase()) ? String(meta.mood).toLowerCase() : meta.mood;
    out.push({
      id: `library:${f}`,
      name: meta.name || f.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
      mood,
      energy: Number(meta.energy) || undefined,
      source: "library",
      url: `${SERVER_URL}/files/music/library/${encodeURIComponent(f)}`,
      durationSec: await durationOf(abs),
      license: meta.license,
      credit: meta.credit,
      path: abs,
    });
  }
  return out;
}

async function assetTracks(brandId?: string): Promise<(MusicTrack & { path: string })[]> {
  const brands = brandId ? [brandId] : db.listBrands().map((b) => b.id);
  const out: (MusicTrack & { path: string })[] = [];
  for (const b of brands) {
    for (const a of db.listAssets(b)) {
      if (a.kind !== "audio") continue;
      out.push({
        id: `asset:${a.id}`,
        name: a.originalName.replace(/\.[^.]+$/, ""),
        source: "asset",
        url: a.url,
        durationSec: await durationOf(a.path),
        brandId: a.brandId,
        path: a.path,
      });
    }
  }
  return out;
}

export async function listTracks(brandId?: string): Promise<MusicTrack[]> {
  const strip = <T extends { path?: string }>(t: T) => {
    const { path: _p, ...rest } = t;
    return rest;
  };
  return [...builtinTracks(), ...(await libraryTracks()).map(strip), ...(await assetTracks(brandId)).map(strip)] as MusicTrack[];
}

/** Resolve a track id to its metadata and local file (built-in tracks are generated on demand). */
export async function resolveTrack(id: string): Promise<{ track: MusicTrack; path: string } | undefined> {
  if (id.startsWith("builtin:")) {
    const mood = id.slice(8);
    const track = builtinTracks().find((t) => t.id === id);
    if (!track) return undefined;
    return { track, path: await ensureBuiltin(mood) };
  }
  if (id.startsWith("library:")) {
    const t = (await libraryTracks()).find((x) => x.id === id);
    return t ? { track: t, path: t.path } : undefined;
  }
  if (id.startsWith("asset:")) {
    const a = db.getAsset(id.slice(6));
    if (!a || a.kind !== "audio") return undefined;
    return { track: { id, name: a.originalName, source: "asset", url: a.url, brandId: a.brandId }, path: a.path };
  }
  return undefined;
}

/** Local file for a MusicRef (track id first, then our /files URL, else download a remote URL into dir). */
export async function musicFileFor(ref: MusicRef, downloadDir: string): Promise<string | undefined> {
  if (ref.trackId) {
    try {
      const r = await resolveTrack(ref.trackId);
      if (r && fs.existsSync(r.path)) return r.path;
    } catch (e: any) {
      console.warn("[music] track unavailable:", e?.message ?? e);
    }
  }
  if (!ref.src) return undefined;
  const builtin = ref.src.match(/\/files\/music\/builtin\/([a-z]+)-v\d+\.wav$/);
  if (builtin) return ensureBuiltin(builtin[1]).catch(() => undefined);
  const lib = ref.src.match(/\/files\/music\/library\/([^/?#]+)$/);
  if (lib) {
    const f = path.join(LIBRARY_DIR, decodeURIComponent(lib[1]));
    return fs.existsSync(f) ? f : undefined;
  }
  const local = localPathForUrl(ref.src);
  if (local && fs.existsSync(local)) return local;
  if (/^https?:\/\//i.test(ref.src)) {
    try {
      const res = await fetch(ref.src, { signal: AbortSignal.timeout(60_000), redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ext = path.extname(new URL(ref.src).pathname).toLowerCase();
      fs.mkdirSync(downloadDir, { recursive: true });
      const out = path.join(downloadDir, `music${AUDIO_EXT.has(ext) ? ext : ".mp3"}`);
      fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      return out;
    } catch (e: any) {
      console.warn(`[music] could not download ${ref.src.slice(0, 100)}: ${e?.message ?? e}`);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- auto-pick
const MOOD_RULES: [string, RegExp, number][] = [
  ["elegant", /\b(jewel(le)?ry|jewel|necklace|ring|rings|earring|bracelet|pendant|gold|silver|diamond|gem|luxury|luxe|elegant|premium|bridal|wedding|fashion|boutique|perfume|beauty|skincare|silk)\w*/g, 2],
  ["lofi", /\b(handmade|hand-made|etsy|craft|crafts|cozy|cosy|vintage|candle|pottery|ceramic|knit|crochet|sticker|stationery|art|artist|studio|coffee|aesthetic|behind the scenes|bts|chill|relax)\w*/g, 1.5],
  ["focus", /\b(course|academy|learn|learning|lesson|education|educational|teach|teacher|tutor|school|study|student|exam|quran|arabic|language|class|classes|explainer|how to|guide|tutorial|tips|knowledge)\w*/g, 1.5],
  ["inspiring", /\b(inspir|motivat|success|business|career|growth|grow|coach|leader|entrepreneur|mission|achieve|confidence|transform|journey|dream|goal|community)\w*/g, 1.2],
  ["upbeat", /\b(sale|discount|deal|launch|new drop|drop|fitness|gym|energy|energetic|party|hype|trend|offer|limited|giveaway|announcement|bold)\w*/g, 1.2],
  ["playful", /\b(kid|kids|child|children|toy|toys|pet|pets|dog|cat|fun|funny|playful|game|games|cute|colorful|colourful|cartoon|baby)\w*/g, 1.3],
  ["cinematic", /\b(story|stories|epic|cinematic|film|travel|adventure|reveal|before and after|before|after|legacy|history|dramatic)\w*/g, 1],
  ["calm", /\b(calm|wellness|yoga|spa|meditat|sleep|nature|tea|mindful|peace|peaceful|soft|gentle|organic|natural|slow|herbal|self-care|selfcare)\w*/g, 1.2],
];

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Score moods from the brand brain (heavier) and the post text. Deterministic. */
export function pickMood(brand: Brand | undefined, post: Pick<Post, "title" | "hook" | "caption"> | undefined): string {
  const forced = db.getSettings().defaultMusicMood;
  if (forced && MOOD_IDS.includes(forced)) return forced;
  const b = brand?.brain;
  const brandText = [b?.niche, b?.voice, b?.summary, ...(b?.products ?? []), ...(b?.keywords ?? []), ...(b?.contentPillars ?? []), brand?.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const postText = [post?.title, post?.hook, post?.caption].filter(Boolean).join(" ").toLowerCase();
  const score = new Map<string, number>();
  for (const [mood, re, w] of MOOD_RULES) {
    const n1 = (brandText.match(re) ?? []).length;
    const n2 = (postText.match(re) ?? []).length;
    score.set(mood, (Math.min(n1, 6) * 1 + Math.min(n2, 4) * 1.5) * w);
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > 0 ? ranked[0][0] : "lofi";
}

/** A deterministic (per post id) track for the post's mood: built-in + library tracks tagged with that mood. */
export async function autoMusicFor(post: Post): Promise<MusicRef | undefined> {
  const brand = db.getBrand(post.brandId);
  const mood = pickMood(brand, post);
  const lib = (await libraryTracks()).filter((t) => t.mood === mood);
  const candidates: MusicTrack[] = [...builtinTracks().filter((t) => t.mood === mood), ...lib];
  if (!candidates.length) return undefined;
  const t = candidates[hashStr(post.id) % candidates.length];
  return { src: t.url, trackId: t.id, auto: true, ...(t.credit ? { credit: t.credit } : {}) };
}

// ---------------------------------------------------------------- routes
class HttpErr extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function registerMusicRoutes(app: Express) {
  // Music settings. Runs before the main PATCH /api/settings handler (registered later), which saves the
  // other keys and returns the full Settings object.
  app.patch("/api/settings", (req, _res, next) => {
    const b = req.body ?? {};
    if (b.musicVolume !== undefined) {
      const v = Number(b.musicVolume);
      if (!Number.isFinite(v) || v < 0 || v > 1) throw new HttpErr(400, "musicVolume must be a number between 0 and 1");
    }
    if (typeof b.defaultMusicMood === "string" && b.defaultMusicMood.trim() && !MOOD_IDS.includes(b.defaultMusicMood.trim()))
      throw new HttpErr(400, `defaultMusicMood must be one of: ${MOOD_IDS.join(", ")} (or empty for automatic)`);
    if (typeof b.autoMusic === "boolean") db.setSetting("autoMusic", String(b.autoMusic));
    if (b.musicVolume !== undefined) db.setSetting("musicVolume", String(Math.round(Number(b.musicVolume) * 100) / 100));
    if (typeof b.defaultMusicMood === "string" || b.defaultMusicMood === null) db.setSetting("defaultMusicMood", (b.defaultMusicMood ?? "").trim());
    next();
  });

  // Built-in tracks are generated on first request.
  app.get("/files/music/builtin/:file", async (req, res, next) => {
    const m = String(req.params.file).match(/^([a-z]+)-(v\d+)\.wav$/);
    if (!m || !getMood(m[1])) return next(new HttpErr(404, "Track not found"));
    try {
      const file = await ensureBuiltin(m[1]);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.sendFile(file);
    } catch (e: any) {
      next(new HttpErr(500, e?.message ?? String(e)));
    }
  });
  app.use("/files/music/library", express.static(LIBRARY_DIR, { fallthrough: false, maxAge: "1h" }));

  app.get("/api/music", async (req, res) => {
    const brandId = typeof req.query.brandId === "string" && req.query.brandId ? req.query.brandId : undefined;
    res.json(await listTracks(brandId));
  });

  app.get("/api/music/moods", (_req, res) =>
    res.json(MOODS.map((m) => ({ id: m.id, name: m.name, description: m.description, energy: m.energy }))),
  );

  app.post("/api/posts/:id/music", async (req, res) => {
    const post = db.getPost(String(req.params.id));
    if (!post) throw new HttpErr(404, "Post not found");
    if (post.type === "carousel") throw new HttpErr(400, "Carousels have no audio");
    if (["posted", "publishing"].includes(post.status)) throw new HttpErr(409, `Post is already ${post.status}`);
    const b = req.body ?? {};
    let volume: number | undefined;
    if (b.volume !== undefined && b.volume !== null) {
      volume = Number(b.volume);
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new HttpErr(400, "volume must be between 0 and 1");
    }
    let ref: MusicRef | undefined | null; // null = remove, undefined = keep (volume-only change)
    if (b.trackId === null || b.trackId === "none") ref = null;
    else if (b.trackId === "auto") {
      ref = await autoMusicFor(post);
      if (!ref) throw new HttpErr(400, "No track available for auto-pick");
    } else if (typeof b.trackId === "string" && b.trackId) {
      const r = await resolveTrack(b.trackId).catch((e) => {
        throw new HttpErr(400, e?.message ?? String(e));
      });
      if (!r) throw new HttpErr(400, `Unknown trackId "${b.trackId}" (see GET /api/music)`);
      ref = { src: r.track.url, trackId: r.track.id, ...(r.track.credit ? { credit: r.track.credit } : {}) };
    } else if (volume === undefined) throw new HttpErr(400, "trackId (string, \"auto\" or null) or volume is required");

    const updated = db.updatePost(post.id, (x) => {
      const spec = x.spec as any;
      if (ref === null) {
        delete spec.music;
        spec.musicOff = true;
      } else {
        if (ref) {
          spec.music = { ...ref };
          delete spec.musicOff;
        }
        if (volume !== undefined && spec.music) spec.music.volume = volume;
      }
    })!;
    if (b.render === true) {
      // Fast path: re-mix the audio of the existing render (seconds). Falls back to a full re-render.
      const { remixPost } = await import("./audio.ts");
      const ok = updated.status !== "rendering" && (await remixPost(updated.id).catch((e) => {
        console.warn("[music] remix failed:", e?.message ?? e);
        return false;
      }));
      if (!ok) {
        const { enqueueRender } = await import("./render.ts");
        return res.json(enqueueRender(updated.id));
      }
      return res.json(db.getPost(updated.id));
    }
    res.json(updated);
  });
}

