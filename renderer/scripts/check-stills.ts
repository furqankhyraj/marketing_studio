// Quick visual check: one reel still (+ first carousel slide) per given style.
// Usage: npx tsx scripts/check-stills.ts bold velocity   (no args = every style)
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReelSpec } from "../../shared/types.ts";
import { listStyles, renderCarousel, renderStill } from "../src/index.ts";

const OUT = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "out", "check");
const ids = process.argv.slice(2).length ? process.argv.slice(2) : listStyles().map((s) => s.id);
const brand: ReelSpec["brand"] = {
  name: "Luna & Thread",
  handle: "@lunaandthread",
  colors: { primary: "#7A3E48", secondary: "#D9A5A0", accent: "#E8B04B", background: "#FBF6F0", text: "#2B1D1F" },
};

for (const id of ids) {
  const t = Date.now();
  const spec: ReelSpec = {
    width: 1080,
    height: 1920,
    fps: 30,
    style: id,
    captionStyle: "white-pill",
    brand,
    scenes: [{ id: "a", durationSec: 2.5, headline: "Stop scrolling, jewelry lover", subtext: "Recycled silver", voiceoverText: "Stop scrolling if you love jewelry." }],
    cta: { text: "Get 15% off", keyword: "GIFT" },
  };
  await renderStill(spec, 50, path.join(OUT, `${id}.png`));
  await renderCarousel(
    { width: 1080, height: 1350, style: id, brand, slides: [{ headline: "Layer it with a fine chain", body: "Mix 16 and 18 inch" }, { headline: "Make it yours" }] },
    path.join(OUT, `${id}-carousel`),
  );
  console.log(`${id} ok ${((Date.now() - t) / 1000).toFixed(1)}s`);
}
