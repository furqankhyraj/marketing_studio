// Competitor profiling: website (products, prices, offers, CTAs, social links), Etsy shop (RSS), Play Store app,
// and Instagram profile metrics (own Graph API business_discovery when the brand's IG is connected, else Apify).
import type { Competitor, CompetitorProfile, CompetitorSocial } from "../../../shared/types.ts";
import { scrapeSite } from "../scrape.ts";
import { topKeywords } from "../brain.ts";
import { EtsyApi, fetchShopRss } from "../etsy-client.ts";
import { etsyKey } from "../etsy.ts";
import { fetchPlayListing, packageIdFrom } from "../playstore.ts";
import { getIgCreds, getBrand } from "../db.ts";
import { ACTORS, apifyAvailable, runActor } from "./apify.ts";
import { CTA_RE, OFFER_RE, PRICE_RE, UA, domainOf, topCounts, uniq } from "./util.ts";
import { etsyShopFromUrl } from "./discover.ts";

const SOCIAL_RE: [keyof CompetitorProfile["socials"], RegExp][] = [
  ["instagram", /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]{2,30})\/?(?=["'?#\s<]|$)/g],
  ["facebook", /https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|share|dialog|login|plugins|tr\b|ads\/)([A-Za-z0-9_.-]{2,60})\/?(?=["'?#\s<]|$)/g],
  ["tiktok", /https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9_.]{2,30})/g],
  ["youtube", /https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/|user\/)([A-Za-z0-9_.-]{2,60})/g],
  ["pinterest", /https?:\/\/(?:www\.)?pinterest\.[a-z.]+\/([A-Za-z0-9_]{2,30})\/?(?=["'?#\s<]|$)/g],
  ["x", /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{2,20})\/?(?=["'?#\s<]|$)/g],
];
const SOCIAL_SKIP = /^(share|intent|home|login|p|reel|explore|hashtag|policies|legal|privacy|help|about|pages|groups|events|watch|marketplace|gaming|stories|photo|photos|video|videos|search|tag|wp-content)$/i;

export function socialsFromHtml(html: string): CompetitorProfile["socials"] {
  const out: CompetitorProfile["socials"] = {};
  for (const [k, re] of SOCIAL_RE) {
    const counts = new Map<string, number>();
    for (const m of html.matchAll(re)) {
      const h = m[1];
      if (SOCIAL_SKIP.test(h)) continue;
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) out[k] = best[0];
  }
  return out;
}

async function fetchHtml(url: string): Promise<string> {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    return r.ok ? (await r.text()).slice(0, 1_500_000) : "";
  } catch {
    return "";
  }
}

function textSignals(text: string) {
  const offers = uniq((text.match(OFFER_RE) ?? []).map((s) => s.toLowerCase())).slice(0, 10);
  const ctas = uniq((text.match(CTA_RE) ?? []).map((s) => s.toLowerCase())).slice(0, 10);
  const prices = uniq((text.match(PRICE_RE) ?? []).map((s) => s.replace(/\s+/g, ""))).slice(0, 12);
  return { offers, ctas, prices };
}

export async function profileCompetitor(c: Competitor): Promise<CompetitorProfile> {
  const empty: CompetitorProfile = { products: [], prices: [], offers: [], ctas: [], keywords: [], colors: [], socials: {}, pages: 0 };
  try {
    if (c.kind === "etsy-shop") {
      const shop = etsyShopFromUrl(c.website) ?? c.name;
      const rss = await fetchShopRss(shop);
      let stats = "";
      const key = etsyKey();
      if (key) {
        try {
          const s = await new EtsyApi({ apiKey: key }).findShop(shop);
          stats = `${s.listingCount ?? "?"} active listings · ${s.reviewCount ?? "?"} reviews${s.reviewAverage ? ` (avg ${s.reviewAverage})` : ""}`;
        } catch {
          /* fine without */
        }
      }
      const titles = rss.listings.map((i) => i.title).filter(Boolean);
      const prices = uniq(rss.listings.map((i) => (i.price !== undefined ? `${i.price}${i.currency ? " " + i.currency : ""}` : "")).filter(Boolean)).slice(0, 12);
      const text = [...titles, ...rss.listings.map((i) => i.description.slice(0, 300))].join(". ");
      return { ...empty, title: `${rss.shop.name ?? shop} on Etsy`, description: [stats, rss.shop.title].filter(Boolean).join(" — "), products: titles.slice(0, 15), keywords: topKeywords(text, 12), ...textSignals(text), prices, pages: 1 };
    }
    if (c.kind === "app") {
      const pkg = packageIdFrom(c.website);
      if (!pkg) return { ...empty, error: "No package id" };
      const info = await fetchPlayListing(pkg);
      const text = [info.summary, info.description].join("\n");
      const socials = info.developerUrl ? socialsFromHtml(await fetchHtml(info.developerUrl)) : {};
      return {
        ...empty,
        title: info.title,
        description: info.summary,
        tagline: info.summary,
        products: info.features.map((f) => f.title).slice(0, 12),
        keywords: topKeywords(text, 12),
        ...textSignals(text),
        prices: info.free ? ["free"] : [],
        socials,
        pages: 1,
      };
    }
    const [s, html] = await Promise.all([scrapeSite(c.website), fetchHtml(c.website)]);
    if (!s.ok) return { ...empty, blocked: s.blocked, error: s.error, socials: socialsFromHtml(html) };
    const text = [s.title, s.description, ...s.headings, s.text].filter(Boolean).join("\n");
    const products = uniq(s.headings.filter((h) => h.length > 3 && h.length < 70 && !/^(home|shop|about|contact|menu|cart|login|blog|faq|search|subscribe|newsletter|follow us|privacy|terms)$/i.test(h))).slice(0, 15);
    return {
      ...empty,
      title: s.title,
      description: s.description,
      tagline: s.headings[0],
      products,
      keywords: topKeywords(text, 12),
      colors: s.colors.slice(0, 6),
      ...textSignals(text),
      socials: socialsFromHtml(html),
      pages: s.pages.length,
    };
  } catch (e: any) {
    return { ...empty, error: String(e?.message ?? e) };
  }
}

// ---------------------------------------------------------------- Instagram
interface IgRaw {
  username: string;
  followers?: number;
  follows?: number;
  posts?: number;
  verified?: boolean;
  bio?: string;
  website?: string;
  recent: { url: string; type: string; likes: number; comments: number; caption: string; timestamp?: string; hashtags: string[] }[];
  error?: string;
}

function summarize(r: IgRaw): CompetitorSocial {
  const recent = r.recent.slice(0, 12);
  const likes = recent.map((p) => p.likes);
  const comments = recent.map((p) => p.comments);
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  const times = recent.map((p) => (p.timestamp ? Date.parse(p.timestamp) : NaN)).filter((t) => !isNaN(t)).sort((a, b) => a - b);
  const spanDays = times.length >= 2 ? Math.max(1, (times[times.length - 1] - times[0]) / 86400_000) : 0;
  const postsPerWeek = spanDays ? Math.round(((times.length - 1) / spanDays) * 7 * 10) / 10 : undefined;
  const formats: Record<string, number> = {};
  for (const p of recent) formats[p.type] = (formats[p.type] ?? 0) + 1;
  const best = [...recent].sort((a, b) => b.likes + b.comments * 3 - (a.likes + a.comments * 3))[0];
  return {
    platform: "instagram",
    username: r.username,
    url: `https://www.instagram.com/${r.username}/`,
    followers: r.followers,
    follows: r.follows,
    posts: r.posts,
    verified: r.verified,
    bio: r.bio,
    website: r.website,
    postsPerWeek,
    engagementRate: r.followers && recent.length ? Math.round(((avg(likes) + avg(comments)) / r.followers) * 10000) / 100 : undefined,
    avgLikes: avg(likes),
    avgComments: avg(comments),
    formats,
    topHashtags: topCounts(recent.flatMap((p) => p.hashtags), 10).map((x) => x.value),
    recent: recent.map(({ hashtags: _h, ...p }) => ({ ...p, caption: p.caption.slice(0, 220) })),
    bestPost: best ? { url: best.url, likes: best.likes, comments: best.comments, caption: best.caption.slice(0, 220) } : undefined,
    error: r.error,
  };
}

/** Own-token route (free): Instagram Graph API business_discovery. Works only for business/creator accounts. */
async function viaBusinessDiscovery(brandId: string, username: string): Promise<IgRaw | undefined> {
  const creds = getIgCreds(brandId);
  const b = getBrand(brandId);
  if (!creds || !b?.igUserId) return undefined;
  const fields = `business_discovery.username(${username}){username,followers_count,follows_count,media_count,biography,website,media.limit(12){like_count,comments_count,media_type,media_product_type,timestamp,caption,permalink}}`;
  const url = `https://graph.instagram.com/v23.0/${b.igUserId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(creds.token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const j: any = await res.json().catch(() => ({}));
  const d = j?.business_discovery;
  if (!res.ok || !d) return undefined;
  return {
    username: d.username ?? username,
    followers: d.followers_count,
    follows: d.follows_count,
    posts: d.media_count,
    bio: d.biography,
    website: d.website,
    recent: (d.media?.data ?? []).map((m: any) => ({
      url: m.permalink,
      type: m.media_product_type === "REELS" ? "Video" : m.media_type === "CAROUSEL_ALBUM" ? "Sidecar" : m.media_type === "VIDEO" ? "Video" : "Image",
      likes: Number(m.like_count ?? 0),
      comments: Number(m.comments_count ?? 0),
      caption: String(m.caption ?? ""),
      timestamp: m.timestamp,
      hashtags: [...String(m.caption ?? "").matchAll(/#([\p{L}\p{N}_]+)/gu)].map((x) => x[1].toLowerCase()),
    })),
  };
}

/** Apify instagram-profile-scraper for many usernames in one run. */
async function viaApify(usernames: string[], onCost: (usd: number) => void): Promise<Map<string, IgRaw>> {
  const out = new Map<string, IgRaw>();
  if (!usernames.length || !apifyAvailable()) return out;
  const r = await runActor<any>(ACTORS.igProfile, { usernames, includeAboutSection: false }, { timeoutSec: 300 });
  onCost(r.costUsd);
  for (const p of r.items) {
    const u = String(p?.username ?? "").toLowerCase();
    if (!u) continue;
    if (p?.error) {
      out.set(u, { username: u, recent: [], error: String(p.error) });
      continue;
    }
    out.set(u, {
      username: p.username,
      followers: Number(p.followersCount ?? 0) || undefined,
      follows: Number(p.followsCount ?? 0) || undefined,
      posts: Number(p.postsCount ?? 0) || undefined,
      verified: !!p.verified,
      bio: p.biography,
      website: Array.isArray(p.externalUrls) && p.externalUrls[0]?.url ? p.externalUrls[0].url : p.externalUrl,
      recent: (p.latestPosts ?? []).map((m: any) => ({
        url: m.url ?? (m.shortCode ? `https://www.instagram.com/p/${m.shortCode}/` : ""),
        type: m.type ?? "Image",
        likes: Number(m.likesCount ?? 0),
        comments: Number(m.commentsCount ?? 0),
        caption: String(m.caption ?? ""),
        timestamp: m.timestamp,
        hashtags: Array.isArray(m.hashtags) ? m.hashtags.map((h: any) => String(h).toLowerCase()) : [],
      })),
    });
  }
  return out;
}

/** Instagram metrics for a set of usernames: own Graph token first (free), Apify for the rest. */
export async function instagramProfiles(brandId: string, usernames: string[], onCost: (usd: number) => void, log: (t: string) => void): Promise<Map<string, CompetitorSocial>> {
  const out = new Map<string, CompetitorSocial>();
  const names = uniq(usernames.map((u) => u.replace(/^@/, "").toLowerCase()).filter(Boolean));
  const pending: string[] = [];
  for (const u of names) {
    try {
      const r = await viaBusinessDiscovery(brandId, u);
      if (r) out.set(u, summarize(r));
      else pending.push(u);
    } catch {
      pending.push(u);
    }
  }
  if (pending.length) {
    try {
      const m = await viaApify(pending, onCost);
      for (const [u, r] of m) out.set(u, summarize(r));
      log(`Instagram: ${m.size} profiles read${out.size - m.size > 0 ? ` (+${out.size - m.size} via your connected account)` : ""}`);
    } catch (e: any) {
      log(`Instagram profiles skipped: ${e?.message ?? e}`);
    }
  } else if (out.size) log(`Instagram: ${out.size} profiles read via your connected account`);
  return out;
}

export const domainForMatch = (c: Competitor) => (c.kind === "etsy-shop" ? `${etsyShopFromUrl(c.website) ?? c.name}.etsy.com` : c.kind === "app" ? `${c.name.replace(/\s+/g, "").toLowerCase()}.app` : domainOf(c.website));
