// Marketing research endpoints (server/src/research/index.ts).
import { request } from "./api";
import type { AdPlatform, Brand, ResearchJob, ResearchOptions, ResearchReport } from "./types";

export type ResearchHome = {
  job?: ResearchJob;
  reports: { id: string; createdAt: string; website: string; llm: string; costUsd?: number; competitors: number; adsTotal: number }[];
  defaults: { website: string; country: string; competitorCount: number; platforms: AdPlatform[]; social: boolean };
  apify: boolean;
  llm: "api" | "subscription" | "none";
  watch: boolean;
  lastReportId?: string;
};

export const researchApi = {
  home: (brandId: string) => request<ResearchHome>("GET", `/api/brands/${brandId}/research`),
  start: (brandId: string, o: Partial<ResearchOptions>) => request<ResearchJob>("POST", `/api/brands/${brandId}/research`, o),
  estimate: (brandId: string, o: Partial<ResearchOptions>) => request<{ usd: number; lines: string[] }>("POST", `/api/brands/${brandId}/research/estimate`, o),
  setWatch: (brandId: string, watch: boolean) => request<{ watch: boolean }>("PATCH", `/api/brands/${brandId}/research`, { watch }),
  job: (jobId: string) => request<ResearchJob>("GET", `/api/research/jobs/${jobId}`),
  report: (id: string) => request<ResearchReport>("GET", `/api/research/reports/${id}`),
  remove: (id: string) => request<{ ok: true }>("DELETE", `/api/research/reports/${id}`),
  apply: (id: string) => request<Brand>("POST", `/api/research/reports/${id}/apply`, {}),
  apify: () => request<{ ok: boolean; username?: string; plan?: string; message?: string }>("GET", `/api/research/apify`),
  markdownUrl: (id: string) => `/api/research/reports/${id}?format=md`,
};
