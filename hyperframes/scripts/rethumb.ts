// Re-extract thumb.jpg for existing test renders at each composition's data-thumb-at (cheap; no re-render).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FFMPEG_PATH, buildFromTemplate, listHtmlTemplates } from "../src/index.ts";
import { SAMPLES } from "./samples.ts";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out");
for (const [key, sample] of Object.entries(SAMPLES)) {
  for (const t of listHtmlTemplates()) {
    const dir = join(OUT, key, t.id);
    if (!existsSync(join(dir, "reel.mp4"))) continue;
    const spec = buildFromTemplate(t.id, { brand: sample.brand, scenes: sample.scenes[t.id], cta: sample.cta });
    const at = Number(spec.html.match(/data-thumb-at="([\d.]+)"/)?.[1] ?? 1.5);
    execFileSync(FFMPEG_PATH!, ["-y", "-loglevel", "error", "-ss", at.toFixed(2), "-i", join(dir, "reel.mp4"), "-frames:v", "1", "-q:v", "3", join(dir, "thumb.jpg")]);
    console.log(`${key}/${t.id} thumb @ ${at}s`);
  }
}
