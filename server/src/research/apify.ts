// Apify client for the research module: runs public Store actors (Meta Ad Library, Google Ads Transparency,
// TikTok Ad Library, Instagram profiles, Google search) with the owner's Apify token and returns dataset items.
// All actors are pay-per-result; a full six-competitor run is about $1. No token → every call throws ApifyError
// and the pipeline falls back to what it can do without (site scraping + LLM).
import { getSetting } from "../db.ts";

export class ApifyError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

export const ACTORS = {
  metaAds: "curious_coder~facebook-ads-library-scraper",
  googleAds: "scrapesage~google-ads-transparency-scraper",
  tiktokAds: "lexis-solutions~tiktok-ads-scraper",
  igProfile: "apify~instagram-profile-scraper",
  serp: "apify~google-search-scraper",
} as const;

/** Rough per-item prices (USD) for the cost estimate shown before a run. */
export const PRICES = { metaAd: 0.00075, googleAd: 0.002 + 0.002, tiktokAd: 0.0005, igProfile: 0.0026, serpPage: 0.0045 };

export const apifyToken = (): string | undefined => getSetting("apifyToken") || process.env.APIFY_TOKEN || undefined;
export const apifyAvailable = () => !!apifyToken();

const BASE = "https://api.apify.com/v2";

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = apifyToken();
  if (!token) throw new ApifyError("No Apify token set (Settings → Research). Ad libraries, Instagram profiles and Google search need it.", 400);
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let data: any = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.error?.message || (typeof data === "string" ? data.slice(0, 300) : res.statusText);
    throw new ApifyError(`Apify ${res.status}: ${msg}`, res.status === 401 ? 401 : 502);
  }
  return data as T;
}

export interface RunResult<T> {
  items: T[];
  costUsd: number;
  runId: string;
  status: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Start an actor run, wait for it (polling), then read its dataset. `timeoutSec` caps the actor run on Apify's side.
 * Never throws on an actor that finished with no items; throws ApifyError on auth, quota or run failure.
 */
export async function runActor<T = any>(
  actorId: string,
  input: Record<string, unknown>,
  opts: { timeoutSec?: number; maxItems?: number; memoryMb?: number; onStatus?: (s: string) => void } = {},
): Promise<RunResult<T>> {
  const timeoutSec = opts.timeoutSec ?? 420;
  const memory = opts.memoryMb ?? 1024;
  const start = await api<{ data: { id: string; defaultDatasetId: string; status: string } }>(
    `/acts/${actorId}/runs?timeout=${timeoutSec}&memory=${memory}`,
    { method: "POST", body: JSON.stringify(input) },
  );
  const runId = start.data.id;
  const datasetId = start.data.defaultDatasetId;
  const deadline = Date.now() + (timeoutSec + 90) * 1000;
  let status = start.data.status;
  let usage = 0;
  while (Date.now() < deadline) {
    await sleep(status === "READY" ? 2000 : 5000);
    const r = await api<{ data: { status: string; usageTotalUsd?: number; statusMessage?: string } }>(`/actor-runs/${runId}`);
    status = r.data.status;
    usage = Number(r.data.usageTotalUsd ?? 0) || 0;
    opts.onStatus?.(`${status}${r.data.statusMessage ? ` — ${r.data.statusMessage}` : ""}`);
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) break;
  }
  if (status === "FAILED" || status === "ABORTED") {
    // still read whatever landed in the dataset — partial data beats none
    const items = await readDataset<T>(datasetId, opts.maxItems).catch(() => []);
    if (!items.length) throw new ApifyError(`Apify actor ${actorId} ${status.toLowerCase()}`, 502);
    return { items, costUsd: usage, runId, status };
  }
  const items = await readDataset<T>(datasetId, opts.maxItems);
  return { items, costUsd: usage, runId, status };
}

export async function readDataset<T = any>(datasetId: string, limit?: number): Promise<T[]> {
  const out: T[] = [];
  const page = 500;
  for (let offset = 0; ; offset += page) {
    const n = limit ? Math.min(page, limit - out.length) : page;
    if (n <= 0) break;
    const items = await api<T[]>(`/datasets/${datasetId}/items?clean=true&format=json&offset=${offset}&limit=${n}`);
    out.push(...items);
    if (items.length < n) break;
  }
  return out;
}

/** Quick credential check: GET /users/me. */
export async function apifyWhoAmI(): Promise<{ username: string; plan?: string; usageUsd?: number }> {
  const r = await api<{ data: any }>("/users/me");
  const d = r.data ?? {};
  return { username: d.username ?? d.email ?? "?", plan: d.plan?.id ?? d.plan?.tier, usageUsd: d.plan?.monthlyUsageCreditsUsd };
}
