// Clips API (long video → short clips). Own small client so the shared api.ts / mock.ts stay untouched.
// Mock mode (?mock=1) is served from an in-memory simulation below.
import type { Asset, ClipJob, ClipJobOptions, ClipMoment, ClipTranscript, Post } from "./types";
import { ApiError, SERVER_DOWN_MSG, api, mockEnabled } from "./api";

const MOCK = mockEnabled();

async function req<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  if (MOCK) return mockHandle(method, path, body) as Promise<T>;
  let res: Response;
  try {
    res = await fetch(path, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(SERVER_DOWN_MSG, 0, true);
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | undefined)?.error;
    if (!msg && res.status >= 500) throw new ApiError(SERVER_DOWN_MSG, res.status, true);
    throw new ApiError(msg ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export type StartClipJob = Partial<ClipJobOptions> & { assetId?: string; path?: string; transcript?: string };
export type ClipAdjust = { startDeltaMs?: number; endDeltaMs?: number; startMs?: number; endMs?: number; hookTitle?: string; captionStyle?: string | null; layout?: "fill-blur" | "center-crop" | "split"; music?: boolean };

export const clipsApi = {
  jobs: (brandId: string) => req<ClipJob[]>("GET", `/api/brands/${brandId}/clips/jobs`),
  job: (id: string) => req<ClipJob>("GET", `/api/clips/jobs/${id}`),
  start: (brandId: string, b: StartClipJob) => req<ClipJob>("POST", `/api/brands/${brandId}/clips/jobs`, b),
  transcript: (id: string) => req<ClipTranscript>("GET", `/api/clips/jobs/${id}/transcript`),
  more: (id: string, count = 3) => req<ClipJob>("POST", `/api/clips/jobs/${id}/more`, { count }),
  custom: (id: string, b: { startMs: number; endMs: number; title?: string }) => req<ClipJob>("POST", `/api/clips/jobs/${id}/custom`, b),
  cancel: (id: string) => req<ClipJob>("POST", `/api/clips/jobs/${id}/cancel`),
  retry: (id: string) => req<ClipJob>("POST", `/api/clips/jobs/${id}/retry`),
  remove: (id: string) => req<{ ok: true }>("DELETE", `/api/clips/jobs/${id}`),
  adjust: (postId: string, b: ClipAdjust) => req<Post>("POST", `/api/posts/${postId}/clip-adjust`, b),
  /** Streams the file as the raw request body (no multipart), with upload progress. Up to 4 GB. */
  upload: (brandId: string, file: File, onProgress?: (p: number) => void): Promise<Asset> => {
    if (MOCK) return mockUpload(brandId, file, onProgress);
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", `/api/brands/${brandId}/clips/upload?name=${encodeURIComponent(file.name)}`);
      x.setRequestHeader("Content-Type", "application/octet-stream");
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => {
        let d: any;
        try {
          d = JSON.parse(x.responseText);
        } catch {
          /* ignore */
        }
        if (x.status >= 200 && x.status < 300) resolve(d as Asset);
        else reject(new ApiError(d?.error ?? `Upload failed (${x.status})`, x.status));
      };
      x.onerror = () => reject(new ApiError(SERVER_DOWN_MSG, 0, true));
      x.send(file);
    });
  },
  /** Video assets of the brand (candidates for long-video sources). */
  videos: async (brandId: string) => {
    const v = (await api.assets(brandId)).filter((a) => a.kind === "video");
    if (MOCK && !v.length)
      v.push({ id: "mock-lesson", brandId, kind: "video", url: "", path: "C:/Videos/lesson-12.mp4", originalName: "lesson-12.mp4", mime: "video/mp4", size: 734_003_200, createdAt: now() });
    return v;
  },
};

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
export const fmtEta = (sec?: number) => {
  if (sec === undefined || sec === null || !Number.isFinite(sec)) return "";
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;
};

// ---------------------------------------------------------------- mock (?mock=1)
const now = () => new Date().toISOString();
const mockJobs: ClipJob[] = [];
const mockTranscript: ClipTranscript = {
  version: 1,
  language: "en",
  model: "base.en",
  source: "whisper",
  durationMs: 600_000,
  createdAt: now(),
  segments: Array.from({ length: 60 }, (_, i) => ({
    startMs: i * 10_000,
    endMs: i * 10_000 + 9_000,
    text: [
      "Welcome back to the course, today we talk about pricing.",
      "Here is the biggest mistake beginners make.",
      "Why does this matter so much?",
      "Let me show you the simple formula I use.",
      "Materials plus labor, times two, gives you wholesale.",
      "Here is the secret: you are selling a story.",
    ][i % 6],
  })),
};
function mockJob(brandId: string, b: StartClipJob): ClipJob {
  const t = Date.now();
  return {
    id: `cj${t}`,
    brandId,
    status: "running",
    source: { assetId: b.assetId, path: b.path ?? "C:/Videos/lesson.mp4", name: b.path?.split(/[\\/]/).pop() ?? "lesson.mp4", durationMs: 600_000, width: 1920, height: 1080 },
    options: { language: b.language ?? "auto", maxClips: b.maxClips ?? 5, targetSec: b.targetSec ?? [20, 60], layout: b.layout ?? "auto", captionStyle: b.captionStyle ?? "white-pill", music: !!b.music, showProgress: true },
    stages: (["extract", "transcribe", "pick", "render"] as const).map((id) => ({ id, label: { extract: "Extract audio", transcribe: "Transcribe", pick: "Pick moments", render: "Render clips" }[id], status: "pending", progress: 0 })),
    progress: 0,
    moments: [],
    createdAt: new Date(t).toISOString(),
    updatedAt: new Date(t).toISOString(),
  };
}
/** Advance a mock job based on elapsed time (≈ 20 s end to end). */
function tick(j: ClipJob) {
  if (j.status !== "running") return j;
  const el = (Date.now() - Date.parse(j.createdAt)) / 1000;
  const plan: [number, number][] = [[0, 2], [2, 10], [10, 12], [12, 22]];
  j.stages.forEach((s, i) => {
    const [a, b] = plan[i];
    s.progress = Math.max(0, Math.min(1, (el - a) / (b - a)));
    s.status = s.progress >= 1 ? "done" : el >= a ? "running" : "pending";
  });
  j.progress = Math.min(1, el / 22);
  j.etaSec = Math.max(0, Math.round(22 - el));
  j.language = "en";
  j.model = "base.en";
  if (el >= 12 && !j.moments.length) {
    j.moments = [
      { id: "m1", startMs: 10_000, endMs: 42_000, title: "The biggest mistake beginners make", why: "opens with a hook; mentions pricing", score: 82, source: "heuristic", status: "pending", text: "Here is the biggest mistake beginners make…" },
      { id: "m2", startMs: 120_000, endMs: 158_000, title: "The simple pricing formula", why: "clear step-by-step tip", score: 74, source: "heuristic", status: "pending" },
      { id: "m3", startMs: 300_000, endMs: 331_000, title: "You are selling a story", why: "strong closing line", score: 66, source: "heuristic", status: "pending" },
    ];
  }
  j.moments.forEach((m, i) => {
    if (m.status === "deleted") return;
    m.status = el > 14 + i * 3 ? "ready" : el > 12 + i * 3 ? "rendering" : "pending";
  });
  if (el >= 22) {
    j.status = "done";
    j.etaSec = 0;
  }
  return j;
}
async function mockHandle(method: string, path: string, body: any): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 120));
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/api\/brands\/([^/]+)\/clips\/jobs$/))) {
    if (method === "POST") {
      const j = mockJob(m[1], body ?? {});
      mockJobs.unshift(j);
      return j;
    }
    return mockJobs.filter((j) => j.brandId === m![1]).map(tick);
  }
  if ((m = path.match(/^\/api\/clips\/jobs\/([^/]+)(?:\/(\w+))?$/))) {
    const j = mockJobs.find((x) => x.id === m![1]);
    if (!j) throw new ApiError("Clip job not found", 404);
    const action = m[2];
    if (!action) return method === "DELETE" ? (mockJobs.splice(mockJobs.indexOf(j), 1), { ok: true }) : tick(j);
    if (action === "transcript") return mockTranscript;
    if (action === "cancel") return Object.assign(j, { status: "cancelled" });
    if (action === "more" || action === "custom") {
      const add: ClipMoment = { id: `m${Date.now()}`, startMs: body?.startMs ?? 400_000, endMs: body?.endMs ?? 432_000, title: body?.title ?? "Another strong moment", score: action === "custom" ? 0 : 61, source: action === "custom" ? "custom" : "heuristic", status: "ready" };
      j.moments.push(add);
      return j;
    }
    return j;
  }
  if ((m = path.match(/^\/api\/posts\/([^/]+)\/clip-adjust$/))) throw new ApiError("Mock mode: clip adjustments need the real server", 400);
  throw new ApiError("Not found", 404);
}
async function mockUpload(brandId: string, file: File, onProgress?: (p: number) => void): Promise<Asset> {
  for (let i = 1; i <= 5; i++) {
    await new Promise((r) => setTimeout(r, 150));
    onProgress?.(i / 5);
  }
  return { id: `a${Date.now()}`, brandId, kind: "video", url: "", path: `C:/uploads/${file.name}`, originalName: file.name, mime: file.type || "video/mp4", size: file.size, createdAt: now() };
}
