import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Brand, Post, Audit, Asset, Automation, CommentLog } from "../../shared/types.ts";
import { ApiDownError, ApiError, NOT_RUNNING_MESSAGE, log } from "./api.ts";

const MAX_JSON = 60_000;

/** Readable summary text + pretty JSON block. */
export function ok(text: string, json?: unknown): CallToolResult {
  const content: CallToolResult["content"] = [{ type: "text", text }];
  if (json !== undefined) {
    let s = JSON.stringify(json, null, 2);
    if (s.length > MAX_JSON) s = s.slice(0, MAX_JSON) + "\n… (truncated)";
    content.push({ type: "text", text: "```json\n" + s + "\n```" });
  }
  return { content };
}

export function fail(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Wrap a tool handler so API/network errors become readable tool errors instead of protocol errors. */
export function safe<A, E>(fn: (args: A, extra: E) => Promise<CallToolResult>) {
  return async (args: A, extra: E): Promise<CallToolResult> => {
    try {
      return await fn(args, extra);
    } catch (err) {
      if (err instanceof ApiDownError) return fail(NOT_RUNNING_MESSAGE);
      if (err instanceof ApiError) return fail(err.message);
      log("tool error", err);
      return fail(`Error: ${(err as Error)?.message ?? String(err)}`);
    }
  };
}

export function brandLine(b: Brand): string {
  const bits = [
    `${b.name} (id: ${b.id})`,
    b.website ? `site: ${b.website}` : "",
    b.instagramHandle ? `IG: @${b.instagramHandle.replace(/^@/, "")}` : "",
    `analysis: ${b.analysisStatus}${b.analysisError ? ` (${b.analysisError})` : ""}`,
    `brain: ${b.brain ? "yes" : "no"}`,
    `instagram connected: ${b.igConnected ? "yes" : "no"}`,
  ].filter(Boolean);
  return "- " + bits.join(" | ");
}

export function postLine(p: Post): string {
  const bits = [
    `[${p.status}${p.status === "rendering" && p.renderProgress != null ? ` ${Math.round(p.renderProgress * 100)}%` : ""}]`,
    p.type,
    `"${p.title || p.hook || "(untitled)"}"`,
    `id: ${p.id}`,
    p.scheduledAt ? `scheduled: ${p.scheduledAt}` : "",
    p.postedAt ? `posted: ${p.postedAt}` : "",
    p.igPermalink ? p.igPermalink : "",
    p.error ? `error: ${p.error}` : "",
  ].filter(Boolean);
  return "- " + bits.join(" ");
}

export function postDetail(p: Post): string {
  const lines = [
    `${p.type.toUpperCase()} "${p.title}" — status: ${p.status} (revision ${p.revision})`,
    `id: ${p.id} | brand: ${p.brandId}`,
    p.hook ? `hook: ${p.hook}` : "",
    p.caption ? `caption: ${p.caption}` : "",
    p.hashtags?.length ? `hashtags: ${p.hashtags.map((h) => "#" + h).join(" ")}` : "",
    p.scheduledAt ? `scheduled: ${p.scheduledAt}` : "not scheduled",
    p.renderProgress != null && p.status === "rendering" ? `render progress: ${Math.round(p.renderProgress * 100)}%` : "",
    p.mediaUrls?.length ? `media: ${p.mediaUrls.join(", ")}` : "",
    p.thumbnailUrl ? `thumbnail: ${p.thumbnailUrl}` : "",
    p.igPermalink ? `instagram: ${p.igPermalink}` : "",
    p.error ? `error: ${p.error}` : "",
    p.changeRequests?.length ? `change requests: ${p.changeRequests.map((c) => `"${c.text}"`).join("; ")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function auditText(a: Audit): string {
  const list = (t: string, xs: string[]) => (xs?.length ? `${t}:\n${xs.map((x) => `  • ${x}`).join("\n")}` : "");
  return [
    `Audit ${a.id} (${a.createdAt})`,
    a.summary,
    list("Strengths", a.strengths),
    list("Weaknesses", a.weaknesses),
    list("Opportunities", a.opportunities),
    a.firstReels?.length
      ? "First reels:\n" + a.firstReels.map((r, i) => `  ${i + 1}. ${r.title} — hook: "${r.hook}" (${r.why})`).join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function assetLine(a: Asset): string {
  return `- ${a.kind} ${a.originalName} (id: ${a.id}, ${(a.size / 1024 / 1024).toFixed(2)} MB) ${a.url}`;
}

export function automationLine(a: Automation): string {
  return `- "${a.keyword}" → reply "${a.replyText}" + DM "${a.dmText}"${a.link ? ` (${a.link})` : ""} | ${a.enabled ? "enabled" : "disabled"}${a.postId ? ` | post ${a.postId}` : " | all posts"} | id: ${a.id}`;
}

export function commentLine(c: CommentLog): string {
  return `- ${c.createdAt} @${c.username}: "${c.text}"${c.matchedKeyword ? ` → matched ${c.matchedKeyword} (reply ${c.replied ? "✓" : "✗"}, DM ${c.dmSent ? "✓" : "✗"})` : ""}${c.error ? ` error: ${c.error}` : ""}`;
}
