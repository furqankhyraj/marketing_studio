// Long video → short clips tools (server/src/clips.ts): start a job, poll it, make a custom clip from a range.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ClipJob, ClipMoment } from "../../shared/types.ts";
import { get, post } from "./api.ts";
import { fail, ok, safe } from "./format.ts";

const enc = encodeURIComponent;
const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const eta = (s?: number) => (s === undefined ? "" : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

function momentLine(m: ClipMoment, i: number): string {
  return `${i + 1}. [${clock(m.startMs)}–${clock(m.endMs)}] score ${m.score} · "${m.title}" — ${m.status}${m.postId ? ` · post ${m.postId}` : ""}${m.why ? `\n   why: ${m.why}` : ""}`;
}

export function jobText(j: ClipJob): string {
  const head = `Clip job ${j.id} (${j.source.name}${j.source.durationMs ? `, ${clock(j.source.durationMs)}` : ""}) — ${j.status}${j.status === "waiting" ? " (paused while reel renders run)" : ""}, ${Math.round(j.progress * 100)}%${j.etaSec ? `, ~${eta(j.etaSec)} left` : ""}`;
  const meta = [j.language && `language ${j.language}`, j.model && `whisper ${j.model}`, j.pickedBy && `picked by ${j.pickedBy}`, j.metrics?.transcribeRtf && `${j.metrics.transcribeRtf}× realtime`].filter(Boolean).join(" · ");
  const stages = j.stages.map((s) => `- ${s.label}: ${s.status}${s.status === "running" ? ` ${Math.round(s.progress * 100)}%` : ""}${s.detail ? ` — ${s.detail}` : ""}`).join("\n");
  const moments = j.moments.filter((m) => m.status !== "deleted");
  return [head, meta, stages, moments.length ? `Clips:\n${moments.map(momentLine).join("\n")}` : "", j.error ? `Error: ${j.error}` : ""].filter(Boolean).join("\n");
}

export function registerClipTools(server: McpServer) {
  server.registerTool(
    "clips_start_job",
    {
      title: "Long video → short clips: start",
      description: [
        "Turn a long lesson / process video (10–60 min, English or Urdu/Urdu-English) into short vertical clips for Instagram Reels (Opus-Clip style).",
        "Pass a brand video asset id (upload via the dashboard Clips page or add_asset_from_path) or a local file path (used in place, any size).",
        "The server extracts audio, transcribes with whisper.cpp in 5-minute chunks (slow on this CPU: roughly 0.5× realtime for English, ~1× for Urdu), picks the best 20–60 s moments (Claude when an API key is set, otherwise heuristics), and renders each as a normal reel post (status ready) with captions, hook title and -14 LUFS audio.",
        "It runs in the background at low priority (normal reel renders go first). Poll with clips_job_status. Clip posts then go through the usual approve → schedule → publish flow.",
      ].join(" "),
      inputSchema: {
        brandId: z.string().min(1).describe("Brand id (from list_brands)."),
        assetId: z.string().optional().describe("Video asset id of the brand (see list_assets)."),
        path: z.string().optional().describe("Or an absolute local path to the video file, e.g. C:\\Users\\me\\Videos\\lesson-12.mp4."),
        language: z.enum(["auto", "en", "ur"]).optional().describe("Spoken language (default auto-detect). ur = Urdu or Urdu/English mix → Urdu-script captions in Nastaliq."),
        maxClips: z.number().int().min(1).max(20).optional().describe("How many clips (default 5)."),
        targetSec: z.tuple([z.number(), z.number()]).optional().describe("Clip length range in seconds (default [20, 60])."),
        layout: z.enum(["auto", "fill-blur", "center-crop", "split"]).optional().describe("auto (default: blurred background for 16:9, crop for vertical), fill-blur (whole frame + blurred background, best for screen recordings), center-crop (talking head), split (whole frame on top, bottom-right webcam corner below)."),
        captionStyle: z.string().optional().describe("Caption style id (list_styles), default white-pill; empty string = no captions."),
        music: z.boolean().optional().describe("Add low background music (default false: lessons stay voice-only)."),
        transcript: z.string().optional().describe("Optional existing transcript (SRT / WebVTT / JSON segments) — skips transcription."),
      },
    },
    safe(async (a) => {
      if (!a.assetId && !a.path) return fail("Pass assetId or path.");
      const { brandId, ...body } = a;
      const j = await post<ClipJob>(`/brands/${enc(brandId)}/clips/jobs`, body);
      return ok(`Started clip job ${j.id} for ${j.source.name}.\nIt runs in the background; call clips_job_status {jobId: "${j.id}"} every minute or two to follow it.`, j);
    }),
  );

  server.registerTool(
    "clips_job_status",
    {
      title: "Long video → short clips: status",
      description: "Status of a clip job: stages (extract audio → transcribe → pick moments → render clips) with progress and ETA, and the picked clips (score, hook title, time range, post id). Omit jobId to list the brand's recent jobs.",
      inputSchema: {
        jobId: z.string().optional().describe("Clip job id (from clips_start_job)."),
        brandId: z.string().optional().describe("Brand id: list its recent clip jobs when no jobId is given."),
        includeTranscript: z.boolean().optional().describe("Also return the timestamped transcript (first 400 lines) so you can choose a custom range."),
      },
    },
    safe(async ({ jobId, brandId, includeTranscript }) => {
      if (!jobId) {
        if (!brandId) return fail("Pass jobId, or brandId to list jobs.");
        const jobs = await get<ClipJob[]>(`/brands/${enc(brandId)}/clips/jobs`);
        if (!jobs.length) return ok("No clip jobs for this brand yet.");
        return ok(jobs.slice(0, 10).map((j) => `- ${j.id} ${j.source.name}: ${j.status} ${Math.round(j.progress * 100)}% · ${j.moments.filter((m) => m.status !== "deleted").length} clips`).join("\n"), jobs.slice(0, 10));
      }
      const j = await get<ClipJob>(`/clips/jobs/${enc(jobId)}`);
      let text = jobText(j);
      if (includeTranscript) {
        try {
          const t = await get<{ segments: { startMs: number; endMs: number; text: string }[] }>(`/clips/jobs/${enc(jobId)}/transcript`);
          text += `\n\nTranscript (${t.segments.length} segments):\n` + t.segments.slice(0, 400).map((s) => `[${(s.startMs / 1000).toFixed(1)}-${(s.endMs / 1000).toFixed(1)}] ${s.text}`).join("\n");
        } catch {
          text += "\n\n(No transcript yet.)";
        }
      }
      return ok(text, j);
    }),
  );

  server.registerTool(
    "clips_make_custom",
    {
      title: "Long video → short clips: custom range",
      description: "Make a clip from a chosen time range of a clip job's source video (e.g. after reading the transcript with clips_job_status includeTranscript). It is rendered like the others (captions from the transcript, hook title, -14 LUFS) and becomes a reel post. To trim/extend an existing clip post instead, use request_change on it with e.g. \"extend the end by 5s\" or \"start 3s earlier\".",
      inputSchema: {
        jobId: z.string().min(1).describe("Clip job id."),
        startSec: z.number().min(0).describe("Start time in the source video (seconds)."),
        endSec: z.number().min(1).describe("End time in the source video (seconds); 3–180 s after start."),
        title: z.string().optional().describe("Hook title shown on the clip (default: the first sentence of the range)."),
      },
    },
    safe(async ({ jobId, startSec, endSec, title }) => {
      const j = await post<ClipJob>(`/clips/jobs/${enc(jobId)}/custom`, { startMs: Math.round(startSec * 1000), endMs: Math.round(endSec * 1000), title });
      return ok(`Custom clip queued.\n${jobText(j)}`, j);
    }),
  );
}
