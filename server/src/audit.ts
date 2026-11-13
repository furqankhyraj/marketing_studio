// Growth audit: LLM (or heuristic) review of the brand + Instagram insights when connected.
import { nanoid } from "nanoid";
import type { Audit, Brand } from "../../shared/types.ts";
import { nowIso } from "./config.ts";
import { saveAudit, getIgCreds } from "./db.ts";
import { ensureBrain } from "./brain.ts";
import { askJson, llmAvailable } from "./llm.ts";
import { getInsights, type Insights } from "./instagram.ts";

const AUDIT_SYSTEM = `You are an Instagram growth strategist. Audit this brand's Instagram presence and content strategy.
Return JSON: {"summary": string (2-3 sentences), "strengths": string[] (3-5, "what your account does well"),
"weaknesses": string[] (3-5, "what holds it back"), "opportunities": string[] (3-5),
"firstReels": [{"title": string, "hook": string, "why": string}] (exactly 3, the first reels we will make)}.
Be concrete and specific to this business. If Instagram data is missing, base the audit on the brand brain and say so briefly.`;

function heuristicAudit(brand: Brand, ins?: Insights): Omit<Audit, "id" | "brandId" | "createdAt"> {
  const b = ensureBrain(brand);
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const opportunities: string[] = [];
  if (b.differentiators.length) strengths.push(`Clear differentiators: ${b.differentiators.slice(0, 2).join(", ")}`);
  if (b.products.length) strengths.push(`A concrete offer to show: ${b.products.slice(0, 3).join(", ")}`);
  strengths.push(`A recognisable visual identity (primary ${b.colors.primary})`);
  if (ins) {
    const recent = ins.recent;
    const avgLikes = recent.length ? Math.round(recent.reduce((s, r) => s + (r.likeCount ?? 0), 0) / recent.length) : 0;
    const avgComments = recent.length ? Math.round(recent.reduce((s, r) => s + (r.commentsCount ?? 0), 0) / recent.length) : 0;
    if (ins.followers !== undefined) strengths.push(`${ins.followers} followers to build on`);
    if (recent.length >= 2) {
      const days = (Date.parse(recent[0].timestamp) - Date.parse(recent[recent.length - 1].timestamp)) / 86400000;
      const perWeek = days > 0 ? (recent.length / days) * 7 : recent.length;
      if (perWeek < 3) weaknesses.push(`Posting about ${perWeek.toFixed(1)}x/week — the algorithm rewards 3–5 reels a week`);
      else strengths.push(`Consistent posting (~${perWeek.toFixed(1)}x/week)`);
    } else weaknesses.push("Very few recent posts — the account looks inactive to new visitors");
    if (avgComments < 3) weaknesses.push(`Low conversation (avg ${avgComments} comments) — posts don't ask viewers to do anything`);
    if (ins.followers && avgLikes / Math.max(1, ins.followers) < 0.02) weaknesses.push("Engagement under 2% of followers — hooks aren't stopping the scroll");
  } else {
    weaknesses.push("Instagram isn't connected yet, so we can't measure reach or engagement");
  }
  weaknesses.push("No comment-keyword automation turning viewers into DMs and sales");
  opportunities.push(`Short reels around your pillars: ${b.contentPillars.slice(0, 3).join(", ")}`);
  opportunities.push(`"Comment a keyword" CTAs → automatic DMs with your link`);
  opportunities.push(`Post at your audience's best times: ${(b.bestTimes ?? []).join(", ")}`);
  opportunities.push("Carousels that teach something people will save and share");
  const p0 = b.products[0] ?? b.niche;
  return {
    summary: `${brand.name}: ${b.summary.slice(0, 220).trim().replace(/[.!?]?$/, (m) => m || ".")} The biggest lever right now is consistent, hook-first reels with a clear keyword CTA.`,
    strengths: strengths.slice(0, 5),
    weaknesses: weaknesses.slice(0, 5),
    opportunities: opportunities.slice(0, 5),
    firstReels: [
      { title: `Why ${brand.name} is different`, hook: `Why people choose ${brand.name}`, why: "Positions the brand and gives new visitors a reason to follow." },
      { title: `Behind the scenes: ${p0}`, hook: `What goes into one ${p0.toLowerCase()}`, why: "Process content builds trust and is highly shareable." },
      { title: `3 mistakes with ${p0}`, hook: `Stop making these 3 mistakes with ${p0.toLowerCase()}`, why: "Mistake/tip formats get saves and comments, which boost reach." },
    ],
  };
}

export async function runAudit(brand: Brand): Promise<Audit> {
  const brain = ensureBrain(brand);
  let ins: Insights | undefined;
  if (getIgCreds(brand.id)) {
    try {
      ins = await getInsights(brand.id);
    } catch (e: any) {
      console.warn("[audit] insights failed:", e?.message ?? e);
    }
  }
  let body = heuristicAudit(brand, ins);
  if (llmAvailable()) {
    try {
      const raw = await askJson<any>(
        AUDIT_SYSTEM,
        JSON.stringify({ brand: { name: brand.name, website: brand.website, instagram: brand.instagramHandle }, brain, instagram: ins ?? null }),
        4000,
      );
      const arr = (v: any, fb: string[]) => (Array.isArray(v) && v.length ? v.map(String).slice(0, 6) : fb);
      body = {
        summary: typeof raw?.summary === "string" && raw.summary ? raw.summary : body.summary,
        strengths: arr(raw?.strengths, body.strengths),
        weaknesses: arr(raw?.weaknesses, body.weaknesses),
        opportunities: arr(raw?.opportunities, body.opportunities),
        firstReels:
          Array.isArray(raw?.firstReels) && raw.firstReels.length
            ? raw.firstReels.slice(0, 3).map((r: any) => ({ title: String(r.title ?? ""), hook: String(r.hook ?? ""), why: String(r.why ?? "") }))
            : body.firstReels,
      };
    } catch (e: any) {
      console.warn("[audit] LLM failed, using heuristic:", e?.message ?? e);
    }
  }
  return saveAudit({ id: nanoid(12), brandId: brand.id, ...body, createdAt: nowIso() });
}
