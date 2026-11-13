// Clip reels cut from long videos (server/src/clips.ts): render the "ClipReel" composition to MP4 + a thumbnail.
// Re-exported from index.ts. Uses index.ts's shared bundle/browser helpers (function declarations, so the circular
// import is safe: they are only called at render time).
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { renderMedia, renderStill as remotionRenderStill, selectComposition } from "@remotion/renderer";
import type { ClipReelSpec } from "../../shared/types.ts";
import { getServeUrl, withBrowser, probe } from "./index.ts";

const TIMEOUT = 120_000;
const CONCURRENCY = Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));

export async function renderClipReel(
  spec: ClipReelSpec & { videoSrc: string },
  outDir: string,
  onProgress?: (p: number) => void,
): Promise<{ videoPath: string; thumbnailPath: string }> {
  const out = path.resolve(outDir);
  await fs.mkdir(out, { recursive: true });
  const logoOk = spec.brand?.logoUrl ? await probe(spec.brand.logoUrl, "image") : false;
  const prepared = {
    ...spec,
    brand: { ...spec.brand, name: spec.brand?.name || "Brand", logoUrl: logoOk ? spec.brand.logoUrl : undefined },
    captions: Array.isArray(spec.captions) ? spec.captions : undefined,
  };
  const serveUrl = await getServeUrl();
  const inputProps = { spec: prepared };
  const videoPath = path.join(out, "reel.mp4");
  const thumbnailPath = path.join(out, "thumb.jpg");
  await withBrowser(async (browser) => {
    const composition = await selectComposition({ serveUrl, id: "ClipReel", inputProps, puppeteerInstance: browser, timeoutInMilliseconds: TIMEOUT });
    let last = -1;
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      enforceAudioTrack: true,
      outputLocation: videoPath,
      overwrite: true,
      concurrency: CONCURRENCY,
      puppeteerInstance: browser,
      timeoutInMilliseconds: TIMEOUT,
      onProgress: ({ progress }) => {
        const p = Math.round(progress * 0.97 * 100) / 100;
        if (p !== last) {
          last = p;
          onProgress?.(p);
        }
      },
    });
    const frame = Math.min(composition.durationInFrames - 1, Math.round(composition.fps * 1.5));
    await remotionRenderStill({
      composition,
      serveUrl,
      inputProps,
      frame,
      output: thumbnailPath,
      imageFormat: "jpeg",
      jpegQuality: 86,
      overwrite: true,
      puppeteerInstance: browser,
      timeoutInMilliseconds: TIMEOUT,
    });
  });
  onProgress?.(1);
  return { videoPath, thumbnailPath };
}
