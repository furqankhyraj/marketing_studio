/**
 * End-to-end check: Kokoro TTS for two brands, whisper.cpp word timings, first-run downloads.
 * Run: npm test   (env DATA_DIR overrides ../data; VOICE_DISABLE_WHISPER=1 tests the fallback)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listVoices, synthesizeScenes, transcribeWords, ensureWhisper, warmup, searchStock,
  lastTranscribeMethod, lastTranscribeError,
} from "../src/index.ts";
import { dataDir, modelsDir, whisperDir } from "../src/config.ts";
import { readWav } from "../src/wav.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const outRoot = path.join(here, "..", "test-output");

function dirSize(p: string): number {
  if (!fs.existsSync(p)) return 0;
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, f) => n + dirSize(path.join(p, f)), 0);
}
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const jobs = [
  {
    name: "saqqa-academy",
    voice: "af_heart",
    scenes: [
      { id: "s1", text: "Want to learn Arabic the right way? Welcome to Saqqa Academy." },
      { id: "s2", text: "Live classes with qualified teachers, flexible schedules, and lessons for every level." },
      { id: "s3", text: "Book your free trial lesson today. Comment LEARN and we will send you the link." },
    ],
  },
  {
    name: "etsy-shop",
    voice: "bm_george",
    scenes: [
      { id: "s1", text: "Handmade gifts that actually feel personal." },
      { id: "s2", text: "Every piece is designed, printed, and packed by hand in our small studio." },
      { id: "s3", text: "Tap the link in our bio to shop the new collection on Etsy." },
    ],
  },
];

async function main() {
  console.log(`data dir: ${dataDir()}`);
  console.log(`voices (${listVoices().length}): ${listVoices().map((v) => v.id).join(", ")}`);

  const modelsBefore = dirSize(modelsDir());
  let t = Date.now();
  await warmup();
  const loadMs = Date.now() - t;
  const modelsAfter = dirSize(modelsDir());
  console.log(`\n[kokoro] model load ${sec(loadMs)}; cache ${mb(modelsAfter)} (downloaded this run: ${mb(modelsAfter - modelsBefore)})`);

  const whBefore = dirSize(whisperDir());
  t = Date.now();
  let whisperOk = true;
  if (process.env.VOICE_DISABLE_WHISPER !== "1") {
    try {
      await ensureWhisper();
    } catch (e: any) {
      whisperOk = false;
      console.log(`[whisper] install FAILED: ${e.message}`);
    }
  }
  console.log(`[whisper] ready=${whisperOk} in ${sec(Date.now() - t)}; dir ${mb(dirSize(whisperDir()))} (downloaded this run: ${mb(dirSize(whisperDir()) - whBefore)})`);

  for (const job of jobs) {
    const outDir = path.join(outRoot, job.name);
    t = Date.now();
    const r = await synthesizeScenes(job.scenes, { voice: job.voice, outDir });
    const synthMs = Date.now() - t;
    const wav = readWav(r.path);
    const realDur = (wav.samples.length / wav.sampleRate) * 1000;
    const peak = wav.samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    console.log(`\n=== ${job.name} (${job.voice}) ===`);
    console.log(`wav ${r.path}`);
    console.log(`  ${wav.sampleRate} Hz, ${sec(realDur)} (reported ${r.durationMs} ms), ${mb(fs.statSync(r.path).size)}, peak ${peak.toFixed(2)}`);
    console.log(`  synth ${sec(synthMs)} -> ${(realDur / synthMs).toFixed(2)}x realtime`);
    for (const s of r.scenes) console.log(`  scene ${s.id}: ${s.startMs} -> ${s.endMs} ms`);
    if (wav.sampleRate !== 24000 || Math.abs(realDur - r.durationMs) > 5 || peak < 0.05) {
      throw new Error("WAV sanity check failed");
    }

    t = Date.now();
    const words = await transcribeWords(r.path);
    const trMs = Date.now() - t;
    console.log(`  words (${lastTranscribeMethod}${lastTranscribeError ? `; error: ${lastTranscribeError}` : ""}) ${words.length} in ${sec(trMs)}:`);
    console.log("  " + words.map((w) => `${w.text}[${w.startMs}-${w.endMs}]`).join(" "));
    const expected = job.scenes.map((s) => s.text).join(" ").split(/\s+/).length;
    const monotonic = words.every((w, i) => w.endMs >= w.startMs && (i === 0 || w.startMs >= words[i - 1].startMs));
    const inRange = words.every((w) => w.endMs <= r.durationMs + 500);
    console.log(`  check: expected ~${expected} words, got ${words.length}; monotonic=${monotonic}; inRange=${inRange}`);
  }

  const stock = await searchStock("arabic calligraphy", { kind: "video", orientation: "portrait", perPage: 3 });
  console.log(`\n[stock] ${stock.length} results (${process.env.PEXELS_API_KEY || process.env.PIXABAY_API_KEY ? "key set" : "no key -> [] expected"})`);
  for (const s of stock) console.log(`  ${s.source} ${s.kind} ${s.width}x${s.height} ${s.credit}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
