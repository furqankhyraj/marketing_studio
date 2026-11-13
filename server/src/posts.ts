import { nanoid } from "nanoid";
import type { Post, PostType, ReelSpec, CarouselSpec, HtmlReelSpec, ImageSpec, Brand } from "../../shared/types.ts";
import { isImageSpec, normalizeImageSpec } from "./imagepost.ts";
import { nowIso } from "./config.ts";
import { savePost , listAssets } from "./db.ts";
import { brandStyleRef } from "./brain.ts";
import { capHashtags, composeCaption } from "./hashtags.ts";

export type AnySpec = ReelSpec | CarouselSpec | HtmlReelSpec | ImageSpec;
export { isImageSpec };

export const isHtmlSpec = (s: any): s is HtmlReelSpec => !!s && s.engine === "hyperframes";
export const isCarouselSpec = (s: any): s is CarouselSpec => !!s && Array.isArray(s.slides) && !isImageSpec(s);
export const isReelSpec = (s: any): s is ReelSpec => !!s && Array.isArray(s.scenes) && !isHtmlSpec(s) && !isImageSpec(s);

/** Validate and fill defaults on an incoming spec for a given post type. Throws with a readable message. */
/** App screenshots (Play Store imports, or any tall portrait image the caller marked) are shown in a phone frame. */
function framePhones(spec: any, brandId: string) {
  const screens = new Set(listAssets(brandId).filter((a) => a.source === "playstore" && !/icon/i.test(a.originalName)).map((a) => a.url));
  if (!screens.size) return;
  const tag = (m: any) => {
    if (m && typeof m.src === "string" && m.kind === "image" && !m.frame && screens.has(m.src)) m.frame = "phone";
  };
  for (const s of spec.scenes ?? []) tag(s.media);
  for (const s of spec.slides ?? []) tag(s.media);
}

export function normalizeSpec(type: PostType, spec: any, brand: Brand): AnySpec {
  if (!spec || typeof spec !== "object") throw new Error("spec is required");
  framePhones(spec, brand.id);
  const brandRef = brandStyleRef(brand);
  if (type === "image") return normalizeImageSpec(spec, brand); // single 4:5 graphic (imagepost.ts)
  if (type === "carousel") {
    if (!Array.isArray(spec.slides) || spec.slides.length < 1) throw new Error("carousel spec needs slides[]");
    if (spec.slides.length > 10) spec.slides = spec.slides.slice(0, 10);
    return {
      width: spec.width || 1080,
      height: spec.height || 1350,
      style: spec.style || "bold-pop",
      brand: { ...brandRef, ...(spec.brand ?? {}), colors: { ...brandRef.colors, ...(spec.brand?.colors ?? {}) } },
      slides: spec.slides.map((s: any) => ({ headline: String(s.headline ?? ""), body: s.body, media: s.media })),
    } satisfies CarouselSpec;
  }
  if (spec.engine === "clip") return spec as AnySpec; // clip from a long video (server/src/clips.ts); edited via /clip-adjust
  if (isHtmlSpec(spec)) {
    if (typeof spec.html !== "string" || !spec.html.trim()) throw new Error("hyperframes spec needs html");
    return {
      ...spec,
      engine: "hyperframes",
      width: spec.width || 1080,
      height: spec.height || 1920,
      fps: spec.fps || 30,
      durationSec: Number(spec.durationSec) || 15,
      brand: spec.brand ?? brandRef,
    } satisfies HtmlReelSpec;
  }
  if (!Array.isArray(spec.scenes) || spec.scenes.length < 1) throw new Error("reel/story spec needs scenes[] (or engine:'hyperframes' + html)");
  return {
    ...spec,
    width: spec.width || 1080,
    height: spec.height || 1920,
    fps: spec.fps || 30,
    style: spec.style || "cinematic",
    brand: { ...brandRef, ...(spec.brand ?? {}), colors: { ...brandRef.colors, ...(spec.brand?.colors ?? {}) } },
    scenes: spec.scenes.map((s: any, i: number) => ({
      ...s,
      id: String(s.id ?? `s${i + 1}`),
      durationSec: Math.max(1, Math.min(15, Number(s.durationSec) || 3)),
      headline: String(s.headline ?? ""),
    })),
  } satisfies ReelSpec;
}

export function hookOf(spec: AnySpec): string {
  if (isCarouselSpec(spec)) return spec.slides[0]?.headline ?? "";
  if (isReelSpec(spec)) return spec.scenes[0]?.headline ?? "";
  if (isImageSpec(spec)) return spec.headline ?? "";
  return "";
}

export function newPost(input: {
  brandId: string;
  type: PostType;
  title?: string;
  hook?: string;
  caption?: string;
  hashtags?: string[];
  spec: AnySpec;
  scheduledAt?: string;
}): Post {
  const now = nowIso();
  const p: Post = {
    id: nanoid(12),
    brandId: input.brandId,
    type: input.type,
    status: "draft",
    title: input.title?.trim() || hookOf(input.spec) || `New ${input.type}`,
    hook: input.hook?.trim() || hookOf(input.spec),
    caption: input.caption ?? "",
    hashtags: capHashtags(input.hashtags ?? []),
    spec: input.spec,
    scheduledAt: input.scheduledAt,
    mediaUrls: [],
    revision: 1,
    changeRequests: [],
    createdAt: now,
    updatedAt: now,
  };
  return savePost(p);
}

/** Caption as published: max 5 hashtags in total (inline + list), max 2200 chars. */
export function fullCaption(p: Post): string {
  const credit = (p.spec as { music?: { credit?: string } })?.music?.credit?.trim();
  const caption = credit && !(p.caption ?? "").includes(credit) ? `${(p.caption ?? "").trimEnd()}\n\nMusic: ${credit}` : p.caption ?? "";
  return composeCaption(caption, p.hashtags ?? []);
}
