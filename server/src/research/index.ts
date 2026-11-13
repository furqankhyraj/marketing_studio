// Marketing research: website → competitors → their Instagram + ads → strategy report. Job runner, storage and
// routes. See CONTRACTS.md "Research". Registered from server/src/index.ts via registerResearchRoutes(app).
import { nanoid } from "nanoid";
import type { Express, Request } from "express";
import type { AdCreative, AdPlatform, Brand, Competitor, ResearchJob, ResearchOptions, ResearchReport, ResearchStep } from "../../../shared/types.ts";
import * as db from "../db.ts";
import { nowIso } from "../config.ts";
import { ensureBrain } from "../brain.ts";
import { llmMode } from "../llm.ts";
import { PRICES, apifyAvailable, apifyWhoAmI } from "./apify.ts";
import { discoverCompetitors, planKeywords, siteKind, etsyShopFromUrl } from "./discover.ts";
import { instagramProfiles, profileCompetitor, socialsFromHtml } from "./profile.ts";
import { collectAds, summarizeAds } from "./ads.ts";
import type { CompetitorSocial } from "../../../shared/types.ts";
import { landscapeFrom, synthesizeStrategy } from "./strategy.ts";
import { domainOf, normalizeSite, uniq, UA } from "./util.ts";

const httpErr = (status: number, msg: string) => Object.assign(new Error(msg), { status });

// ================================================================ storage
db.db.exec(`
CREATE TABLE IF NOT EXISTS research_jobs (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, status TEXT, data TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS research_reports (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_research_jobs_brand ON research_jobs(brand_id);
CREATE INDEX IF NOT EXISTS idx_research_reports_brand ON research_reports(brand_id);
`);
type Row = { data: string };
export function getJob(id: string): ResearchJob | undefined {
  const r = db.db.prepare("SELECT data FROM research_jobs WHERE id = ?").get(id) as Row | undefined;
  return r ? JSON.parse(r.data) : undefined;
}
function saveJob(j: ResearchJob) {
  db.db.prepare("INSERT OR REPLACE INTO research_jobs(id, brand_id, status, data, created_at) VALUES(?, ?, ?, ?, ?)").run(j.id, j.brandId, j.status, JSON.stringify(j), j.startedAt);
}
export function latestJob(brandId: string): ResearchJob | undefined {
  const r = db.db.prepare("SELECT data FROM research_jobs WHERE brand_id = ? ORDER BY created_at DESC LIMIT 1").get(brandId) as Row | undefined;
  return r ? JSON.parse(r.data) : undefined;
}
export function getReport(id: string): ResearchReport | undefined {
  const r = db.db.prepare("SELECT data FROM research_reports WHERE id = ?").get(id) as Row | undefined;
  return r ? JSON.parse(r.data) : undefined;
}
function saveReport(rep: ResearchReport) {
  db.db.prepare("INSERT OR REPLACE INTO research_reports(id, brand_id, data, created_at) VALUES(?, ?, ?, ?)").run(rep.id, rep.brandId, JSON.stringify(rep), rep.createdAt);
}
export function listReports(brandId: string): Pick<ResearchReport, "id" | "createdAt" | "website" | "llm" | "costUsd">[] & { competitors: number; adsTotal: number }[] {
  return (db.db.prepare("SELECT data FROM research_reports WHERE brand_id = ? ORDER BY created_at DESC LIMIT 20").all(brandId) as Row[]).map((r) => {
    const x = JSON.parse(r.data) as ResearchReport;
    return { id: x.id, createdAt: x.createdAt, website: x.website, llm: x.llm, costUsd: x.costUsd, competitors: x.competitors.length, adsTotal: x.competitors.reduce((n, c) => n + c.adsTotal, 0) };
  }) as any;
}
export function deleteReport(id: string) {
  db.db.prepare("DELETE FROM research_reports WHERE id = ?").run(id);
}

// ================================================================ options
export function normalizeOptions(brand: Brand, body: any): ResearchOptions {
  const website = normalizeSite(String(body?.website ?? defaultWebsite(brand) ?? "").trim());
  if (!website) throw httpErr(400, "Give a website (or set the brand's website / Etsy shop / Play Store link)");
  const platforms = (Array.isArray(body?.platforms) ? body.platforms : ["meta", "google", "tiktok"]).filter((p: any) => ["meta", "google", "tiktok"].includes(p)) as AdPlatform[];
  return {
    website,
    country: String(body?.country ?? "US").toUpperCase().slice(0, 3) || "US",
    competitorCount: Math.max(2, Math.min(12, Number(body?.competitorCount) || 6)),
    platforms,
    social: body?.social !== false,
    include: Array.isArray(body?.include) ? body.include.map(String).filter(Boolean).slice(0, 12) : [],
    exclude: Array.isArray(body?.exclude) ? body.exclude.map(String).filter(Boolean).slice(0, 20) : [],
    maxAdsPerCompetitor: Math.max(10, Math.min(200, Number(body?.maxAdsPerCompetitor) || 60)),
  };
}
export function defaultWebsite(b: Brand): string | undefined {
  if (b.playStore?.url) return b.playStore.url;
  if (b.etsyShop) return `https://www.etsy.com/shop/${b.etsyShop}`;
  return b.website;
}
export function estimateCost(o: ResearchOptions): { usd: number; lines: string[] } {
  const n = o.competitorCount ?? 6;
  const per = o.maxAdsPerCompetitor ?? 60;
  const lines: string[] = [`Google search: ~8 pages ≈ $${(8 * PRICES.serpPage).toFixed(2)}`];
  let usd = 8 * PRICES.serpPage;
  if (o.social) {
    lines.push(`Instagram profiles: ${n + 1} ≈ $${((n + 1) * PRICES.igProfile).toFixed(2)}`);
    usd += (n + 1) * PRICES.igProfile;
  }
  if (o.platforms?.includes("meta")) {
    lines.push(`Meta Ad Library: up to ${per * (n + 1)} ads ≈ $${(per * (n + 1) * PRICES.metaAd).toFixed(2)}`);
    usd += per * (n + 1) * PRICES.metaAd;
  }
  if (o.platforms?.includes("google")) {
    lines.push(`Google Ads: up to ${per * n} ads ≈ $${(per * n * PRICES.googleAd).toFixed(2)}`);
    usd += per * n * PRICES.googleAd;
  }
  if (o.platforms?.includes("tiktok")) {
    lines.push(`TikTok Ads: ${n} searches ≈ $${(n * (0.01 + 20 * PRICES.tiktokAd)).toFixed(2)}`);
    usd += n * (0.01 + 20 * PRICES.tiktokAd);
  }
  return { usd: Math.round(usd * 100) / 100, lines };
}

// ================================================================ runner
const running = new Map<string, Promise<void>>();

export function startResearch(brandId: string, body: any): ResearchJob {
  const brand = db.getBrand(brandId);
  if (!brand) throw httpErr(404, "Brand not found");
  const cur = latestJob(brandId);
  if (cur && (cur.status === "running" || cur.status === "queued") && running.has(cur.id)) throw httpErr(409, "Research is already running for this brand");
  const options = normalizeOptions(brand, body);
  const job: ResearchJob = { id: nanoid(12), brandId, status: "queued", step: "intake", progress: 0, log: [], options, startedAt: nowIso() };
  saveJob(job);
  const p = runJob(job.id).catch((e) => console.error("[research] job crashed", e));
  running.set(job.id, p);
  p.finally(() => running.delete(job.id));
  return job;
}

const STEP_PROGRESS: Record<ResearchStep, number> = { intake: 0.03, keywords: 0.08, discover: 0.2, profile: 0.35, social: 0.5, ads: 0.75, analyze: 0.85, strategy: 0.95, done: 1 };

async function runJob(jobId: string) {
  let job = getJob(jobId)!;
  const log = (text: string) => {
    job.log.push({ at: nowIso(), text });
    if (job.log.length > 80) job.log.shift();
    saveJob(job);
    console.log(`[research] ${text}`);
  };
  const step = (s: ResearchStep) => {
    job.step = s;
    job.progress = STEP_PROGRESS[s];
    job.status = s === "done" ? "done" : "running";
    saveJob(job);
  };
  let cost = 0;
  const onCost = (usd: number) => {
    cost += usd || 0;
    job.costUsd = Math.round(cost * 1000) / 1000;
  };
  try {
    const brand = db.getBrand(job.brandId)!;
    const brain = ensureBrain(brand);
    const o = job.options;
    step("intake");
    const kind = siteKind(o.website);
    log(`Researching ${o.website} (${kind})${apifyAvailable() ? "" : " — no Apify token: search, Instagram and ad libraries are skipped"}`);

    step("keywords");
    const plan = await planKeywords(brand, brain, o.website, kind);
    log(`Category "${plan.category}" · ${plan.queries.length} search intents · ${plan.seeds.length} known competitors`);

    step("discover");
    const { competitors, serp } = await discoverCompetitors({ brand, brain, website: o.website, kind, plan, country: o.country!, count: o.competitorCount!, include: o.include!, exclude: o.exclude!, log, onCost });

    step("profile");
    await Promise.all(competitors.map(async (c) => void (c.profile = await profileCompetitor(c))));
    log(`Profiled ${competitors.filter((c) => c.profile && !c.profile.error).length}/${competitors.length} competitor sites`);

    // brand's own snapshot
    const ownSocials: Record<string, string> = {};
    if (brand.instagramHandle) ownSocials.instagram = brand.instagramHandle;
    try {
      if (kind === "brand") {
        const html = await fetch(o.website, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
        Object.assign(ownSocials, Object.fromEntries(Object.entries(socialsFromHtml(html)).filter(([k]) => !ownSocials[k])));
      }
    } catch {
      /* ignore */
    }

    step("social");
    let socialMap = new Map<string, Awaited<ReturnType<typeof instagramProfiles>> extends Map<string, infer V> ? V : never>();
    if (o.social) {
      const names = uniq([...competitors.map((c) => c.profile?.socials?.instagram).filter((x): x is string => !!x), ...(ownSocials.instagram ? [ownSocials.instagram] : []), ...competitors.filter((c) => c.website.includes("instagram.com/")).map((c) => c.website.split("instagram.com/")[1].replace(/\/.*$/, ""))]);
      socialMap = await instagramProfiles(job.brandId, names, onCost, log);
      for (const c of competitors) {
        const u = (c.profile?.socials?.instagram ?? (c.website.includes("instagram.com/") ? c.website.split("instagram.com/")[1].replace(/\/.*$/, "") : undefined))?.toLowerCase();
        if (u && socialMap.has(u)) c.social = socialMap.get(u);
      }
    }

    step("ads");
    const allAds: AdCreative[] = await collectAds({ competitors, platforms: o.platforms!, country: o.country!, maxPer: o.maxAdsPerCompetitor!, log, onCost });
    // the brand's own ads (so the report can say "you run 0, they run 40")
    const ownAds: Partial<Record<AdPlatform, ReturnType<typeof summarizeAds>>> = {};
    if (apifyAvailable() && o.platforms?.includes("meta")) {
      try {
        const self: Competitor = { id: "self", name: brand.name, website: o.website, domain: domainOf(o.website), kind, source: "manual", relevance: 1, adsTotal: 0, adsActive: 0, profile: { products: [], prices: [], offers: [], ctas: [], keywords: [], colors: [], socials: { facebook: ownSocials.facebook }, pages: 0 } };
        await collectAds({ competitors: [self], platforms: ["meta"], country: o.country!, maxPer: 40, log: () => undefined, onCost });
        if (self.ads?.meta) ownAds.meta = self.ads.meta;
      } catch {
        /* ignore */
      }
    }

    step("analyze");
    competitors.sort((a, b) => b.relevance - a.relevance || b.adsTotal - a.adsTotal);
    const landscape = landscapeFrom(competitors, allAds, serp);
    const partial: Omit<ResearchReport, "strategy" | "id" | "jobId" | "createdAt" | "llm"> = {
      brandId: job.brandId,
      website: o.website,
      options: o,
      brandSnapshot: {
        name: brand.name,
        summary: brain.summary,
        products: brain.products.slice(0, 10),
        audience: brain.audience,
        keywords: brain.keywords.slice(0, 12),
        socials: ownSocials,
        social: ownSocials.instagram ? socialMap.get(ownSocials.instagram.toLowerCase()) : undefined,
        ads: ownAds,
        adsTotal: Object.values(ownAds).reduce((n, a) => n + (a?.total ?? 0), 0),
      },
      keywords: plan.queries,
      competitors,
      landscape,
      costUsd: job.costUsd,
    };

    step("strategy");
    const { strategy, llm } = await synthesizeStrategy(brand, brain, partial, log);

    const report: ResearchReport = { ...partial, id: nanoid(12), jobId: job.id, createdAt: nowIso(), strategy, llm, costUsd: job.costUsd };
    saveReport(report);
    db.updateBrand(job.brandId, (b) => void (b.research = { ...(b.research ?? {}), lastReportId: report.id, lastRunAt: report.createdAt }));
    job.reportId = report.id;
    job.finishedAt = nowIso();
    step("done");
    log(`Done: ${competitors.length} competitors, ${allAds.length} ads, strategy by ${llm === "none" ? "rules" : "Claude"}${job.costUsd ? ` · Apify ≈ $${job.costUsd.toFixed(2)}` : ""}`);
  } catch (e: any) {
    job = getJob(jobId) ?? job;
    job.status = "failed";
    job.error = String(e?.message ?? e);
    job.finishedAt = nowIso();
    saveJob(job);
    console.error("[research] failed:", e);
  }
}

/**
 * Attach findings gathered by hand or by Claude (ads seen in the ad libraries, Instagram numbers) to a report,
 * recompute the summaries and landscape, and rewrite the strategy. Body:
 * { competitors: [{ name | id, website?, ads?: { meta?: AdCreative[], google?: AdCreative[], tiktok?: AdCreative[] }, social?: Partial<CompetitorSocial>, note? }], brandAds?: {...}, rewrite?: boolean }
 */
export async function attachFindings(reportId: string, body: any): Promise<ResearchReport> {
  const rep = getReport(reportId);
  if (!rep) throw httpErr(404, "Report not found");
  const brand = db.getBrand(rep.brandId);
  if (!brand) throw httpErr(404, "Brand not found");
  const list: any[] = Array.isArray(body?.competitors) ? body.competitors : [];
  const adsOf = (raw: any, platform: AdPlatform, advertiser: string): AdCreative[] =>
    (Array.isArray(raw) ? raw : []).map((a: any, i: number) => ({
      id: String(a?.id ?? `${platform}-${advertiser}-${i}`),
      platform,
      advertiser: String(a?.advertiser ?? advertiser),
      headline: a?.headline ? String(a.headline).slice(0, 300) : undefined,
      body: a?.body ? String(a.body).slice(0, 1500) : undefined,
      cta: a?.cta ? String(a.cta).slice(0, 60) : undefined,
      link: a?.link ? String(a.link).slice(0, 500) : undefined,
      landingDomain: a?.link ? domainOf(String(a.link)) : undefined,
      format: ["image", "video", "carousel", "text"].includes(a?.format) ? a.format : "unknown",
      imageUrl: a?.imageUrl ? String(a.imageUrl) : undefined,
      previewUrl: a?.previewUrl ?? a?.imageUrl ? String(a.previewUrl ?? a.imageUrl) : undefined,
      startDate: a?.startDate ? String(a.startDate).slice(0, 10) : undefined,
      endDate: a?.endDate ? String(a.endDate).slice(0, 10) : undefined,
      active: typeof a?.active === "boolean" ? a.active : !a?.endDate,
      daysRunning: Number.isFinite(Number(a?.daysRunning)) ? Number(a.daysRunning) : a?.startDate ? Math.max(0, Math.round((Date.now() - Date.parse(String(a.startDate))) / 86400_000)) : undefined,
      surfaces: Array.isArray(a?.surfaces) ? a.surfaces.map(String) : undefined,
      reach: Number(a?.reach) || undefined,
      countries: Array.isArray(a?.countries) ? a.countries.map(String) : undefined,
    }));
  const allAds: AdCreative[] = [];
  for (const item of list) {
    let c = rep.competitors.find((x) => (item.id && x.id === item.id) || (item.name && x.name.toLowerCase() === String(item.name).toLowerCase()) || (item.website && domainOf(x.website) === domainOf(String(item.website))));
    if (!c) {
      if (!item.name) continue;
      const website = normalizeSite(String(item.website ?? ""));
      c = { id: nanoid(10), name: String(item.name).slice(0, 80), website, domain: domainOf(website), kind: siteKind(website), source: "manual", relevance: 0.7, adsTotal: 0, adsActive: 0, why: item.note ? String(item.note) : "Added by hand" };
      rep.competitors.push(c);
    } else if (item.note) c.why = [c.why, String(item.note)].filter(Boolean).join(" · ").slice(0, 400);
    if (item.ads && typeof item.ads === "object") {
      c.ads ??= {};
      for (const p of ["meta", "google", "tiktok"] as AdPlatform[]) {
        if (!(p in item.ads)) continue;
        const ads = adsOf(item.ads[p], p, c.name);
        const total = Number.isFinite(Number(item.ads[`${p}Total`])) ? Number(item.ads[`${p}Total`]) : ads.length;
        const sum = summarizeAds(p, ads);
        c.ads[p] = { ...sum, total: Math.max(total, sum.total), active: Number.isFinite(Number(item.ads[`${p}Active`])) ? Number(item.ads[`${p}Active`]) : sum.active, error: undefined };
        allAds.push(...ads);
      }
      c.adsTotal = Object.values(c.ads).reduce((n, a) => n + (a?.total ?? 0), 0);
      c.adsActive = Object.values(c.ads).reduce((n, a) => n + (a?.active ?? 0), 0);
    }
    if (item.social && typeof item.social === "object") {
      const so = item.social as Partial<CompetitorSocial>;
      const username = String(so.username ?? c.social?.username ?? "").replace(/^@/, "");
      c.social = { platform: "instagram", username, url: `https://www.instagram.com/${username}/`, ...(c.social ?? {}), ...so, error: undefined } as CompetitorSocial;
    }
  }
  if (body?.brandAds && typeof body.brandAds === "object") {
    rep.brandSnapshot.ads ??= {};
    for (const p of ["meta", "google", "tiktok"] as AdPlatform[]) if (p in body.brandAds) rep.brandSnapshot.ads[p] = summarizeAds(p, adsOf(body.brandAds[p], p, brand.name));
    rep.brandSnapshot.adsTotal = Object.values(rep.brandSnapshot.ads).reduce((n, a) => n + (a?.total ?? 0), 0);
  }
  if (body?.brandSocial && typeof body.brandSocial === "object") rep.brandSnapshot.social = { platform: "instagram", url: "", username: "", ...(rep.brandSnapshot.social ?? {}), ...body.brandSocial } as CompetitorSocial;
  // every ad already stored on the report counts for the landscape, not only the ones added now
  const existing = rep.competitors.flatMap((c) => Object.values(c.ads ?? {}).flatMap((a) => (a ? [...a.samples, ...a.longestRunning] : [])));
  const seen = new Set<string>();
  const forLandscape = [...allAds, ...existing].filter((a) => (seen.has(`${a.platform}:${a.id}`) ? false : (seen.add(`${a.platform}:${a.id}`), true)));
  rep.landscape = landscapeFrom(rep.competitors, forLandscape, rep.landscape.serp);
  if (body?.rewrite !== false) {
    const brain = ensureBrain(brand);
    const { strategy, llm } = await synthesizeStrategy(brand, brain, rep, () => undefined);
    rep.strategy = strategy;
    rep.llm = llm;
  }
  saveReport(rep);
  return rep;
}

/** Merge a report into the brand brain: competitors, keywords, claims to avoid, pillars, CTAs (user edits kept). */
export function applyReport(reportId: string): Brand {
  const rep = getReport(reportId);
  if (!rep) throw httpErr(404, "Report not found");
  const b = db.updateBrand(rep.brandId, (x) => {
    const brain = ensureBrain(x);
    const s = rep.strategy;
    brain.competitors = uniq([...(brain.competitors ?? []), ...rep.competitors.map((c) => c.name)]).slice(0, 20);
    brain.keywords = uniq([...brain.keywords, ...s.seo.keywords.map((k) => k.replace(/^#/, "").toLowerCase())]).slice(0, 30);
    brain.contentPillars = uniq([...s.content.pillars.map((p) => p.name), ...brain.contentPillars]).slice(0, 8);
    brain.claimsToAvoid = uniq([...brain.claimsToAvoid, ...s.messaging.claimsToAvoid]).slice(0, 12);
    brain.ctas = uniq([...s.messaging.ctas, ...brain.ctas]).slice(0, 8);
    brain.differentiators = uniq([...s.positioning.differentiators, ...brain.differentiators]).slice(0, 8);
    x.brain = brain;
    x.research = { ...(x.research ?? {}), lastReportId: rep.id, lastRunAt: rep.createdAt };
  });
  if (!b) throw httpErr(404, "Brand not found");
  return b;
}

/** Plain-text/markdown version for chat, MCP and copy-paste. */
export function reportMarkdown(rep: ResearchReport): string {
  const s = rep.strategy;
  const L: string[] = [];
  L.push(`# Marketing research: ${rep.brandSnapshot.name}`, `${rep.website} · ${rep.createdAt.slice(0, 10)} · ${rep.competitors.length} competitors${rep.costUsd ? ` · Apify ≈ $${rep.costUsd.toFixed(2)}` : ""}`, "", "## Summary", s.summary, "", "## Positioning", s.positioning.statement, "", "**Differentiators:** " + s.positioning.differentiators.join("; "), "**Gaps vs competitors:** " + s.positioning.gaps.join("; "), "");
  L.push("## Competitors");
  for (const c of rep.competitors) {
    const ig = c.social ? ` · IG ${c.social.followers?.toLocaleString() ?? "?"} followers, ${c.social.postsPerWeek ?? "?"}/wk, ${c.social.engagementRate ?? "?"}% eng.` : "";
    const ads = Object.values(c.ads ?? {}).filter((a): a is NonNullable<typeof a> => !!a).map((a) => `${a.platform} ${a.total} (${a.active} active)`).join(", ");
    L.push(`- **${c.name}** — ${c.website}${c.why ? ` — ${c.why}` : ""}${ig}${ads ? ` · Ads: ${ads}` : " · Ads: none found"}`);
    for (const a of Object.values(c.ads ?? {}).filter((a): a is NonNullable<typeof a> => !!a)) for (const w of a.longestRunning.slice(0, 2)) L.push(`  - ${a.platform} winner (${w.daysRunning ?? "?"} days): "${(w.body || w.headline || "").slice(0, 120)}"${w.cta ? ` → ${w.cta}` : ""}`);
  }
  L.push("", "## Messaging", "**Hooks:**", ...s.messaging.hooks.map((h) => `- ${h}`), "**Offers:** " + s.messaging.offers.join("; "), "**CTAs:** " + s.messaging.ctas.join("; "), "", "## Content", s.content.cadence, ...s.content.pillars.map((p) => `- **${p.name}** — ${p.why} (${p.formats.join(", ")})`), "", "### 30-day plan", ...s.content.plan30.map((p) => `- Day ${p.day} · ${p.type} · ${p.pillar}: ${p.hook}`), "");
  L.push("## Ads", `${s.ads.recommended ? "Recommended" : "Not yet"} — ${s.ads.why}`, ...s.ads.channels.map((c) => `- ${c.platform} ${c.budgetShare}%: ${c.why}`), "", ...s.ads.concepts.map((c) => `- **${c.name}** (${c.format}): ${c.hook} — ${c.angle} → ${c.cta}`), "", "**Test plan:** " + s.ads.testPlan.join(" → "), "", "## SEO keywords", s.seo.keywords.join(", "), "", "## Quick wins", ...s.quickWins.map((q) => `- ${q}`), "", "## KPIs", ...s.kpis.map((k) => `- ${k.name}: ${k.target}`));
  if (s.risks.length) L.push("", "## Risks", ...s.risks.map((r) => `- ${r}`));
  return L.join("\n");
}

// ================================================================ worker: weekly refresh for brands with research.watch
export function startResearchWorker() {
  const tick = async () => {
    for (const b of db.listBrands()) {
      if (!b.research?.watch) continue;
      const last = b.research.lastRunAt ? Date.parse(b.research.lastRunAt) : 0;
      if (Date.now() - last < 7 * 86400_000) continue;
      const cur = latestJob(b.id);
      if (cur && running.has(cur.id)) continue;
      try {
        startResearch(b.id, {});
      } catch (e: any) {
        console.warn(`[research] weekly refresh for ${b.name}: ${e?.message ?? e}`);
      }
    }
  };
  setTimeout(() => void tick(), 90_000);
  setInterval(() => void tick(), 6 * 3600_000);
  // mark jobs interrupted by a restart
  for (const r of db.db.prepare("SELECT data FROM research_jobs WHERE status IN ('queued','running')").all() as Row[]) {
    const j = JSON.parse(r.data) as ResearchJob;
    j.status = "failed";
    j.error = "Server restarted during the run";
    saveJob(j);
  }
}

// ================================================================ routes
export function registerResearchRoutes(app: Express) {
  const brandId = (req: Request) => {
    const id = String(req.params.id);
    if (!db.getBrand(id)) throw httpErr(404, "Brand not found");
    return id;
  };
  app.get("/api/brands/:id/research", (req, res) => {
    const b = db.getBrand(brandId(req))!;
    const job = latestJob(b.id);
    res.json({ job, reports: listReports(b.id), defaults: { website: defaultWebsite(b) ?? "", country: "US", competitorCount: 6, platforms: ["meta", "google", "tiktok"], social: true }, apify: apifyAvailable(), llm: llmMode() ?? "none", watch: !!b.research?.watch, lastReportId: b.research?.lastReportId });
  });
  app.post("/api/brands/:id/research", (req, res) => res.json(startResearch(brandId(req), req.body ?? {})));
  app.post("/api/brands/:id/research/estimate", (req, res) => {
    const b = db.getBrand(brandId(req))!;
    res.json(estimateCost(normalizeOptions(b, req.body ?? {})));
  });
  app.patch("/api/brands/:id/research", (req, res) => {
    const b = db.updateBrand(brandId(req), (x) => {
      if (typeof req.body?.watch === "boolean") x.research = { ...(x.research ?? {}), watch: req.body.watch };
    });
    res.json({ watch: !!b?.research?.watch });
  });
  app.get("/api/research/jobs/:jobId", (req, res) => {
    const j = getJob(String(req.params.jobId));
    if (!j) throw httpErr(404, "Job not found");
    res.json(j);
  });
  app.get("/api/research/reports/:reportId", (req, res) => {
    const r = getReport(String(req.params.reportId));
    if (!r) throw httpErr(404, "Report not found");
    if (req.query.format === "md") return res.type("text/markdown").send(reportMarkdown(r));
    res.json(r);
  });
  app.delete("/api/research/reports/:reportId", (req, res) => {
    deleteReport(String(req.params.reportId));
    res.json({ ok: true });
  });
  app.post("/api/research/reports/:reportId/apply", (req, res) => res.json(applyReport(String(req.params.reportId))));
  app.post("/api/research/reports/:reportId/findings", async (req, res) => res.json(await attachFindings(String(req.params.reportId), req.body ?? {})));
  app.get("/api/research/apify", async (_req, res) => {
    if (!apifyAvailable()) return res.json({ ok: false, message: "No Apify token set" });
    try {
      res.json({ ok: true, ...(await apifyWhoAmI()) });
    } catch (e: any) {
      res.json({ ok: false, message: String(e?.message ?? e) });
    }
  });
}
