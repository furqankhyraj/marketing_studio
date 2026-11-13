// Pure builders for the optional "growth" parameters sent when creating Instagram media containers
// (POST graph.instagram.com/{version}/{ig-user-id}/media). No DB / network access → unit-testable.
//
// Sources (checked 2026-11-11):
//  - IG User Media reference: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
//      alt_text (images / carousel images only, ≤1000 chars), cover_url (Reels, public JPEG URL; wins over thumb_offset),
//      thumb_offset (ms), collaborators (≤3 usernames; feed image, Reels, carousels; not stories),
//      audio_name (Reels, rename once), trial_params {graduation_strategy: MANUAL|SS_PERFORMANCE} (media_type=REELS).
//  - Content publishing guide (shows trial_params on graph.instagram.com, alt_text for image posts):
//      https://developers.facebook.com/docs/instagram-platform/content-publishing
//  - Changelog (Trial Reels for Instagram API with Instagram Login, Dec 3 2025; alt_text Mar 24 2025):
//      https://developers.facebook.com/docs/instagram-platform/changelog
// The reference page shows graph.facebook.com examples and does not explicitly list Instagram-Login support for
// collaborators / audio_name / cover_url / thumb_offset. Each optional param can be switched off with the env var
// IG_DISABLE_PARAMS (comma list, e.g. "audio_name,collaborators"), and publishing retries once without the
// optional params if Instagram rejects them (see instagram.ts).
import type { Post } from "../../shared/types.ts";

export type OptionalIgParam = "alt_text" | "cover_url" | "thumb_offset" | "trial_params" | "collaborators" | "audio_name";
export const OPTIONAL_IG_PARAMS: OptionalIgParam[] = ["alt_text", "cover_url", "thumb_offset", "trial_params", "collaborators", "audio_name"];

export interface IgParamOptions {
  publicBaseUrl?: string;              // tunnel URL; needed for cover_url
  brandName?: string;                  // default audio_name
  disabled?: Iterable<OptionalIgParam | string>;
}

export const MAX_COLLABORATORS = 3;
export const MAX_ALT_TEXT = 1000;
export const DEFAULT_THUMB_OFFSET_MS = 1000;

export function disabledFromEnv(env: string | undefined = process.env.IG_DISABLE_PARAMS): Set<string> {
  return new Set(
    String(env ?? "")
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** "@Some.User " → "some.user"; drops invalid names; max 3, deduped. */
export function cleanCollaborators(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    const u = String(raw ?? "").trim().replace(/^@+/, "").toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(u) || out.includes(u)) continue;
    out.push(u);
    if (out.length >= MAX_COLLABORATORS) break;
  }
  return out;
}

export function cleanAudioName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  return name.replace(/\s+/g, " ").trim().slice(0, 100);
}

/** Map one of our /files URLs onto the public tunnel base. */
function toPublic(url: string, publicBaseUrl: string): string {
  const m = url.match(/\/files\/(.+)$/);
  return m ? `${publicBaseUrl.replace(/\/$/, "")}/files/${m[1]}` : url;
}

const off = (o: IgParamOptions, p: OptionalIgParam) => {
  const d = o.disabled ? new Set([...o.disabled].map(String)) : undefined;
  return !!d?.has(p);
};

/** Extra params for a REELS container (not stories). */
export function reelContainerExtras(post: Pick<Post, "type" | "trial" | "collaborators" | "audioName" | "coverUrl" | "coverThumbOffsetMs">, o: IgParamOptions = {}): Record<string, unknown> {
  if (post.type !== "reel") return {};
  const x: Record<string, unknown> = {};
  if (post.coverUrl && o.publicBaseUrl && !off(o, "cover_url")) x.cover_url = toPublic(post.coverUrl, o.publicBaseUrl);
  else if (!off(o, "thumb_offset")) x.thumb_offset = Math.max(0, Math.round(post.coverThumbOffsetMs ?? DEFAULT_THUMB_OFFSET_MS));
  const collab = cleanCollaborators(post.collaborators);
  if (collab.length && !off(o, "collaborators")) x.collaborators = collab;
  const audio = post.audioName === undefined ? cleanAudioName(o.brandName ? `${o.brandName} original audio` : undefined) : cleanAudioName(post.audioName);
  if (audio && !off(o, "audio_name")) x.audio_name = audio;
  if (post.trial?.enabled && !off(o, "trial_params")) {
    x.trial_params = { graduation_strategy: post.trial.graduation === "SS_PERFORMANCE" ? "SS_PERFORMANCE" : "MANUAL" };
  }
  return x;
}

/** Whether share_to_feed should be sent (omitted for trial reels: they are meant for non-followers first). */
export function shareToFeed(post: Pick<Post, "type" | "trial">, o: IgParamOptions = {}): boolean {
  return post.type === "reel" && !(post.trial?.enabled && !off(o, "trial_params"));
}

function altFor(post: Pick<Post, "altText">, index: number, o: IgParamOptions): Record<string, unknown> {
  const a = post.altText?.[index]?.trim();
  return a && !off(o, "alt_text") ? { alt_text: a.slice(0, MAX_ALT_TEXT) } : {};
}

/** Single image post container extras (alt_text + collaborators). */
export function singleImageExtras(post: Pick<Post, "altText" | "collaborators">, o: IgParamOptions = {}): Record<string, unknown> {
  const collab = cleanCollaborators(post.collaborators);
  return { ...altFor(post, 0, o), ...(collab.length && !off(o, "collaborators") ? { collaborators: collab } : {}) };
}

/** Carousel item (child) container extras: alt_text only (collaborators go on the parent). */
export function carouselItemExtras(post: Pick<Post, "altText">, index: number, o: IgParamOptions = {}): Record<string, unknown> {
  return altFor(post, index, o);
}

/** CAROUSEL parent container extras. */
export function carouselParentExtras(post: Pick<Post, "collaborators">, o: IgParamOptions = {}): Record<string, unknown> {
  const collab = cleanCollaborators(post.collaborators);
  return collab.length && !off(o, "collaborators") ? { collaborators: collab } : {};
}

/** Remove all optional growth params from a container body (used for the retry-without-extras fallback). */
export function stripOptional(body: Record<string, unknown>): { body: Record<string, unknown>; removed: string[] } {
  const out = { ...body };
  const removed: string[] = [];
  for (const k of OPTIONAL_IG_PARAMS) {
    if (k in out) {
      delete out[k];
      removed.push(k);
    }
  }
  return { body: out, removed };
}

/** Heuristic: does an Instagram error look like it was caused by an unsupported/invalid parameter? */
export function looksLikeParamError(msg: string): boolean {
  return /param|invalid|unsupported|not supported|unknown field|cannot be|collaborat|audio|trial|cover|alt_text|thumb/i.test(msg);
}

/**
 * Full container body for a single-image FEED post (Post.type "image"): POST /{ig-user-id}/media with
 * image_url (public JPEG URL — Instagram cURLs it, JPEG is the only supported format), caption, alt_text, collaborators.
 * No media_type for single images (content-publishing guide, checked 2026-11-11).
 */
export function imageContainerBody(
  post: Pick<Post, "altText" | "collaborators">,
  imageUrl: string,
  caption: string,
  o: IgParamOptions = {},
): Record<string, unknown> {
  return { image_url: imageUrl, caption, ...singleImageExtras(post, o) };
}
