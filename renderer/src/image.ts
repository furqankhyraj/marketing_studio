// Single-image feed posts: render the "ImagePost" composition as one still (JPEG for Instagram + a small thumb).
// Re-exported from index.ts. Uses index.ts's shared bundle/browser helpers (function declarations, so the
// circular import is safe: they are only called at render time).
import path from "node:path";
import fs from "node:fs/promises";
import { renderStill as remotionRenderStill, selectComposition } from "@remotion/renderer";
import type { ImageDesign, ImageSpec, MediaRef, PinImageSpec } from "../../shared/types.ts";
import { getServeUrl, withBrowser, probe } from "./index.ts";

const TIMEOUT = 90_000;

export const IMAGE_DESIGNS: { id: ImageDesign; name: string; description: string; fields: string[] }[] = [
  { id: "quote", name: "Quote card", description: "Big quote in the brand's heading font with an accent quote mark and author line.", fields: ["headline", "author", "cta"] },
  { id: "tip", name: "Tip card", description: "Eyebrow pill, tip headline and 1–4 numbered steps on a card. Great for saves.", fields: ["eyebrow", "headline", "bullets", "body", "cta"] },
  { id: "product", name: "Product spotlight", description: "Brand photo on top, product name, short line, price and a CTA button.", fields: ["media", "badge", "eyebrow", "headline", "body", "price", "oldPrice", "cta"] },
  { id: "offer", name: "Announcement / offer", description: "Starburst badge (20% OFF / NEW), big headline, price with old price, CTA button. Optional photo background.", fields: ["badge", "eyebrow", "headline", "body", "price", "oldPrice", "cta", "media"] },
  { id: "testimonial", name: "Testimonial / review", description: "Review card with stars, the quote and the customer's name.", fields: ["eyebrow", "headline", "author", "body", "rating", "cta"] },
  { id: "question", name: "Question / poll", description: "Engagement post: a question and 2–3 option tiles (A / B). 'Comment A or B'.", fields: ["eyebrow", "headline", "options", "cta"] },
  { id: "before-after", name: "Before / after", description: "Two panels (before → after) with labels, text or photos.", fields: ["eyebrow", "headline", "options", "cta"] },
  { id: "fact", name: "Did you know?", description: "Bulb + 'Did you know?' pill, a huge fact or stat and a short explanation.", fields: ["eyebrow", "headline", "body", "cta"] },
];

async function checkImage(m: MediaRef | undefined): Promise<MediaRef | undefined> {
  if (!m?.src || m.kind !== "image") return undefined;
  return (await probe(m.src, "image")) ? { src: m.src, kind: "image", ...(m.frame === "phone" ? { frame: "phone" as const } : {}) } : undefined;
}

async function prepareImage(spec: ImageSpec): Promise<ImageSpec> {
  const brand = { ...spec.brand, name: spec.brand?.name || "Brand" };
  const [logoOk, media, options] = await Promise.all([
    brand.logoUrl ? probe(brand.logoUrl, "image") : Promise.resolve(false),
    checkImage(spec.media),
    Promise.all((spec.options ?? []).slice(0, 3).map(async (o) => ({ label: String(o.label ?? ""), text: String(o.text ?? ""), media: await checkImage(o.media) }))),
  ]);
  const num = (v: unknown, d: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 240 && n <= 3840 ? n : d;
  };
  return {
    ...spec,
    kind: "image",
    width: num(spec.width, 1080),
    height: num(spec.height, 1350),
    headline: String(spec.headline ?? ""),
    brand: { ...brand, logoUrl: logoOk ? brand.logoUrl : undefined },
    media,
    options: options.length ? options : undefined,
    bullets: Array.isArray(spec.bullets) ? spec.bullets.map(String).filter(Boolean).slice(0, 4) : undefined,
  };
}

/** Writes outDir/image.jpg (full size, JPEG = Instagram's only image format) and outDir/thumb.jpg (40%). */
export async function renderImagePost(spec: ImageSpec, outDir: string): Promise<{ imagePath: string; thumbnailPath: string }> {
  const out = path.resolve(outDir);
  await fs.mkdir(out, { recursive: true });
  const prepared = await prepareImage(spec);
  const serveUrl = await getServeUrl();
  const inputProps = { spec: prepared };
  const imagePath = path.join(out, "image.jpg");
  const thumbnailPath = path.join(out, "thumb.jpg");
  await withBrowser(async (browser) => {
    const composition = await selectComposition({ serveUrl, id: "ImagePost", inputProps, puppeteerInstance: browser, timeoutInMilliseconds: TIMEOUT });
    for (const [file, scale, q] of [[imagePath, 1, 93], [thumbnailPath, 0.4, 85]] as const) {
      await remotionRenderStill({
        composition,
        serveUrl,
        inputProps,
        frame: 0,
        output: file,
        imageFormat: "jpeg",
        jpegQuality: q,
        scale,
        overwrite: true,
        puppeteerInstance: browser,
        timeoutInMilliseconds: TIMEOUT,
      });
    }
  });
  return { imagePath, thumbnailPath };
}

/** Pinterest pin (2:3): writes outDir/pin.jpg (full size) and outDir/thumb.jpg (35%). */
export async function renderPinImage(spec: PinImageSpec, outDir: string): Promise<{ imagePath: string; thumbnailPath: string }> {
  const out = path.resolve(outDir);
  await fs.mkdir(out, { recursive: true });
  const photos = (await Promise.all((spec.photos ?? []).slice(0, 3).map(checkImage))).filter((m): m is MediaRef => !!m);
  const logoOk = spec.brand?.logoUrl ? await probe(spec.brand.logoUrl, "image") : false;
  const prepared: PinImageSpec = {
    ...spec,
    kind: "pin",
    width: 1000,
    height: 1500,
    brand: { ...spec.brand, name: spec.brand?.name || "Brand", logoUrl: logoOk ? spec.brand.logoUrl : undefined },
    photos,
  };
  const serveUrl = await getServeUrl();
  const inputProps = { spec: prepared };
  const imagePath = path.join(out, "pin.jpg");
  const thumbnailPath = path.join(out, "thumb.jpg");
  await withBrowser(async (browser) => {
    const composition = await selectComposition({ serveUrl, id: "PinImage", inputProps, puppeteerInstance: browser, timeoutInMilliseconds: TIMEOUT });
    for (const [file, scale, q] of [[imagePath, 1, 92], [thumbnailPath, 0.35, 85]] as const) {
      await remotionRenderStill({ composition, serveUrl, inputProps, frame: 0, output: file, imageFormat: "jpeg", jpegQuality: q, scale, overwrite: true, puppeteerInstance: browser, timeoutInMilliseconds: TIMEOUT });
    }
  });
  return { imagePath, thumbnailPath };
}
