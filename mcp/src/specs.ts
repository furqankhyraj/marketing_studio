// Builders that turn simple tool input into full render specs (shared/types.ts).
import type {
  Asset,
  Brand,
  BrandColors,
  BrandStyleRef,
  CarouselSlide,
  CarouselSpec,
  HtmlReelSpec,
  MediaRef,
  ReelSpec,
  Scene,
  StyleMeta,
  CaptionStyleMeta,
} from "../../shared/types.ts";
import { get } from "./api.ts";

export const DEFAULT_COLORS: BrandColors = {
  primary: "#1E3A8A",
  secondary: "#0F172A",
  accent: "#F59E0B",
  background: "#0B1020",
  text: "#FFFFFF",
};

export async function fetchBrand(brandId: string): Promise<Brand> {
  return get<Brand>(`/brands/${encodeURIComponent(brandId)}`);
}

export function brandStyleRef(b: Brand): BrandStyleRef {
  const handle = b.instagramHandle ? "@" + b.instagramHandle.replace(/^@/, "").trim() : undefined;
  return {
    name: b.name,
    handle,
    colors: { ...DEFAULT_COLORS, ...(b.brain?.colors ?? {}) },
    logoUrl: b.brain?.logoUrl,
    fonts: b.brain?.fonts,
  };
}

const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|#|$)/i;

export function kindFromUrl(url: string): "image" | "video" {
  return VIDEO_EXT.test(url) ? "video" : "image";
}

export interface MediaInput {
  mediaAssetId?: string;
  mediaUrl?: string;
}

/** Lazily loads the brand's assets once and resolves mediaAssetId / mediaUrl to a MediaRef. */
export function mediaResolver(brandId: string) {
  let assets: Asset[] | undefined;
  return async (m: MediaInput): Promise<MediaRef | undefined> => {
    if (m.mediaAssetId) {
      if (!assets) assets = await get<Asset[]>(`/brands/${encodeURIComponent(brandId)}/assets`);
      const a = assets.find((x) => x.id === m.mediaAssetId);
      if (!a) throw new Error(`Asset ${m.mediaAssetId} not found for brand ${brandId}. Use list_assets to see asset ids.`);
      if (a.kind === "audio") throw new Error(`Asset ${a.id} is audio and cannot be used as scene media.`);
      return { src: a.url, kind: a.kind };
    }
    if (m.mediaUrl) return { src: m.mediaUrl, kind: kindFromUrl(m.mediaUrl) };
    return undefined;
  };
}

export interface SceneInput extends MediaInput {
  headline: string;
  subtext?: string;
  bullets?: string[];
  voiceoverText?: string;
  captionText?: string;
  durationSec: number;
}

export async function buildScenes(brandId: string, input: SceneInput[]): Promise<Scene[]> {
  const resolve = mediaResolver(brandId);
  const out: Scene[] = [];
  for (let i = 0; i < input.length; i++) {
    const s = input[i];
    const scene: Scene = {
      id: `s${i + 1}`,
      durationSec: s.durationSec,
      headline: s.headline,
    };
    if (s.subtext) scene.subtext = s.subtext;
    if (s.bullets?.length) scene.bullets = s.bullets;
    if (s.voiceoverText) scene.voiceoverText = s.voiceoverText;
    if (s.captionText) scene.captionText = s.captionText;
    const media = await resolve(s);
    if (media) scene.media = media;
    out.push(scene);
  }
  return out;
}

export function buildReelSpec(args: {
  brand: Brand;
  style: string;
  captionStyle?: string;
  scenes: Scene[];
  cta?: { text: string; keyword?: string };
  musicUrl?: string;
}): ReelSpec {
  const spec: ReelSpec = {
    width: 1080,
    height: 1920,
    fps: 30,
    style: args.style,
    brand: brandStyleRef(args.brand),
    scenes: args.scenes,
  };
  if (args.captionStyle) spec.captionStyle = args.captionStyle;
  if (args.cta) spec.cta = args.cta;
  if (args.musicUrl) spec.music = { src: args.musicUrl, volume: 0.25 };
  return spec;
}

export interface SlideInput extends MediaInput {
  headline: string;
  body?: string;
}

export async function buildCarouselSpec(args: { brand: Brand; style: string; slides: SlideInput[] }): Promise<CarouselSpec> {
  const resolve = mediaResolver(args.brand.id);
  const slides: CarouselSlide[] = [];
  for (const s of args.slides) {
    const slide: CarouselSlide = { headline: s.headline };
    if (s.body) slide.body = s.body;
    const media = await resolve(s);
    if (media) slide.media = media;
    slides.push(slide);
  }
  return { width: 1080, height: 1350, style: args.style, brand: brandStyleRef(args.brand), slides };
}

export function buildHtmlReelSpec(args: {
  brand: Brand;
  html: string;
  durationSec: number;
  assets?: { name: string; src: string }[];
}): HtmlReelSpec {
  return {
    engine: "hyperframes",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: args.durationSec,
    html: args.html,
    assets: args.assets ?? [],
    brand: brandStyleRef(args.brand),
  };
}

export interface StylesResponse {
  styles: StyleMeta[];
  captionStyles: CaptionStyleMeta[];
  htmlTemplates?: { id: string; name: string; description: string; tags: string[] }[];
}

/** Returns an error message if the style / caption style id is unknown (or a format mismatch), else undefined. */
export async function validateStyle(
  style: string,
  format: "reel" | "carousel" | "story",
  captionStyle?: string,
): Promise<string | undefined> {
  const s = await get<StylesResponse>("/styles");
  const meta = s.styles?.find((x) => x.id === style);
  if (s.styles?.length && !meta) {
    const valid = s.styles.filter((x) => x.supports?.includes(format)).map((x) => x.id);
    return `Unknown style "${style}". Valid ${format} styles: ${valid.join(", ")}. (Use list_styles for descriptions.)`;
  }
  if (meta && meta.supports?.length && !meta.supports.includes(format)) {
    const valid = s.styles.filter((x) => x.supports?.includes(format)).map((x) => x.id);
    return `Style "${style}" does not support ${format}. Use one of: ${valid.join(", ")}.`;
  }
  if (captionStyle && s.captionStyles?.length && !s.captionStyles.some((c) => c.id === captionStyle)) {
    return `Unknown captionStyle "${captionStyle}". Valid: ${s.captionStyles.map((c) => c.id).join(", ")}.`;
  }
  return undefined;
}

/** Hashtags without '#', deduped, capped at 5 (Instagram's per-post limit since Dec 2025). */
export const MAX_HASHTAGS = 5;
export const cleanTags = (tags?: string[]) =>
  [...new Set((tags ?? []).map((t) => t.trim().replace(/^#+/, "").replace(/\s+/g, "").toLowerCase()).filter(Boolean))].slice(0, MAX_HASHTAGS);
