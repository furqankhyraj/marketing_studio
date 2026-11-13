// Ad intelligence: Meta Ad Library, Google Ads Transparency Center and TikTok Ad Library via Apify, normalised to
// AdCreative and summarised per competitor (how many ads, active, formats, surfaces, longest-running "winners",
// hooks, offers, CTAs).
import type { AdCreative, AdPlatform, Competitor, CompetitorAds } from "../../../shared/types.ts";
import { ACTORS, apifyAvailable, runActor } from "./apify.ts";
import { CTA_RE, OFFER_RE, daysBetween, domainOf, firstSentence, isoDate, matchesCompetitor, rootDomain, topCounts, uniq } from "./util.ts";

const str = (v: unknown, max = 2000) => (v === undefined || v === null ? undefined : String(v).trim().slice(0, max) || undefined);

// ---------------------------------------------------------------- Meta
function metaFormat(snap: any): AdCreative["format"] {
  const df = String(snap?.display_format ?? snap?.displayFormat ?? "").toUpperCase();
  if (df.includes("VIDEO")) return "video";
  if (df.includes("CAROUSEL") || df.includes("DCO") || (Array.isArray(snap?.cards) && snap.cards.length > 1)) return "carousel";
  if (df.includes("IMAGE") || snap?.images?.length) return "image";
  if (snap?.videos?.length) return "video";
  return "unknown";
}
export function normalizeMetaAd(x: any): AdCreative | undefined {
  const snap = x?.snapshot ?? x;
  const id = str(x?.ad_archive_id ?? x?.adArchiveID ?? x?.id, 60);
  if (!id) return undefined;
  const body = str(snap?.body?.text ?? snap?.body ?? x?.ad_creative_bodies?.[0] ?? x?.body, 1500);
  const card = Array.isArray(snap?.cards) ? snap.cards[0] : undefined;
  const img = snap?.images?.[0]?.original_image_url ?? snap?.images?.[0]?.resized_image_url ?? card?.original_image_url ?? card?.resized_image_url;
  const vid = snap?.videos?.[0]?.video_hd_url ?? snap?.videos?.[0]?.video_sd_url ?? card?.video_hd_url;
  const preview = snap?.videos?.[0]?.video_preview_image_url ?? card?.video_preview_image_url ?? img;
  const link = str(snap?.link_url ?? card?.link_url ?? x?.link_url, 500);
  const start = isoDate(x?.start_date ?? x?.startDate ?? x?.ad_delivery_start_time);
  const end = isoDate(x?.end_date ?? x?.endDate ?? x?.ad_delivery_stop_time);
  const active = typeof x?.is_active === "boolean" ? x.is_active : x?.isActive ?? !end;
  const surfaces = (Array.isArray(x?.publisher_platform) ? x.publisher_platform : Array.isArray(x?.publisherPlatform) ? x.publisherPlatform : []).map((s: any) => String(s).toLowerCase());
  const reachRaw = x?.reach_estimate ?? x?.eu_total_reach ?? x?.reach;
  const reach = reachRaw && typeof reachRaw === "object" ? Number(reachRaw.lower_bound ?? reachRaw.min ?? 0) || undefined : Number(reachRaw ?? 0) || undefined;
  const activeDays = x?.total_active_time ? Math.round(Number(x.total_active_time) / 86400) : undefined;
  return {
    id,
    platform: "meta",
    advertiser: str(x?.page_name ?? snap?.page_name ?? x?.pageName, 120) ?? "",
    headline: str(snap?.title ?? card?.title ?? x?.ad_creative_link_titles?.[0], 300),
    body,
    cta: str(snap?.cta_text ?? card?.cta_text ?? x?.cta_text, 60),
    link,
    landingDomain: link ? rootDomain(domainOf(link)) : undefined,
    format: metaFormat(snap),
    imageUrl: str(img, 800),
    videoUrl: str(vid, 800),
    previewUrl: str(preview, 800),
    startDate: start,
    endDate: active ? undefined : end,
    active,
    daysRunning: activeDays || daysBetween(start, active ? undefined : end),
    surfaces,
    reach,
    spend: str(x?.spend, 60),
    countries: Array.isArray(x?.countries) ? x.countries.map(String) : undefined,
  };
}

/** One Ad Library search URL per competitor: the Facebook page when known, else a keyword search for the name. */
function metaUrlFor(c: Competitor, country: string): string {
  const fb = c.profile?.socials?.facebook;
  if (fb) return `https://www.facebook.com/${fb}`;
  const q = encodeURIComponent(c.kind === "etsy-shop" ? c.name : c.name);
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${country === "ALL" ? "ALL" : country.toUpperCase()}&q=${q}&search_type=keyword_unordered&media_type=all`;
}

// ---------------------------------------------------------------- Google
export function normalizeGoogleAd(x: any): AdCreative | undefined {
  const id = str(x?.creativeId ?? x?.googleCreativeId, 60);
  if (!id) return undefined;
  const fmt = String(x?.format ?? x?.previewType ?? "").toLowerCase();
  const start = isoDate(x?.firstShown);
  const end = isoDate(x?.lastShown);
  const stillOn = end ? Date.now() - Date.parse(end) < 7 * 86400_000 : undefined;
  const surfaces = Array.isArray(x?.platforms) ? x.platforms.map((p: any) => String(p).toLowerCase()) : [];
  return {
    id,
    platform: "google",
    advertiser: str(x?.advertiserName, 120) ?? "",
    headline: str(x?.adHeadline ?? x?.adBusinessName, 300),
    body: str(x?.adDescription ?? (Array.isArray(x?.adTextLines) ? x.adTextLines.join(" ") : undefined), 1500),
    link: str(x?.adUrl, 500),
    landingDomain: str(x?.domain ?? x?.adDisplayUrl, 120),
    format: fmt.includes("video") ? "video" : fmt.includes("image") ? "image" : fmt.includes("text") ? "text" : "unknown",
    imageUrl: str(x?.imageUrl, 800),
    previewUrl: str(x?.previewUrl ?? x?.imageUrl, 800),
    startDate: start,
    endDate: end,
    active: stillOn,
    daysRunning: Number(x?.shownForDays) || daysBetween(start, end),
    surfaces,
    reach: Number(x?.impressionsMin) || undefined,
    countries: Array.isArray(x?.regionsShown) ? x.regionsShown.map((r: any) => String(r.region)) : x?.region ? [String(x.region)] : undefined,
  };
}

// ---------------------------------------------------------------- TikTok
export function normalizeTikTokAd(x: any): AdCreative | undefined {
  const id = str(x?.adId, 60);
  if (!id) return undefined;
  const start = isoDate(x?.adStartDate);
  const end = isoDate(x?.adEndDate);
  const active = end ? Date.parse(end) > Date.now() - 86400_000 : true;
  return {
    id,
    platform: "tiktok",
    advertiser: str(x?.advertiserName, 120) ?? "",
    headline: str(x?.adTitle, 300),
    body: str(x?.adTitle, 1500),
    link: str(x?.adLandingUrl, 500),
    landingDomain: x?.adLandingUrl ? rootDomain(domainOf(String(x.adLandingUrl))) : undefined,
    format: x?.adVideoUrl ? "video" : "image",
    imageUrl: str(x?.adImageUrls?.[0] ?? x?.adVideoCover, 800),
    videoUrl: str(x?.adVideoUrl, 800),
    previewUrl: str(x?.adVideoCover ?? x?.adImageUrls?.[0], 800),
    startDate: start,
    endDate: active ? undefined : end,
    active,
    daysRunning: daysBetween(start, active ? undefined : end),
    surfaces: ["tiktok"],
    reach: Number(String(x?.adImpressions ?? "").replace(/[^\d]/g, "")) || undefined,
    spend: str(x?.adSpent, 60),
    countries: x?.advertiserLocation ? [String(x.advertiserLocation)] : undefined,
  };
}

// ---------------------------------------------------------------- summary
export function summarizeAds(platform: AdPlatform, ads: AdCreative[]): CompetitorAds {
  const byFormat: Record<string, number> = {};
  const bySurface: Record<string, number> = {};
  for (const a of ads) {
    byFormat[a.format] = (byFormat[a.format] ?? 0) + 1;
    for (const s of a.surfaces ?? []) bySurface[s] = (bySurface[s] ?? 0) + 1;
  }
  const cutoff = Date.now() - 30 * 86400_000;
  const texts = ads.map((a) => [a.headline, a.body].filter(Boolean).join(" ")).filter(Boolean);
  const hooks = topCounts(ads.map((a) => firstSentence(a.body || a.headline)).filter((h) => h.length > 12), 12).map((x) => x.value);
  const offers = topCounts(texts.flatMap((t) => (t.match(OFFER_RE) ?? []).map((s) => s.toLowerCase())), 8).map((x) => `${x.value} (${x.count})`);
  const ctas = topCounts([...ads.map((a) => a.cta ?? ""), ...texts.flatMap((t) => (t.match(CTA_RE) ?? []).map((s) => s.toLowerCase()))].filter(Boolean), 8).map((x) => `${x.value} (${x.count})`);
  const byLong = [...ads].filter((a) => a.daysRunning !== undefined).sort((a, b) => (b.daysRunning ?? 0) - (a.daysRunning ?? 0));
  const samples = uniq([...byLong.filter((a) => a.active).slice(0, 4), ...ads.filter((a) => a.active).slice(0, 4), ...ads.slice(0, 4)]).slice(0, 8);
  return {
    platform,
    total: ads.length,
    active: ads.filter((a) => a.active).length,
    byFormat,
    bySurface,
    newLast30d: ads.filter((a) => a.startDate && Date.parse(a.startDate) >= cutoff).length,
    longestRunning: byLong.slice(0, 5),
    samples,
    hooks,
    offers,
    ctas,
  };
}

export interface AdsInput {
  competitors: Competitor[];
  platforms: AdPlatform[];
  country: string;
  maxPer: number;
  log: (t: string) => void;
  onCost: (usd: number) => void;
}

/** Read the ad libraries for every competitor. Mutates `competitors[].ads`. Returns all normalised ads. */
export async function collectAds(inp: AdsInput): Promise<AdCreative[]> {
  const all: AdCreative[] = [];
  if (!apifyAvailable() || !inp.competitors.length) {
    inp.log("Ad libraries skipped (no Apify token)");
    return all;
  }
  const tasks: Promise<void>[] = [];
  const setAds = (c: Competitor, p: AdPlatform, ads: AdCreative[], error?: string) => {
    c.ads ??= {};
    c.ads[p] = { ...summarizeAds(p, ads), ...(error ? { error } : {}) };
    all.push(...ads);
  };

  if (inp.platforms.includes("meta")) {
    tasks.push(
      (async () => {
        try {
          const urls = inp.competitors.map((c) => ({ url: metaUrlFor(c, inp.country) }));
          // this actor wants ≥10 results and 512 MB of memory per input URL
          const per = Math.max(10, inp.maxPer);
          const r = await runActor<any>(ACTORS.metaAds, { urls, limitPerSource: per, count: per * urls.length, scrapeAdDetails: false, "scrapePageAds.activeStatus": "all", "scrapePageAds.sortBy": "impressions_desc", "scrapePageAds.countryCode": "ALL" }, { timeoutSec: 420, memoryMb: Math.min(4096, 512 * urls.length), maxItems: per * urls.length + 50 });
          inp.onCost(r.costUsd);
          const ads = r.items.map(normalizeMetaAd).filter((a): a is AdCreative => !!a);
          // attribute to competitors by advertiser name / link; keyword searches return other advertisers too
          for (const c of inp.competitors) {
            const mine = ads.filter((a) => matchesCompetitor(a.advertiser, a.link, { name: c.name, domain: domainOf(c.website) || c.domain }));
            setAds(c, "meta", mine);
          }
          inp.log(`Meta Ad Library: ${ads.length} ads read, ${inp.competitors.reduce((n, c) => n + (c.ads?.meta?.total ?? 0), 0)} matched to competitors`);
        } catch (e: any) {
          for (const c of inp.competitors) setAds(c, "meta", [], String(e?.message ?? e));
          inp.log(`Meta Ad Library failed: ${e?.message ?? e}`);
        }
      })(),
    );
  }
  if (inp.platforms.includes("google")) {
    tasks.push(
      (async () => {
        const targets = inp.competitors.filter((c) => c.kind === "brand" || c.kind === "etsy-shop");
        if (!targets.length) return;
        try {
          const queries = targets.map((c) => (c.kind === "etsy-shop" ? c.name : domainOf(c.website)));
          const r = await runActor<any>(ACTORS.googleAds, { queries, resultType: "ads", region: inp.country === "ALL" ? "ANYWHERE" : inp.country.toUpperCase(), maxAdsPerSearch: inp.maxPer, maxAdvertisersPerQuery: 2, includeAdText: true, includeDetails: false, adFormat: "ALL" }, { timeoutSec: 420, maxItems: inp.maxPer * targets.length + 50 });
          inp.onCost(r.costUsd);
          const ads = r.items.map(normalizeGoogleAd).filter((a): a is AdCreative => !!a);
          for (const c of targets) {
            const dom = rootDomain(domainOf(c.website));
            const mine = ads.filter((a) => (a.landingDomain && dom && a.landingDomain.includes(dom)) || matchesCompetitor(a.advertiser, a.link, { name: c.name, domain: dom || c.domain }));
            setAds(c, "google", mine);
          }
          inp.log(`Google Ads Transparency: ${ads.length} ads read`);
        } catch (e: any) {
          for (const c of targets) setAds(c, "google", [], String(e?.message ?? e));
          inp.log(`Google Ads Transparency failed: ${e?.message ?? e}`);
        }
      })(),
    );
  }
  if (inp.platforms.includes("tiktok")) {
    for (const c of inp.competitors) {
      tasks.push(
        (async () => {
          try {
            const r = await runActor<any>(ACTORS.tiktokAds, { advertiserName: c.name, country: "all", maxPages: 1, quickSearch: true, sortBy: "last_shown_date,desc" }, { timeoutSec: 180, maxItems: inp.maxPer });
            inp.onCost(r.costUsd);
            const ads = r.items.map(normalizeTikTokAd).filter((a): a is AdCreative => !!a).filter((a) => matchesCompetitor(a.advertiser, a.link, { name: c.name, domain: domainOf(c.website) || c.domain }));
            setAds(c, "tiktok", ads);
          } catch (e: any) {
            setAds(c, "tiktok", [], String(e?.message ?? e));
          }
        })(),
      );
    }
  }
  await Promise.all(tasks);
  for (const c of inp.competitors) {
    c.adsTotal = Object.values(c.ads ?? {}).reduce((n, a) => n + (a?.total ?? 0), 0);
    c.adsActive = Object.values(c.ads ?? {}).reduce((n, a) => n + (a?.active ?? 0), 0);
  }
  if (inp.platforms.includes("tiktok")) inp.log(`TikTok Ad Library: ${inp.competitors.reduce((n, c) => n + (c.ads?.tiktok?.total ?? 0), 0)} ads`);
  return all;
}
