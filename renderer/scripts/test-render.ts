// Smoke test: renders a sample Etsy reel + carousel, then a still (and optionally a short clip) per style.
// Usage: npm run test:render            (reel + carousel + one still per style + carousel slide per style)
//        npm run test:render -- --clips (also renders a 2-scene mp4 per style)
//        npm run test:render -- --only=stills
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { CarouselSpec, ReelSpec } from "../../shared/types.ts";
import { listCaptionStyles, listStyles, renderCarousel, renderReel, renderStill } from "../src/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "out");
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7);
const withClips = args.includes("--clips");

const brand: ReelSpec["brand"] = {
  name: "Luna & Thread",
  handle: "@lunaandthread",
  colors: { primary: "#7A3E48", secondary: "#D9A5A0", accent: "#E8B04B", background: "#FBF6F0", text: "#2B1D1F" },
};

const reel: ReelSpec = {
  width: 1080,
  height: 1920,
  fps: 30,
  style: "bold",
  captionStyle: "white-pill",
  brand,
  scenes: [
    { id: "s1", durationSec: 2.5, headline: "Stop scrolling, jewelry lover", voiceoverText: "Stop scrolling if you love jewelry with meaning." },
    { id: "s2", durationSec: 2.5, headline: "Handmade in small batches", subtext: "Recycled sterling silver", voiceoverText: "Every piece is handmade in small batches from recycled silver." },
    { id: "s3", durationSec: 2.5, headline: "Your initials, your stone", subtext: "Personalised in 3 days", voiceoverText: "Add your initials and birthstone, ready in three days." },
    { id: "s4", durationSec: 1.7, headline: "Gift-ready, always", subtext: "Free shipping over $35", voiceoverText: "Gift-wrapped and shipped free." },
  ],
  cta: { text: "Get 15% off your first order", keyword: "GIFT" },
};

const carousel: CarouselSpec = {
  width: 1080,
  height: 1350,
  style: "bold",
  brand,
  slides: [
    { headline: "3 ways to style a name necklace", body: "Swipe for the looks" },
    { headline: "Layer it with a fine chain", body: "Mix 16 and 18 inch lengths" },
    { headline: "Make it yours today", body: "Shop the collection — link in bio" },
  ],
};

const styleScenes: ReelSpec["scenes"] = [
  {
    id: "a",
    durationSec: 2,
    headline: "Handmade jewelry with a story",
    subtext: "Recycled silver, made to order",
    voiceoverText: "Handmade jewelry with a story behind every piece.",
    bullets: ["Recycled sterling silver", "Engraved by hand", "Ships in 3 days"],
  },
  { id: "b", durationSec: 1.5, headline: "Made just for you", subtext: "Free gift wrap", voiceoverText: "Made just for you." },
];

function size(file: string) {
  return `${(fs.statSync(file).size / 1024).toFixed(0)} KB`;
}

async function main() {
  const t0 = Date.now();
  const styles = listStyles();
  console.log(`styles (${styles.length}): ${styles.map((s) => s.id).join(", ")}`);
  console.log(`caption styles (${listCaptionStyles().length}): ${listCaptionStyles().map((s) => s.id).join(", ")}`);
  fs.mkdirSync(OUT, { recursive: true });

  if (!only || only === "reel") {
    const t = Date.now();
    let lastLog = 0;
    const r = await renderReel(reel, path.join(OUT, "etsy-reel"), (p) => {
      if (p - lastLog >= 0.2 || p === 1) {
        lastLog = p;
        console.log(`  reel progress ${(p * 100).toFixed(0)}%`);
      }
    });
    console.log(`reel: ${r.videoPath} (${size(r.videoPath)}), thumb ${r.thumbnailPath} — ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }

  if (!only || only === "carousel") {
    const t = Date.now();
    const c = await renderCarousel(carousel, path.join(OUT, "etsy-carousel"));
    console.log(`carousel: ${c.imagePaths.length} slides — ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }

  if (!only || only === "stills") {
    const captions = listCaptionStyles();
    for (const [i, s] of styles.entries()) {
      const t = Date.now();
      const spec: ReelSpec = { ...reel, style: s.id, captionStyle: captions[i % captions.length].id, scenes: styleScenes };
      const file = await renderStill(spec, 50, path.join(OUT, "styles", `${s.id}.png`));
      // a second still inside the CTA card
      await renderStill(spec, 30 * 3.5 + 40, path.join(OUT, "styles", `${s.id}-cta.png`));
      let extra = "";
      if (s.supports.includes("carousel")) {
        const c = await renderCarousel({ ...carousel, style: s.id }, path.join(OUT, "styles", `${s.id}-carousel`));
        extra = ` + ${c.imagePaths.length} carousel slides`;
      }
      if (withClips) {
        const r = await renderReel(spec, path.join(OUT, "styles", `${s.id}-clip`));
        extra += ` + clip ${size(r.videoPath)}`;
      }
      console.log(`  style ${s.id.padEnd(13)} ok (${captions[i % captions.length].id}) ${size(file)}${extra} — ${((Date.now() - t) / 1000).toFixed(1)}s`);
    }
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
