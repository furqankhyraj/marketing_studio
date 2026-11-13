// Marketing research tools: website → competitors → their Instagram + ad libraries → strategy.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ResearchJob, ResearchReport } from "../../shared/types.ts";
import { get, post, api, sleep } from "./api.ts";
import { ok, safe } from "./format.ts";

const enc = encodeURIComponent;
const brandId = z.string().min(1).describe("Brand id (from list_brands).");

const jobLine = (j: ResearchJob) => `Job ${j.id}: ${j.status} · step ${j.step} (${Math.round(j.progress * 100)}%)${j.costUsd ? ` · Apify ≈ $${j.costUsd.toFixed(2)}` : ""}${j.error ? `\nError: ${j.error}` : ""}\n${j.log.slice(-8).map((l) => `  ${l.at.slice(11, 19)} ${l.text}`).join("\n")}${j.reportId ? `\nReport: ${j.reportId} — read it with research_report` : ""}`;

export function registerResearchTools(server: McpServer) {
  server.registerTool(
    "research_start",
    {
      title: "Research a brand's market: competitors, their ads, strategy",
      description: [
        "Give a website (or Etsy shop / Play Store link) and the studio finds the real competitors (Google search + Claude), profiles their sites, reads their Instagram metrics, pulls their ads from the Meta Ad Library, Google Ads Transparency Center and TikTok Ad Library (how many, how long running, hooks, offers, CTAs), and writes a full strategy: positioning, messaging, 30-day content plan, ad plan, SEO keywords, quick wins, KPIs.",
        "Takes 3-8 minutes. Needs an Apify token in Settings → Research for search, Instagram and ad libraries (≈ $1 per run); without it only Claude's knowledge + site scraping are used. Poll with research_status, then read research_report.",
      ].join(" "),
      inputSchema: {
        brandId,
        website: z.string().optional().describe("Site to research (default: the brand's website / Etsy shop / Play Store listing)."),
        country: z.string().optional().describe("ISO-2 country for search + ad libraries (default US)."),
        competitorCount: z.number().int().min(2).max(12).optional().describe("How many competitors (default 6)."),
        platforms: z.array(z.enum(["meta", "google", "tiktok"])).optional().describe("Ad libraries to read (default all)."),
        include: z.array(z.string()).optional().describe("Competitor sites / @instagram handles to always include."),
        exclude: z.array(z.string()).optional().describe("Domains to skip."),
        wait: z.boolean().optional().describe("Wait for the run to finish (up to 10 min) and return the report summary. Default false."),
      },
    },
    safe(async ({ brandId, wait, ...body }) => {
      const j = await post<ResearchJob>(`/brands/${enc(brandId)}/research`, body);
      if (!wait) return ok(`Started.\n${jobLine(j)}\nCall research_status {jobId: "${j.id}"} in a minute or two.`);
      const deadline = Date.now() + 10 * 60_000;
      let cur = j;
      while (Date.now() < deadline && (cur.status === "queued" || cur.status === "running")) {
        await sleep(8000);
        cur = await get<ResearchJob>(`/research/jobs/${enc(j.id)}`);
      }
      if (cur.status !== "done" || !cur.reportId) return ok(jobLine(cur));
      const md = await api<string>("GET", `/research/reports/${enc(cur.reportId)}`, { query: { format: "md" } });
      return ok(`${jobLine(cur)}\n\n${String(md).slice(0, 20000)}`);
    }),
  );

  server.registerTool(
    "research_status",
    { title: "Research job status", description: "Progress + log of a research run (or the latest run for a brand).", inputSchema: { jobId: z.string().optional(), brandId: brandId.optional() } },
    safe(async ({ jobId, brandId }) => {
      if (jobId) return ok(jobLine(await get<ResearchJob>(`/research/jobs/${enc(jobId)}`)));
      if (!brandId) return ok("Give jobId or brandId.");
      const s = await get<{ job?: ResearchJob; reports: { id: string; createdAt: string; competitors: number; adsTotal: number }[]; apify: boolean; llm: string }>(`/brands/${enc(brandId)}/research`);
      return ok([s.job ? jobLine(s.job) : "No research run yet.", `Apify: ${s.apify ? "connected" : "not set"} · Claude: ${s.llm}`, s.reports.length ? `Reports:\n${s.reports.map((r) => `- ${r.id} · ${r.createdAt.slice(0, 10)} · ${r.competitors} competitors · ${r.adsTotal} ads`).join("\n")}` : ""].filter(Boolean).join("\n"));
    }),
  );

  server.registerTool(
    "research_report",
    {
      title: "Read a research report",
      description: "The full strategy report as markdown (summary, positioning, competitors with their ad counts and winning ads, hooks/offers/CTAs, 30-day plan, ad concepts, SEO, quick wins, KPIs). Omit reportId for the brand's latest.",
      inputSchema: { reportId: z.string().optional(), brandId: brandId.optional(), section: z.enum(["all", "competitors", "strategy", "ads"]).optional().describe("Limit to one part (default all).") },
    },
    safe(async ({ reportId, brandId, section }) => {
      let id = reportId;
      if (!id && brandId) id = (await get<{ lastReportId?: string }>(`/brands/${enc(brandId)}/research`)).lastReportId;
      if (!id) return ok("No report yet — run research_start.");
      if (section === "ads") {
        const r = await get<ResearchReport>(`/research/reports/${enc(id)}`);
        const lines: string[] = [];
        for (const c of r.competitors) for (const a of Object.values(c.ads ?? {})) if (a) for (const ad of a.samples) lines.push(`- ${c.name} · ${a.platform} · ${ad.format}${ad.daysRunning !== undefined ? ` · ${ad.daysRunning}d` : ""}${ad.active ? " · active" : ""}: "${(ad.body || ad.headline || "").slice(0, 160)}"${ad.cta ? ` → ${ad.cta}` : ""}${ad.link ? `\n  ${ad.link}` : ""}`);
        return ok(lines.length ? lines.join("\n") : "No ads found for these competitors.");
      }
      const md = String(await api<string>("GET", `/research/reports/${enc(id)}`, { query: { format: "md" } }));
      if (section === "competitors") return ok(md.split("## Messaging")[0]);
      if (section === "strategy") return ok("# Strategy\n" + md.split("## Messaging").slice(1).join("## Messaging"));
      return ok(md.slice(0, 40000));
    }),
  );

  server.registerTool(
    "research_add_findings",
    {
      title: "Add findings to a research report (by hand or from your own browsing)",
      description: [
        "When Apify isn't available, YOU can do the research: open the Meta Ad Library (facebook.com/ads/library, search_type=keyword_exact_phrase with the competitor's name in quotes, or product phrases), the Google Ads Transparency Center, TikTok Ad Library, Instagram and Etsy shop pages in the browser, then send what you saw here.",
        "Each competitor entry may carry ads per platform (give every ad you saw: body text, headline, cta, link, format, startDate, endDate, active) plus metaTotal/metaActive counts when the page shows more ads than you copied, Instagram numbers (followers, postsPerWeek, engagementRate), and a note (sales, reviews, shop age, what you noticed). New names are added as competitors. The report's landscape and strategy are rewritten from the combined data.",
      ].join(" "),
      inputSchema: {
        reportId: z.string(),
        competitors: z
          .array(
            z.object({
              name: z.string(),
              website: z.string().optional(),
              note: z.string().optional(),
              ads: z
                .object({
                  meta: z.array(z.record(z.string(), z.any())).optional(),
                  metaTotal: z.number().optional(),
                  metaActive: z.number().optional(),
                  google: z.array(z.record(z.string(), z.any())).optional(),
                  googleTotal: z.number().optional(),
                  tiktok: z.array(z.record(z.string(), z.any())).optional(),
                  tiktokTotal: z.number().optional(),
                })
                .optional(),
              social: z.object({ username: z.string().optional(), followers: z.number().optional(), posts: z.number().optional(), postsPerWeek: z.number().optional(), engagementRate: z.number().optional(), bio: z.string().optional() }).optional(),
            }),
          )
          .min(1),
        brandAds: z.object({ meta: z.array(z.record(z.string(), z.any())).optional(), google: z.array(z.record(z.string(), z.any())).optional(), tiktok: z.array(z.record(z.string(), z.any())).optional() }).optional().describe("The brand's OWN ads, if any."),
        rewrite: z.boolean().optional().describe("Rewrite the strategy from the new data (default true)."),
      },
    },
    safe(async ({ reportId, ...body }) => {
      const r = await post<ResearchReport>(`/research/reports/${enc(reportId)}/findings`, body, 600_000);
      const adv = r.competitors.filter((c) => c.adsTotal > 0);
      return ok(`Report updated: ${r.competitors.length} competitors, ${adv.length} advertising (${adv.map((c) => `${c.name}: ${c.adsTotal}`).join(", ")}). Strategy ${body.rewrite === false ? "unchanged" : "rewritten"}.

${r.strategy.summary}`);
    }),
  );

  server.registerTool(
    "research_apply",
    { title: "Apply a report to the Brand Brain", description: "Merge the report's competitors, SEO keywords, content pillars, CTAs, differentiators and claims-to-avoid into the brand brain (user edits are kept). Ask the user first.", inputSchema: { reportId: z.string() } },
    safe(async ({ reportId }) => {
      const b = await post<{ name: string; brain: { contentPillars: string[]; keywords: string[] } }>(`/research/reports/${enc(reportId)}/apply`, {});
      return ok(`Applied to ${b.name}. Pillars: ${b.brain.contentPillars.join(", ")}. Keywords: ${b.brain.keywords.slice(0, 12).join(", ")}.`);
    }),
  );
}
