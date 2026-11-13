// Instagram API with Instagram Login (graph.instagram.com). Tokens are stored in the DB and never
// logged or returned; error messages are built from API error bodies only (never URLs with tokens).
import fs from "node:fs";
import type { Post } from "../../shared/types.ts";
import { IG_API_VERSION, IG_REDIRECT_URI, localPathForUrl, publicUrlFor, nowIso } from "./config.ts";
import { getIgCreds, setIgCreds, getSettings, secrets, updateBrand, getBrand, updatePost, getPost, listBrands } from "./db.ts";
import { fullCaption } from "./posts.ts";
import {
  reelContainerExtras, shareToFeed, singleImageExtras, carouselItemExtras, carouselParentExtras,
  stripOptional, looksLikeParamError, disabledFromEnv, imageContainerBody, type IgParamOptions,
} from "./igparams.ts";
import { heuristicAltText } from "./alttext.ts";

const GRAPH = `https://graph.instagram.com/${IG_API_VERSION}`;
export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
];

class IgError extends Error {}

async function igFetch(url: string, init: RequestInit = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e: any) {
    throw new IgError(`Instagram request failed: ${e?.cause?.code ?? e?.message ?? "network error"}`);
  }
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (!res.ok || json?.error) {
    const e = json?.error;
    const msg = e?.error_user_msg || e?.message || json?.error_message || json?.raw || `HTTP ${res.status}`;
    throw new IgError(`Instagram API error: ${msg}${e?.code ? ` (code ${e.code})` : ""}`);
  }
  return json;
}

function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.set(k, String(v));
  return u.toString();
}

function creds(brandId: string) {
  const c = getIgCreds(brandId);
  const b = getBrand(brandId);
  if (!c || !b?.igUserId) throw new IgError("Instagram is not connected for this brand");
  return { token: c.token, igUserId: b.igUserId, username: c.username };
}

const get = (path: string, token: string, params: Record<string, string | number | undefined> = {}) =>
  igFetch(`${GRAPH}/${path}?${qs({ ...params, access_token: token })}`);
const post = (path: string, token: string, params: Record<string, any> = {}) =>
  igFetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...params, access_token: token }),
  });

// ---------- auth ----------
export function authUrl(brandId: string): string {
  const s = getSettings();
  if (!s.igAppId) throw new IgError("Set igAppId and igAppSecret in Settings first (Meta app → Instagram → API setup with Instagram login)");
  return (
    "https://www.instagram.com/oauth/authorize?" +
    qs({
      enable_fb_login: 0,
      force_authentication: 1,
      client_id: s.igAppId,
      redirect_uri: IG_REDIRECT_URI,
      response_type: "code",
      scope: IG_SCOPES.join(","),
      state: brandId,
    })
  );
}

export async function exchangeCode(brandId: string, code: string) {
  const s = getSettings();
  const secret = secrets.igAppSecret();
  if (!s.igAppId || !secret) throw new IgError("igAppId / igAppSecret missing in Settings");
  const clean = code.replace(/#_$/, "");
  const short = await igFetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: qs({ client_id: s.igAppId, client_secret: secret, grant_type: "authorization_code", redirect_uri: IG_REDIRECT_URI, code: clean }),
  });
  const shortToken: string = short.access_token ?? short.data?.[0]?.access_token;
  if (!shortToken) throw new IgError("No access token returned by Instagram");
  const long = await igFetch(
    `https://graph.instagram.com/access_token?${qs({ grant_type: "ig_exchange_token", client_secret: secret, access_token: shortToken })}`,
  );
  await connectWithToken(brandId, long.access_token, undefined, long.expires_in);
}

/** Store a (long-lived) token, resolving the IG professional account id + username. */
export async function connectWithToken(brandId: string, token: string, igUserId?: string, expiresIn?: number) {
  if (!token || token.length < 20) throw new IgError("accessToken looks invalid");
  const me = await get("me", token, { fields: "user_id,username" });
  const userId = igUserId || me.user_id || me.id;
  if (!userId) throw new IgError("Could not resolve Instagram user id from token");
  const expires = new Date(Date.now() + (Number(expiresIn) || 60 * 86400) * 1000).toISOString();
  setIgCreds(brandId, { token, expires, username: me.username });
  return updateBrand(brandId, (b) => {
    b.igConnected = true;
    b.igUserId = String(userId);
    if (!b.instagramHandle && me.username) b.instagramHandle = me.username;
  });
}

export function disconnect(brandId: string) {
  setIgCreds(brandId, null);
  return updateBrand(brandId, (b) => {
    b.igConnected = false;
    b.igUserId = undefined;
  });
}

/** Refresh long-lived tokens that expire within 10 days (tokens must be >24h old). */
export async function refreshTokens() {
  for (const b of listBrands()) {
    const c = getIgCreds(b.id);
    if (!c?.expires) continue;
    const left = Date.parse(c.expires) - Date.now();
    if (left > 10 * 86400000) continue;
    try {
      const r = await igFetch(`https://graph.instagram.com/refresh_access_token?${qs({ grant_type: "ig_refresh_token", access_token: c.token })}`);
      setIgCreds(b.id, { ...c, token: r.access_token, expires: new Date(Date.now() + (r.expires_in ?? 5184000) * 1000).toISOString() });
    } catch (e: any) {
      console.warn(`[ig] token refresh failed for brand ${b.id}: ${e?.message}`);
    }
  }
}

// ---------- insights ----------
export interface Insights {
  followers?: number;
  mediaCount?: number;
  recent: { id: string; caption: string; likeCount: number; commentsCount: number; permalink: string; timestamp: string }[];
}
export async function getInsights(brandId: string): Promise<Insights> {
  const { token, igUserId } = creds(brandId);
  const me = await get(igUserId, token, { fields: "followers_count,media_count,username" }).catch(() => get("me", token, { fields: "followers_count,media_count,username" }));
  const media = await get(`${igUserId}/media`, token, { fields: "id,caption,like_count,comments_count,permalink,timestamp,media_type", limit: 25 });
  return {
    followers: me.followers_count,
    mediaCount: me.media_count,
    recent: (media.data ?? []).map((m: any) => ({
      id: m.id,
      caption: m.caption ?? "",
      likeCount: m.like_count ?? 0,
      commentsCount: m.comments_count ?? 0,
      permalink: m.permalink ?? "",
      timestamp: m.timestamp ?? "",
    })),
  };
}

// ---------- publishing ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForContainer(id: string, token: string, timeoutMs = 10 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await get(id, token, { fields: "status_code,status" });
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new IgError(`Instagram could not process the media: ${s.status ?? s.status_code}`);
    await sleep(5000);
  }
  throw new IgError("Timed out waiting for Instagram to process the media");
}

/** Create a media container; if Instagram rejects one of the optional growth params, retry once without them. */
async function createContainer(igUserId: string, token: string, body: Record<string, unknown>, warnings: string[]) {
  try {
    return await post(`${igUserId}/media`, token, body);
  } catch (e: any) {
    const { body: plain, removed } = stripOptional(body);
    if (!removed.length || !(e instanceof IgError) || !looksLikeParamError(e.message)) throw e;
    warnings.push(`Instagram rejected optional ${removed.join(", ")} (${e.message}); retried without them`);
    return post(`${igUserId}/media`, token, plain);
  }
}

async function createVideoContainer(
  igUserId: string,
  token: string,
  mediaType: "REELS" | "STORIES",
  videoUrl: string,
  caption?: string,
  extras: Record<string, unknown> = {},
  warnings: string[] = [],
  shareFeed = true,
) {
  const local = localPathForUrl(videoUrl);
  const s = getSettings();
  const reelFields = caption !== undefined && mediaType === "REELS" ? { caption, ...(shareFeed ? { share_to_feed: true } : {}), ...extras } : {};
  if (local && fs.existsSync(local)) {
    const size = fs.statSync(local).size;
    const c = await createContainer(igUserId, token, {
      media_type: mediaType,
      upload_type: "resumable",
      ...reelFields,
    }, warnings);
    if (!c.uri) throw new IgError("Instagram did not return an upload uri");
    const buf = fs.readFileSync(local);
    const up = await fetch(c.uri, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(size), "Content-Type": "application/octet-stream" },
      body: buf,
    });
    if (!up.ok) {
      const t = await up.text().catch(() => "");
      let msg = t.slice(0, 300);
      try {
        msg = JSON.parse(t)?.debug_info?.message ?? JSON.parse(t)?.error?.message ?? msg;
      } catch {
        /* text */
      }
      throw new IgError(`Video upload failed (HTTP ${up.status}): ${msg}`);
    }
    return c.id as string;
  }
  if (!s.publicBaseUrl) throw new IgError("Rendered video file not found locally and no publicBaseUrl is set");
  const c = await createContainer(igUserId, token, {
    media_type: mediaType,
    video_url: publicUrlFor(videoUrl, s.publicBaseUrl),
    ...reelFields,
  }, warnings);
  return c.id as string;
}

export async function publishPost(postId: string): Promise<Post> {
  const p0 = getPost(postId);
  if (!p0) throw new IgError("Post not found");
  if (!p0.mediaUrls.length) throw new IgError("Post has no rendered media yet — render it first");
  const { token, igUserId } = creds(p0.brandId);
  updatePost(postId, (x) => {
    x.status = "publishing";
    x.error = undefined;
  });
  try {
    const caption = fullCaption(p0);
    const warnings: string[] = [];
    const opts: IgParamOptions = {
      publicBaseUrl: getSettings().publicBaseUrl,
      brandName: getBrand(p0.brandId)?.name,
      disabled: disabledFromEnv(),
    };
    // Alt text: stored (LLM or user-edited) or a heuristic description of each slide.
    const pa = { ...p0, altText: p0.altText?.some((a) => a?.trim()) ? p0.altText : heuristicAltText(p0, opts.brandName) };
    let creationId: string;
    if (p0.type === "image") {
      // single-image feed post: Instagram fetches the JPEG from a public URL
      const s = getSettings();
      if (!s.publicBaseUrl)
        throw new IgError("Image posts need a public URL so Instagram can fetch the image. Set publicBaseUrl in Settings (e.g. a cloudflared tunnel to http://localhost:4300).");
      creationId = (await createContainer(igUserId, token, imageContainerBody(pa, publicUrlFor(p0.mediaUrls[0], s.publicBaseUrl), caption, opts), warnings)).id;
    } else if (p0.type === "carousel") {
      const s = getSettings();
      if (!s.publicBaseUrl)
        throw new IgError(
          "Carousels need a public URL so Instagram can fetch the images. Set publicBaseUrl in Settings (e.g. a cloudflared tunnel to http://localhost:4300).",
        );
      const urls = p0.mediaUrls.slice(0, 10).map((u) => publicUrlFor(u, s.publicBaseUrl!));
      if (urls.length === 1) {
        creationId = (await createContainer(igUserId, token, { image_url: urls[0], caption, ...singleImageExtras(pa, opts) }, warnings)).id;
      } else {
        const children: string[] = [];
        for (const [i, u] of urls.entries())
          children.push((await createContainer(igUserId, token, { image_url: u, is_carousel_item: true, ...carouselItemExtras(pa, i, opts) }, warnings)).id);
        for (const c of children) await waitForContainer(c, token, 2 * 60 * 1000);
        creationId = (
          await createContainer(igUserId, token, { media_type: "CAROUSEL", children: children.join(","), caption, ...carouselParentExtras(p0, opts) }, warnings)
        ).id;
      }
    } else {
      const video = p0.mediaUrls[0];
      creationId = await createVideoContainer(
        igUserId,
        token,
        p0.type === "story" ? "STORIES" : "REELS",
        video,
        p0.type === "story" ? undefined : caption,
        reelContainerExtras(p0, opts),
        warnings,
        shareToFeed(p0, opts),
      );
    }
    await waitForContainer(creationId, token);
    const pub = await post(`${igUserId}/media_publish`, token, { creation_id: creationId });
    let permalink: string | undefined;
    try {
      permalink = (await get(pub.id, token, { fields: "permalink" })).permalink;
    } catch {
      /* stories may not have permalinks */
    }
    return updatePost(postId, (x) => {
      x.status = "posted";
      x.postedAt = nowIso();
      x.igMediaId = pub.id;
      x.igPermalink = permalink;
      x.error = undefined;
      x.publishWarnings = warnings.length ? warnings : undefined;
    })!;
  } catch (e: any) {
    updatePost(postId, (x) => {
      x.status = "failed";
      x.error = String(e?.message ?? e);
    });
    throw e;
  }
}

// ---------- comments / DMs ----------
export async function listRecentMedia(brandId: string, limit = 10): Promise<{ id: string; timestamp: string }[]> {
  const { token, igUserId } = creds(brandId);
  const r = await get(`${igUserId}/media`, token, { fields: "id,timestamp", limit });
  return r.data ?? [];
}
export async function listMediaComments(brandId: string, mediaId: string) {
  const { token } = creds(brandId);
  const r = await get(`${mediaId}/comments`, token, { fields: "id,text,username,timestamp,from", limit: 50 });
  return (r.data ?? []) as { id: string; text: string; username?: string; timestamp: string; from?: { id: string; username: string } }[];
}
export async function replyToComment(brandId: string, commentId: string, message: string) {
  const { token } = creds(brandId);
  return post(`${commentId}/replies`, token, { message });
}
export async function privateReply(brandId: string, commentId: string, text: string) {
  const { token, igUserId } = creds(brandId);
  return post(`${igUserId}/messages`, token, { recipient: { comment_id: commentId }, message: { text } });
}
export function igUsername(brandId: string) {
  return getIgCreds(brandId)?.username;
}

