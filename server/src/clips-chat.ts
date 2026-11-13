// Chat assistant tools + no-key rule for long video → short clips
// ("make clips from C:\Videos\lesson.mp4", "clip status", "make 3 more clips").
import type { Brand, ClipJob } from "../../shared/types.ts";
import type { ChatTool } from "./chat-agent.ts";
import * as db from "./db.ts";
import { customClip, getJob, jobView, listJobs, makeMore, startJob } from "./clips.ts";

const brandSchema = { type: "string", description: "Brand id (from list_brands)." };
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, "0")}`;
const brandOf = (id: unknown): Brand => {
  const b = typeof id === "string" ? db.getBrand(id) : undefined;
  if (!b) throw Object.assign(new Error(`Brand not found: ${id ?? "(none)"} — use list_brands.`), { status: 404 });
  return b;
};

export function clipJobSummary(j: ClipJob): string {
  const st = j.stages.map((s) => `${s.label}: ${s.status}${s.status === "running" ? ` ${Math.round(s.progress * 100)}%` : ""}${s.detail ? ` (${s.detail})` : ""}`).join("; ");
  const ms = j.moments.filter((m) => m.status !== "deleted");
  return `Job ${j.id} — ${j.source.name}: ${j.status}, ${Math.round(j.progress * 100)}%${j.etaSec ? `, ~${Math.max(1, Math.round(j.etaSec / 60))} min left` : ""}.\n${st}${ms.length ? "\n" + ms.map((m) => `- [${clock(m.startMs)}–${clock(m.endMs)}] ${m.score} “${m.title}” ${m.status}`).join("\n") : ""}`;
}

export function clipsChatTools(): ChatTool[] {
  return [
    {
      name: "clips_start_job",
      description: "Turn a long lesson/process video into short vertical clip reels (transcribe → pick best 20–60 s moments → render as ready reel posts). Runs in the background at low priority. Give a brand video assetId or a local file path.",
      input_schema: {
        type: "object",
        properties: {
          brandId: brandSchema,
          assetId: { type: "string", description: "Brand video asset id." },
          path: { type: "string", description: "Or an absolute local file path." },
          language: { type: "string", enum: ["auto", "en", "ur"] },
          maxClips: { type: "integer", minimum: 1, maximum: 20 },
          layout: { type: "string", enum: ["auto", "fill-blur", "center-crop", "split"] },
        },
        required: ["brandId"],
      },
      run: async (a) => {
        const b = brandOf(a.brandId);
        const j = startJob(b.id, a);
        return { ok: true, label: `Started clips from ${j.source.name}`, brandId: b.id, links: [{ label: "Clips", to: "/clips" }], text: `Clip job ${j.id} started for ${j.source.name}. Transcription runs in the background; follow it on the Clips page.` };
      },
    },
    {
      name: "clips_job_status",
      description: "Status of clip jobs (stages, ETA, picked clips). Omit jobId for the brand's latest job.",
      input_schema: { type: "object", properties: { brandId: brandSchema, jobId: { type: "string" } } },
      run: async (a) => {
        const j = a.jobId ? getJob(String(a.jobId)) : listJobs(a.brandId ? brandOf(a.brandId).id : undefined)[0];
        if (!j) return { ok: true, label: "No clip jobs", text: "No clip jobs yet. Open the Clips page or give me a video path.", links: [{ label: "Clips", to: "/clips" }] };
        const v = jobView(j);
        return { ok: true, label: `Clip job: ${v.status}`, text: clipJobSummary(v), links: [{ label: "Clips", to: "/clips" }], postIds: v.moments.map((m) => m.postId).filter(Boolean) as string[] };
      },
    },
    {
      name: "clips_make_custom",
      description: "Make an extra clip from a time range of a clip job's source video, or (without a range) pick 3 more clips.",
      input_schema: { type: "object", properties: { jobId: { type: "string" }, startSec: { type: "number" }, endSec: { type: "number" }, title: { type: "string" }, more: { type: "integer", minimum: 1, maximum: 10 } }, required: ["jobId"] },
      run: async (a) => {
        const j = typeof a.startSec === "number" && typeof a.endSec === "number" ? customClip(String(a.jobId), a) : makeMore(String(a.jobId), Number(a.more) || 3);
        return { ok: true, label: "Clip queued", text: clipJobSummary(j), links: [{ label: "Clips", to: "/clips" }] };
      },
    },
  ];
}

/** No-key rule router hook. Returns a tool call, a text reply, or undefined (not about clips). */
export function clipsRule(text: string, brand: Brand | undefined): { tool: string; input: Record<string, unknown> } | { text: string } | undefined {
  const lower = text.toLowerCase();
  if (!/\bclips?\b|long video|lesson video/.test(lower)) return undefined;
  if (!brand) return { text: "Pick a brand in the brand switcher first." };
  const pathM = text.match(/[a-zA-Z]:\\[^"\n]+?\.(?:mp4|mov|webm|mkv|m4v)\b|"([^"]+\.(?:mp4|mov|webm|mkv|m4v))"/i);
  const path = pathM?.[1] ?? pathM?.[0];
  const lang = /\burdu\b/.test(lower) ? "ur" : /\benglish\b/.test(lower) ? "en" : undefined;
  const n = Number(lower.match(/\b(\d{1,2})\s+(?:more\s+)?(?:short\s+)?clips?\b/)?.[1]) || undefined;
  if (path) return { tool: "clips_start_job", input: { brandId: brand.id, path, ...(lang ? { language: lang } : {}), ...(n ? { maxClips: n } : {}) } };
  const latest = listJobs(brand.id)[0];
  if (/\bmore\b/.test(lower) && latest) return { tool: "clips_make_custom", input: { jobId: latest.id, more: n ?? 3 } };
  if (/\b(status|progress|how (?:is|are)|done|ready|eta)\b/.test(lower)) return { tool: "clips_job_status", input: { brandId: brand.id } };
  if (/\b(make|create|cut|turn|generate)\b/.test(lower))
    return { text: "Send me the video's full path (e.g. “make 5 clips from C:\\Videos\\lesson-12.mp4”), or open the Clips page to upload it." };
  return undefined;
}
