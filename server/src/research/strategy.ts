// Strategy synthesis: compress everything the pipeline found into a digest, ask Claude for a full marketing
// strategy (positioning, messaging, 30-day content plan, ad plan, SEO, KPIs), normalise it, or build a
// rule-based strategy when no LLM is configured.
import type { AdCreative, Brand, BrandBrain, Competitor, PostType, ResearchReport, Strategy } from "../../../shared/types.ts";
import { askJson, llmAvailable } from "../llm.ts";
import { topCounts, uniq } from "./util.ts";

const STRATEGY_SYSTEM = `You are a senior growth marketer writing a strategy for a small brand owner who runs their own marketing (Instagram reels, image posts, carousels, Pinterest, light paid ads). You get a research digest: the brand, its competitors (sites, Instagram metrics, what ads they run and for how long, their hooks/offers/CTAs), search landscape.
Write for a busy owner: concrete, specific to THIS brand and THESE competitors, no generic advice. Where competitors' long-running ads reveal what works, say so explicitly ("X has run 'hook…' for 140 days → that angle converts"). Never invent numbers, reviews or facts not in the digest; when data is missing, say what to test.
Return JSON exactly:
{"summary": string (5-7 sentences: market picture, where the brand stands, the single biggest opportunity),
 "positioning": {"statement": string (one line: for WHO, the brand is the ONLY X that Y), "differentiators": string[3-5], "gaps": string[3-5] (what competitors do that the brand doesn't yet, or do badly)},
 "audience": {"segments": [{"name": string, "pain": string, "trigger": string (the moment they search/buy)}] (2-4)},
 "messaging": {"hooks": string[8] (scroll-stopping first lines for reels/ads, written for this brand), "offers": string[3-5] (offer ideas grounded in what competitors run and the brand's margins), "ctas": string[3-4], "claimsToAvoid": string[2-4]},
 "content": {"pillars": [{"name": string, "why": string, "formats": string[]}] (4-6), "cadence": string (posts per week by format, with the reasoning vs competitors' cadence), "plan30": [{"day": number 1-30, "type": "reel"|"image"|"carousel"|"story", "pillar": string, "hook": string, "notes"?: string}] (12-16 posts spread over 30 days)},
 "ads": {"recommended": boolean, "why": string, "channels": [{"platform": "Meta"|"Google"|"TikTok"|"Pinterest", "why": string, "budgetShare": number (0-100, sums to 100)}], "concepts": [{"name": string, "angle": string, "hook": string, "format": "video"|"image"|"carousel"|"text", "cta": string, "landing": string}] (4-6), "testPlan": string[3-5]},
 "seo": {"keywords": string[8-12] (search terms to own, from the digest), "notes": string[2-4]},
 "quickWins": string[5-8] (things to do this week),
 "kpis": [{"name": string, "target": string}] (4-6),
 "risks": string[2-4]}`;

const n = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const s = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const arr = (v: unknown, max = 12, m = 300) => (Array.isArray(v) ? v.map((x) => s(x, m)).filter(Boolean).slice(0, max) : []);
const TYPES: PostType[] = ["reel", "image", "carousel", "story"];

export function normalizeStrategy(raw: any, fb: Strategy): Strategy {
  const r = raw && typeof raw === "object" ? raw : {};
  const channels = Array.isArray(r.ads?.channels) ? r.ads.channels.map((c: any) => ({ platform: s(c?.platform, 20) || "Meta", why: s(c?.why), budgetShare: n(c?.budgetShare) })).filter((c: any) => c.platform) : fb.ads.channels;
  const total = channels.reduce((a: number, c: any) => a + c.budgetShare, 0) || 1;
  return {
    summary: s(r.summary, 2000) || fb.summary,
    positioning: {
      statement: s(r.positioning?.statement) || fb.positioning.statement,
      differentiators: arr(r.positioning?.differentiators, 6).length ? arr(r.positioning?.differentiators, 6) : fb.positioning.differentiators,
      gaps: arr(r.positioning?.gaps, 6).length ? arr(r.positioning?.gaps, 6) : fb.positioning.gaps,
    },
    audience: { segments: Array.isArray(r.audience?.segments) && r.audience.segments.length ? r.audience.segments.slice(0, 4).map((x: any) => ({ name: s(x?.name, 80), pain: s(x?.pain), trigger: s(x?.trigger) })) : fb.audience.segments },
    messaging: {
      hooks: arr(r.messaging?.hooks, 10, 160).length ? arr(r.messaging?.hooks, 10, 160) : fb.messaging.hooks,
      offers: arr(r.messaging?.offers, 6).length ? arr(r.messaging?.offers, 6) : fb.messaging.offers,
      ctas: arr(r.messaging?.ctas, 5, 80).length ? arr(r.messaging?.ctas, 5, 80) : fb.messaging.ctas,
      claimsToAvoid: arr(r.messaging?.claimsToAvoid, 5).length ? arr(r.messaging?.claimsToAvoid, 5) : fb.messaging.claimsToAvoid,
    },
    content: {
      pillars: Array.isArray(r.content?.pillars) && r.content.pillars.length ? r.content.pillars.slice(0, 6).map((p: any) => ({ name: s(p?.name, 60), why: s(p?.why), formats: arr(p?.formats, 4, 20) })).filter((p: any) => p.name) : fb.content.pillars,
      cadence: s(r.content?.cadence) || fb.content.cadence,
      plan30: Array.isArray(r.content?.plan30) && r.content.plan30.length ? r.content.plan30.slice(0, 20).map((p: any) => ({ day: Math.max(1, Math.min(30, Math.round(n(p?.day, 1)))), type: (TYPES.includes(p?.type) ? p.type : "reel") as PostType, pillar: s(p?.pillar, 60), hook: s(p?.hook, 160), notes: s(p?.notes, 200) || undefined })).sort((a: any, b: any) => a.day - b.day) : fb.content.plan30,
    },
    ads: {
      recommended: typeof r.ads?.recommended === "boolean" ? r.ads.recommended : fb.ads.recommended,
      why: s(r.ads?.why) || fb.ads.why,
      channels: channels.map((c: any) => ({ ...c, budgetShare: Math.round((c.budgetShare / total) * 100) })),
      concepts: Array.isArray(r.ads?.concepts) && r.ads.concepts.length ? r.ads.concepts.slice(0, 6).map((c: any) => ({ name: s(c?.name, 80), angle: s(c?.angle), hook: s(c?.hook, 160), format: s(c?.format, 20) || "video", cta: s(c?.cta, 60), landing: s(c?.landing, 200) })) : fb.ads.concepts,
      testPlan: arr(r.ads?.testPlan, 6).length ? arr(r.ads?.testPlan, 6) : fb.ads.testPlan,
    },
    seo: { keywords: arr(r.seo?.keywords, 12, 80).length ? arr(r.seo?.keywords, 12, 80) : fb.seo.keywords, notes: arr(r.seo?.notes, 4) },
    quickWins: arr(r.quickWins, 8).length ? arr(r.quickWins, 8) : fb.quickWins,
    kpis: Array.isArray(r.kpis) && r.kpis.length ? r.kpis.slice(0, 6).map((k: any) => ({ name: s(k?.name, 60), target: s(k?.target, 120) })) : fb.kpis,
    risks: arr(r.risks, 4),
  };
}

/** Compact digest for the prompt (keeps the request well under the model's limits). */
export function digestFor(brand: Brand, brain: BrandBrain, report: Omit<ResearchReport, "strategy" | "id" | "jobId" | "createdAt" | "llm">) {
  const comp = report.competitors.map((c) => ({
    name: c.name,
    site: c.website,
    kind: c.kind,
    why: c.why,
    sells: c.profile?.products.slice(0, 8),
    prices: c.profile?.prices.slice(0, 6),
    offers: c.profile?.offers.slice(0, 5),
    siteCtas: c.profile?.ctas.slice(0, 5),
    instagram: c.social
      ? { followers: c.social.followers, postsPerWeek: c.social.postsPerWeek, engagementRate: c.social.engagementRate, formats: c.social.formats, topHashtags: c.social.topHashtags?.slice(0, 6), bestPost: c.social.bestPost?.caption?.slice(0, 120) }
      : undefined,
    ads: Object.values(c.ads ?? {})
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => ({
        platform: a.platform,
        total: a.total,
        active: a.active,
        newLast30d: a.newLast30d,
        formats: a.byFormat,
        surfaces: a.bySurface,
        longestRunning: a.longestRunning.slice(0, 3).map((x) => ({ days: x.daysRunning, hook: (x.body || x.headline || "").slice(0, 140), cta: x.cta, format: x.format })),
        hooks: a.hooks.slice(0, 6),
        offers: a.offers.slice(0, 5),
        ctas: a.ctas.slice(0, 5),
        error: a.error ? "unavailable" : undefined,
      })),
  }));
  return {
    brand: { name: brand.name, website: report.website, summary: brain.summary, products: brain.products.slice(0, 10), audience: brain.audience, voice: brain.voice, differentiators: brain.differentiators, claimsToAvoid: brain.claimsToAvoid, ctas: brain.ctas, pillars: brain.contentPillars, language: brain.language ?? "en", instagram: report.brandSnapshot.social ? { followers: report.brandSnapshot.social.followers, postsPerWeek: report.brandSnapshot.social.postsPerWeek, engagementRate: report.brandSnapshot.social.engagementRate } : "not connected / unknown", ownAds: report.brandSnapshot.adsTotal },
    searches: report.keywords,
    searchLandscape: report.landscape.serp.map((x) => ({ query: x.query, whoRanks: x.topDomains.slice(0, 6) })),
    adLandscape: report.landscape.adSummary,
    commonHooks: report.landscape.commonHooks,
    commonOffers: report.landscape.commonOffers,
    commonCtas: report.landscape.commonCtas,
    competitors: comp,
  };
}

export function heuristicStrategy(brand: Brand, brain: BrandBrain, report: Omit<ResearchReport, "strategy" | "id" | "jobId" | "createdAt" | "llm">): Strategy {
  const comps = report.competitors;
  const advertising = comps.filter((c) => c.adsTotal > 0);
  const topAds = advertising.sort((a, b) => b.adsTotal - a.adsTotal).slice(0, 3);
  const hooks = uniq([...report.landscape.commonHooks, ...brain.differentiators.map((d) => `${d} — here's how`)]).slice(0, 8);
  const pillars = (brain.contentPillars.length ? brain.contentPillars : ["Product in use", "Tips", "Behind the scenes", "Social proof"]).slice(0, 5).map((p) => ({ name: p, why: "From the brand brain", formats: ["reel", "image"] }));
  const plan30 = Array.from({ length: 12 }, (_, i) => ({ day: i * 2 + 1 + (i % 2), type: (["reel", "image", "reel", "carousel"] as PostType[])[i % 4], pillar: pillars[i % pillars.length].name, hook: hooks[i % Math.max(1, hooks.length)] ?? brain.ctas[0] ?? "" }));
  const igCadence = comps.map((c) => c.social?.postsPerWeek).filter((x): x is number => !!x);
  const avgCadence = igCadence.length ? Math.round((igCadence.reduce((a, b) => a + b, 0) / igCadence.length) * 10) / 10 : undefined;
  return {
    summary: `${comps.length} competitors found for ${brand.name}${advertising.length ? `; ${advertising.length} of them run paid ads (${topAds.map((c) => `${c.name}: ${c.adsTotal}`).join(", ")})` : "; none of them appear in the ad libraries"}. ${avgCadence ? `Competitors post about ${avgCadence}×/week on Instagram.` : ""} Add an Anthropic key or Claude subscription token in Settings for a full written strategy — this is the rule-based version.`,
    positioning: { statement: `For ${brain.audience || "its customers"}, ${brand.name} is the ${brain.niche || "brand"} that ${brain.differentiators[0] ?? "does it differently"}.`, differentiators: brain.differentiators.slice(0, 5), gaps: uniq(comps.flatMap((c) => c.profile?.offers ?? [])).slice(0, 5).map((o) => `Competitors use "${o}"`) },
    audience: { segments: [{ name: brain.audience || "Core customers", pain: "See brand brain", trigger: report.keywords[0]?.query ?? "" }] },
    messaging: { hooks, offers: uniq(report.landscape.commonOffers).slice(0, 5), ctas: uniq([...brain.ctas, ...report.landscape.commonCtas]).slice(0, 4), claimsToAvoid: brain.claimsToAvoid.slice(0, 4) },
    content: { pillars, cadence: `${avgCadence ? `Match or beat competitors' ~${avgCadence} posts/week` : "4-5 posts/week"}: 3 reels, 1-2 image posts, 1 carousel`, plan30 },
    ads: {
      recommended: advertising.length > 0,
      why: advertising.length ? `${advertising.length} competitors sustain paid ads, so the category converts with ads.` : "No competitor ads found — grow organically first, test a small Meta budget later.",
      channels: [{ platform: "Meta", why: "Reels + feed; where competitors advertise", budgetShare: 70 }, { platform: "Pinterest", why: "Search-driven discovery for printables/apps", budgetShare: 30 }],
      concepts: report.landscape.commonHooks.slice(0, 4).map((h, i) => ({ name: `Concept ${i + 1}`, angle: "Borrowed from a long-running competitor ad", hook: h, format: "video", cta: brain.ctas[0] ?? "Learn more", landing: report.website })),
      testPlan: ["Run 3 hooks × 1 format for 7 days at a small daily budget", "Keep the best hook, test 2 new formats", "Scale what holds cost per result for 14 days"],
    },
    seo: { keywords: uniq([...report.keywords.map((k) => k.query), ...brain.keywords]).slice(0, 12), notes: [] },
    quickWins: ["Add the top search phrase to your Instagram bio and website title", "Post a reel using the most common competitor hook, in your own voice", "Pin your best product with a keyword-rich title", ...(advertising.length ? ["Save the 3 longest-running competitor ads as creative references"] : [])],
    kpis: [{ name: "Reels reach / week", target: "+20% month over month" }, { name: "Profile → website clicks", target: "Track weekly" }, { name: "Posting cadence", target: `${avgCadence ?? 4}+ posts/week` }],
    risks: [],
  };
}

export async function synthesizeStrategy(brand: Brand, brain: BrandBrain, report: Omit<ResearchReport, "strategy" | "id" | "jobId" | "createdAt" | "llm">, log: (t: string) => void): Promise<{ strategy: Strategy; llm: ResearchReport["llm"] }> {
  const fb = heuristicStrategy(brand, brain, report);
  if (!llmAvailable()) return { strategy: fb, llm: "none" };
  try {
    const raw = await askJson<any>(STRATEGY_SYSTEM, JSON.stringify(digestFor(brand, brain, report)), 9000);
    const { llmMode } = await import("../llm.ts");
    log("Strategy written by Claude");
    return { strategy: normalizeStrategy(raw, fb), llm: llmMode() ?? "none" };
  } catch (e: any) {
    log(`Claude strategy failed (${e?.message ?? e}); using the rule-based strategy`);
    return { strategy: fb, llm: "none" };
  }
}

/** Cross-competitor landscape stats. */
export function landscapeFrom(competitors: Competitor[], allAds: AdCreative[], serp: ResearchReport["landscape"]["serp"]): ResearchReport["landscape"] {
  const platforms = ["meta", "google", "tiktok"] as const;
  const adSummary = platforms
    .map((p) => {
      const have = competitors.filter((c) => c.ads?.[p]);
      const ads = allAds.filter((a) => a.platform === p);
      if (!have.length) return undefined;
      return { platform: p, competitorsAdvertising: have.filter((c) => (c.ads?.[p]?.total ?? 0) > 0).length, totalAds: ads.length, activeAds: ads.filter((a) => a.active).length, topFormats: topCounts(ads.map((a) => a.format), 3).map((x) => `${x.value} (${x.count})`) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const cad = competitors.map((c) => c.social?.postsPerWeek).filter((x): x is number => !!x);
  return {
    serp,
    adSummary,
    commonHooks: topCounts(competitors.flatMap((c) => Object.values(c.ads ?? {}).flatMap((a) => a?.hooks ?? [])), 10).map((x) => x.value),
    commonOffers: topCounts(competitors.flatMap((c) => [...Object.values(c.ads ?? {}).flatMap((a) => (a?.offers ?? []).map((o) => o.replace(/\s\(\d+\)$/, ""))), ...(c.profile?.offers ?? [])]), 8).map((x) => x.value),
    commonCtas: topCounts(competitors.flatMap((c) => [...Object.values(c.ads ?? {}).flatMap((a) => (a?.ctas ?? []).map((o) => o.replace(/\s\(\d+\)$/, ""))), ...(c.profile?.ctas ?? [])]), 8).map((x) => x.value),
    postingCadence: cad.length ? `Competitors post ${Math.min(...cad)}–${Math.max(...cad)} times a week on Instagram (avg ${Math.round((cad.reduce((a, b) => a + b, 0) / cad.length) * 10) / 10})` : "Instagram cadence unknown",
  };
}
