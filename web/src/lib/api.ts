import type {
  Asset, Audit, Automation, Brand, BrandBrain, CaptionStyleMeta, CommentLog, MusicTrack, Post, PostStatus, PostType, Settings, StyleMeta,
  AutopilotDigest, AutopilotSettings, ImageDesign, PostEvent,
} from "./types";

/** Thrown for any failed API call. `down` = the API server is unreachable. */
export class ApiError extends Error {
  status: number;
  down: boolean;
  constructor(message: string, status = 0, down = false) {
    super(message);
    this.status = status;
    this.down = down;
  }
}

export const SERVER_DOWN_MSG = "Can't reach the API server. Start the server: npm run dev in server/";

/** Dev-only mock toggle: add ?mock=1 to the URL (persists in localStorage), ?mock=0 to turn off. Off by default. */
export function mockEnabled(): boolean {
  try {
    const q = new URLSearchParams(location.search).get("mock");
    if (q === "1") localStorage.setItem("sms-mock", "1");
    if (q === "0") localStorage.removeItem("sms-mock");
    return localStorage.getItem("sms-mock") === "1";
  } catch {
    return false;
  }
}
const MOCK = mockEnabled();

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (MOCK) {
    const { mockHandle } = await import("./mock");
    return mockHandle(method, path, body) as Promise<T>;
  }
  const init: RequestInit = { method, headers: { "x-actor": "dashboard" } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(SERVER_DOWN_MSG, 0, true);
  }
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | undefined)?.error;
    // Vite proxy answers 500/502/504 with an empty / non-JSON body when the target is down.
    if (!msg && (res.status >= 500 || res.status === 0)) throw new ApiError(SERVER_DOWN_MSG, res.status, true);
    throw new ApiError(msg ?? `Request failed (${res.status})`, res.status);
  }
  if (data === undefined && text && path.startsWith("/api")) {
    // Got HTML instead of JSON — the proxy isn't reaching the API.
    throw new ApiError(SERVER_DOWN_MSG, res.status, true);
  }
  return data as T;
}

const q = (o: Record<string, string | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : "";
};

export type BrandInput = { name: string; website?: string; instagramHandle?: string; driveLink?: string; description?: string };
export type SettingsPatch = {
  claudeOauthToken?: string; llmProvider?: "auto" | "api" | "subscription"; apifyToken?: string;
  anthropicApiKey?: string; anthropicModel?: string; igAppId?: string; igAppSecret?: string;
  publicBaseUrl?: string; timezone?: string; autoPublish?: boolean;
  voice?: string; autoVoiceover?: boolean; pexelsApiKey?: string; pixabayApiKey?: string; etsyApiKey?: string;
  autoMusic?: boolean; musicVolume?: number; defaultMusicMood?: string;
};
/** Settings plus fields added in the voice/media contract update (optional until the server ships them). */
export type SettingsX = Settings & { voice?: string; autoVoiceover?: boolean; pexelsApiKeySet?: boolean; pixabayApiKeySet?: boolean };
export type MusicTrackX = MusicTrack & { description?: string };
export type Voice = { id: string; name: string; gender: string; accent: string };
export type StockResult = { id: string; kind: "video" | "image"; url: string; previewUrl: string; width: number; height: number; credit: string; source: "pexels" | "pixabay" };
export type HtmlTemplate = { id: string; name: string; description: string; tags: string[] };
export type StylesResponse = { styles: StyleMeta[]; captionStyles: CaptionStyleMeta[]; htmlTemplates?: HtmlTemplate[] };
export type PostPatch = Partial<Pick<Post, "title" | "hook" | "caption" | "hashtags" | "spec" | "scheduledAt">>;
export type AutomationInput = { keyword: string; replyText: string; dmText: string; link?: string; postId?: string; enabled?: boolean };
export type Occasion = { id: string; name: string; date: string; angle: string; approx?: boolean };
export type AutopilotPlanItem = { type: "reel" | "carousel" | "image" | "story"; slot: string; pillar?: string; occasion?: { name: string; date: string } };
export type AutopilotStatus = { windowStart: string; windowEnd: string; targets: Record<string, number>; scheduled: Record<string, number>; deficit: Record<string, number>; occasions: Occasion[] };
export type AutopilotInfo = { settings: AutopilotSettings; status: AutopilotStatus; preview: AutopilotPlanItem[] };
export type AutopilotRun = { created: Post[]; plan: AutopilotPlanItem[]; summary: string; dryRun: boolean };
export type Insights = {
  followers?: number; mediaCount?: number;
  recent: { id: string; caption: string; likeCount: number; commentsCount: number; permalink: string; timestamp: string }[];
};

export const api = {
  testLlm: () => request<{ ok: boolean; mode: "api" | "subscription" | null; ms?: number; sample?: unknown; message?: string }>("POST", "/api/settings/test-llm", {}),
  health: () => request<{ ok: boolean; version: string }>("GET", "/api/health"),
  settings: () => request<SettingsX>("GET", "/api/settings"),
  updateSettings: (b: SettingsPatch) => request<SettingsX>("PATCH", "/api/settings", b),
  styles: () => request<StylesResponse>("GET", "/api/styles"),
  voices: () => request<Voice[]>("GET", "/api/voices"),
  music: (brandId?: string) => request<MusicTrackX[]>("GET", `/api/music${q({ brandId })}`),
  setPostMusic: (postId: string, b: { trackId?: string | null; volume?: number; render?: boolean }) => request<Post>("POST", `/api/posts/${postId}/music`, b),
  stock: (query: string, kind: "video" | "image") => request<StockResult[] | { results: StockResult[] }>("GET", `/api/stock${q({ query, kind })}`)
    .then((r) => (Array.isArray(r) ? r : r?.results ?? [])),
  assetFromStock: (brandId: string, url: string, kind: "video" | "image") =>
    request<Asset>("POST", `/api/brands/${brandId}/assets/from-stock`, { url, kind }),
  htmlReelFromTemplate: (brandId: string, b: { templateId: string; scenes: { id: string; durationSec: number; headline: string; subtext?: string }[]; cta?: { text: string; keyword?: string } }) =>
    request<Post>("POST", `/api/brands/${brandId}/html-reel-from-template`, b),

  brands: () => request<Brand[]>("GET", "/api/brands"),
  brand: (id: string) => request<Brand>("GET", `/api/brands/${id}`),
  createBrand: (b: BrandInput) => request<Brand>("POST", "/api/brands", b),
  updateBrand: (id: string, b: Partial<BrandInput & { brain: BrandBrain }>) => request<Brand>("PATCH", `/api/brands/${id}`, b),
  deleteBrand: (id: string) => request<{ ok: true }>("DELETE", `/api/brands/${id}`),
  analyze: (id: string) => request<Brand>("POST", `/api/brands/${id}/analyze`),

  assets: (brandId: string) => request<Asset[]>("GET", `/api/brands/${brandId}/assets`),
  uploadAssets: (brandId: string, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f, f.name);
    return request<Asset[]>("POST", `/api/brands/${brandId}/assets`, fd);
  },
  deleteAsset: (id: string) => request<{ ok: true }>("DELETE", `/api/assets/${id}`),

  runAudit: (brandId: string) => request<Audit>("POST", `/api/brands/${brandId}/audit`),
  audits: (brandId: string) => request<Audit[]>("GET", `/api/brands/${brandId}/audits`),
  plan: (brandId: string, b: { reels?: number; carousels?: number; stories?: number; images?: number; startDate?: string; render?: boolean }) =>
    request<Post[]>("POST", `/api/brands/${brandId}/plan`, b),

  posts: (f: { brandId?: string; status?: PostStatus; type?: PostType } = {}) => request<Post[]>("GET", `/api/posts${q(f)}`),
  post: (id: string) => request<Post>("GET", `/api/posts/${id}`),
  updatePost: (id: string, b: PostPatch) => request<Post>("PATCH", `/api/posts/${id}`, b),
  deletePost: (id: string) => request<{ ok: true }>("DELETE", `/api/posts/${id}`),
  postEvents: (id: string) => request<PostEvent[]>("GET", `/api/posts/${id}/events`),
  render: (id: string) => request<Post>("POST", `/api/posts/${id}/render`),
  approve: (id: string, scheduledAt?: string) => request<Post>("POST", `/api/posts/${id}/approve`, scheduledAt ? { scheduledAt } : {}),
  requestChange: (id: string, text: string) => request<Post>("POST", `/api/posts/${id}/change`, { text }),
  publish: (id: string) => request<Post>("POST", `/api/posts/${id}/publish`),
  calendar: (f: { brandId?: string; from: string; to: string }) => request<Post[]>("GET", `/api/calendar${q(f)}`),

  automations: (brandId: string) => request<Automation[]>("GET", `/api/brands/${brandId}/automations`),
  createAutomation: (brandId: string, b: AutomationInput) => request<Automation>("POST", `/api/brands/${brandId}/automations`, b),
  updateAutomation: (id: string, b: Partial<AutomationInput>) => request<Automation>("PATCH", `/api/automations/${id}`, b),
  deleteAutomation: (id: string) => request<{ ok: true }>("DELETE", `/api/automations/${id}`),
  comments: (brandId: string) => request<CommentLog[]>("GET", `/api/brands/${brandId}/comments`),

  igToken: (brandId: string, accessToken: string, igUserId?: string) =>
    request<Brand>("POST", `/api/brands/${brandId}/instagram/token`, { accessToken, igUserId: igUserId || undefined }),
  igAuthUrl: (brandId: string) => request<{ url: string }>("GET", `/api/instagram/auth-url${q({ brandId })}`),
  igDisconnect: (brandId: string) => request<Brand>("DELETE", `/api/brands/${brandId}/instagram`),
  igInsights: (brandId: string) => request<Insights>("GET", `/api/brands/${brandId}/instagram/insights`),

  mcpConfig: () => request<{ claudeDesktopConfigSnippet: object; configPath: string }>("GET", "/api/mcp/config"),

  // image posts + autopilot (autopost)
  imageDesigns: () => request<{ id: ImageDesign; description: string }[]>("GET", "/api/image-designs"),
  createImagePost: (brandId: string, b: Record<string, unknown>) => request<Post>("POST", `/api/brands/${brandId}/image-posts`, b),
  autopilot: (brandId: string) => request<AutopilotInfo>("GET", `/api/brands/${brandId}/autopilot`),
  setAutopilot: (brandId: string, b: Partial<AutopilotSettings> & { acknowledgeAutoApprove?: boolean }) =>
    request<Omit<AutopilotInfo, "preview">>("PATCH", `/api/brands/${brandId}/autopilot`, b),
  runAutopilot: (brandId: string, b: { dryRun?: boolean } = {}) => request<AutopilotRun>("POST", `/api/brands/${brandId}/autopilot/run`, b),
  autopilotDigest: (brandId?: string) => request<AutopilotDigest>("GET", `/api/autopilot/digest${q({ brandId })}`),
  occasions: (brandId?: string, days = 60) => request<Occasion[]>("GET", `/api/occasions${q({ brandId, days: String(days) })}`),
};
