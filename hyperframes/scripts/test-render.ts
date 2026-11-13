// Renders every HyperFrames template for two sample brands into hyperframes/out/<brand>/<template>/.
// Usage:  npx tsx scripts/test-render.ts [templateIdFilter] [brandFilter]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FFPROBE_PATH, buildFromTemplate, listHtmlTemplates, renderHtmlReel, validateHtml } from "../src/index.ts";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out");
import { SAMPLES } from "./samples.ts";
function probe(file: string): { duration: number; width: number; height: number; codec: string } {
  const out = execFileSync(FFPROBE_PATH!, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  const j = JSON.parse(out);
  return { duration: Number(j.format?.duration), width: j.streams?.[0]?.width, height: j.streams?.[0]?.height, codec: j.streams?.[0]?.codec_name };
}

const [tplFilter, brandFilter] = process.argv.slice(2);
const results: string[] = [];
let failures = 0;
for (const [key, sample] of Object.entries(SAMPLES)) {
  if (brandFilter && key !== brandFilter) continue;
  for (const t of listHtmlTemplates()) {
    if (tplFilter && tplFilter !== "all" && t.id !== tplFilter) continue;
    const spec = buildFromTemplate(t.id, { brand: sample.brand, scenes: sample.scenes[t.id], cta: sample.cta });
    const v = validateHtml(spec.html);
    const dir = join(OUT, key, t.id);
    if (process.env.SKIP_EXISTING && existsSync(join(dir, "thumb.jpg")) && existsSync(join(dir, "reel.mp4"))) {
      const pr = probe(join(dir, "reel.mp4"));
      results.push(`SKIP ${key}/${t.id}: existing ${pr.width}x${pr.height} ${pr.codec} ${pr.duration.toFixed(2)}s ${(statSync(join(dir, "reel.mp4")).size / 1e6).toFixed(2)}MB`);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), spec.html);
    if (!v.ok) {
      failures++;
      results.push(`FAIL validate ${key}/${t.id}: ${v.errors.join("; ")}`);
      continue;
    }
    const t0 = Date.now();
    let last = -1;
    try {
      const r = await renderHtmlReel(spec, dir, (p) => {
        const pct = Math.floor(p * 10);
        if (pct !== last) {
          last = pct;
          process.stdout.write(`\r${key}/${t.id} ${Math.round(p * 100)}%   `);
        }
      });
      const secs = (Date.now() - t0) / 1000;
      const size = statSync(r.videoPath).size;
      const pr = probe(r.videoPath);
      const sane = pr.width === 1080 && pr.height === 1920 && pr.codec === "h264" && Math.abs(pr.duration - spec.durationSec) < 0.5 && size > 100_000 && existsSync(r.thumbnailPath);
      if (!sane) failures++;
      results.push(`${sane ? "OK  " : "BAD "} ${key}/${t.id}: ${pr.width}x${pr.height} ${pr.codec} ${pr.duration.toFixed(2)}s (spec ${spec.durationSec}s) ${(size / 1e6).toFixed(2)}MB, rendered in ${secs.toFixed(1)}s`);
    } catch (e) {
      failures++;
      results.push(`FAIL render ${key}/${t.id}: ${(e as Error).message}`);
    }
    process.stdout.write("\n" + results[results.length - 1] + "\n");
  }
}
console.log("\n==== summary ====\n" + results.join("\n"));
process.exit(failures ? 1 : 0);
