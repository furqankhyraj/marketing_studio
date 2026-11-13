// Fast visual check (no MP4 encode): builds each template project and grabs key frames with `hyperframes snapshot`.
// Usage: npx tsx scripts/preview.ts [templateIdFilter|all] [brandFilter]
// Output: out/preview/<brand>-<template>/ (project) and .../shots/ (PNGs + contact sheet)
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFromTemplate, configureEnvironment, listHtmlTemplates, prepareProject } from "../src/index.ts";
import { SAMPLES } from "./samples.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("hyperframes/package.json")), "bin", "hyperframes.mjs");
configureEnvironment();

const [tplFilter, brandFilter] = process.argv.slice(2);
for (const [key, sample] of Object.entries(SAMPLES)) {
  if (brandFilter && key !== brandFilter) continue;
  for (const t of listHtmlTemplates()) {
    if (tplFilter && tplFilter !== "all" && t.id !== tplFilter) continue;
    const spec = buildFromTemplate(t.id, { brand: sample.brand, scenes: sample.scenes[t.id], cta: sample.cta });
    const dir = join(ROOT, "out", "preview", `${key}-${t.id}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    await prepareProject(spec, dir);
    // middle-ish of each scene + CTA
    const times: number[] = [];
    let acc = 0;
    for (const s of sample.scenes[t.id]) {
      times.push(+(acc + Math.min(s.durationSec * 0.7, s.durationSec - 0.45)).toFixed(2));
      acc += s.durationSec;
    }
    times.push(+(spec.durationSec - 0.8).toFixed(2));
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [cli, "snapshot", dir, "--at", times.join(","), "--no-end", "-o", join(dir, "shots")], { encoding: "utf8", env: process.env });
    console.log(`${key}/${t.id} snapshot exit=${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s at ${times.join(",")}`);
    if (r.status !== 0) console.log((r.stdout || "") + (r.stderr || ""));
  }
}
