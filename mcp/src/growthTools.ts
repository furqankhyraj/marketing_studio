// Instagram growth tools: hook A/B, alt text, reel covers, trial reels / collaborators / audio name, publish preview.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HookVariant, Post } from "../../shared/types.ts";
import { get, patch, post } from "./api.ts";
import { fail, ok, postLine, safe } from "./format.ts";

const postId = z.string().min(1).describe("Post id (from list_posts / create_* results).");
const enc = encodeURIComponent;

const hookLine = (v: HookVariant, i: number) =>
  `${i}. "${v.text}" — score ${v.score}/10 (curiosity ${v.scores.curiosity}, specificity ${v.scores.specificity}, clarity ${v.scores.clarity})${v.why ? ` · ${v.why}` : ""} [${v.source}]`;

export function registerGrowthTools(server: McpServer) {
  server.registerTool(
    "suggest_hooks",
    {
      title: "Suggest hook variants (A/B)",
      description:
        "Generate 3 alternative hooks for a post and score them (curiosity, specificity, first-3-seconds clarity). Show them to the user and let them pick; then call apply_hook with the chosen index or text.",
      inputSchema: { postId, count: z.number().int().min(2).max(5).optional().describe("How many variants (default 3).") },
    },
    safe(async ({ postId, count }) => {
      const r = await post<{ variants: HookVariant[]; post: Post }>(`/posts/${enc(postId)}/hooks`, { count }, 120_000);
      return ok(
        `Current hook: "${r.post.hook}"\nVariants (best first):\n${r.variants.map(hookLine).join("\n")}\n\nAsk the user which one to use, then call apply_hook {postId, index}.`,
        r.variants,
      );
    }),
  );

  server.registerTool(
    "apply_hook",
    {
      title: "Apply a hook",
      description:
        "Use a hook on the post (index from suggest_hooks, or your own text). Goes through the normal change path: scene 1 headline + voiceover are revised and the post re-renders. Then use wait_for_render.",
      inputSchema: {
        postId,
        index: z.number().int().min(0).optional().describe("Index from the last suggest_hooks result."),
        text: z.string().optional().describe("Or the exact hook text to use."),
      },
    },
    safe(async ({ postId, index, text }) => {
      if (index === undefined && !text?.trim()) return fail("Pass index (from suggest_hooks) or text.");
      const p = await post<Post>(`/posts/${enc(postId)}/hooks/apply`, { index, text }, 120_000);
      return ok(`Hook change requested — ${postLine(p)}\nNext: wait_for_render.`);
    }),
  );

  server.registerTool(
    "set_growth_options",
    {
      title: "Set growth options (trial reel, collaborators, audio name, alt text)",
      description: [
        "Set Instagram publishing options on a post. They are sent when it is published:",
        "trial (reels only) = post as a trial reel, shown to non-followers first; graduation MANUAL (graduate in the IG app) or SS_PERFORMANCE (auto-graduate if it performs well).",
        "collaborators = up to 3 Instagram usernames invited as collaborators (reels, carousels; not stories).",
        "audioName (reels) = name shown for the reel's original audio (can only be renamed once); empty string = don't rename.",
        "altText (carousels) = one alt text per slide.",
      ].join(" "),
      inputSchema: {
        postId,
        trial: z
          .object({ enabled: z.boolean(), graduation: z.enum(["MANUAL", "SS_PERFORMANCE"]).default("MANUAL") })
          .optional()
          .describe("Trial reel settings (reels only)."),
        collaborators: z.array(z.string()).max(3).optional().describe("Up to 3 IG usernames, with or without @."),
        audioName: z.string().max(100).optional(),
        altText: z.array(z.string().max(1000)).optional(),
      },
    },
    safe(async ({ postId, ...body }) => {
      const p = await patch<Post>(`/posts/${enc(postId)}/growth`, body);
      const bits = [
        p.trial?.enabled ? `trial reel (${p.trial.graduation})` : "",
        p.collaborators?.length ? `collaborators: ${p.collaborators.map((u) => "@" + u).join(", ")}` : "",
        p.audioName !== undefined ? `audio name: ${p.audioName || "(not renamed)"}` : "",
        p.altText?.length ? `${p.altText.length} alt text(s)` : "",
      ].filter(Boolean);
      return ok(`Updated growth options${bits.length ? ": " + bits.join(" · ") : ""}\n${postLine(p)}`);
    }),
  );

  server.registerTool(
    "generate_alt_text",
    {
      title: "Generate alt text",
      description: "Write alt text for every slide of a carousel/image post (sent as alt_text when publishing). Reels and stories don't support alt text.",
      inputSchema: { postId },
    },
    safe(async ({ postId }) => {
      const p = await post<Post>(`/posts/${enc(postId)}/alt-text`, {}, 120_000);
      return ok(`Alt text for ${p.altText?.length ?? 0} image(s):\n${(p.altText ?? []).map((a, i) => `${i + 1}. ${a}`).join("\n")}`);
    }),
  );

  server.registerTool(
    "render_cover",
    {
      title: "Render reel cover",
      description:
        "Render a branded cover (title card with the hook) for a Remotion reel. Sent as cover_url when publicBaseUrl is set, otherwise Instagram uses thumb_offset. Covers are also made automatically after renders.",
      inputSchema: { postId },
    },
    safe(async ({ postId }) => {
      const p = await post<Post>(`/posts/${enc(postId)}/cover`, {}, 300_000);
      return ok(`Cover rendered: ${p.coverUrl}\n${postLine(p)}`);
    }),
  );

  server.registerTool(
    "preview_publish",
    {
      title: "Preview Instagram publish params",
      description: "Show exactly which container parameters (caption, hashtags, trial_params, collaborators, cover, alt_text...) would be sent to Instagram for a post. Read-only.",
      inputSchema: { postId },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ postId }) => {
      const g = await get<{ preview: { containers: unknown[]; caption: string; hashtagsInCaption: number; maxHashtags: number; notes: string[] } }>(
        `/posts/${enc(postId)}/growth`,
      );
      const pv = g.preview;
      return ok(
        `Caption has ${pv.hashtagsInCaption}/${pv.maxHashtags} hashtags.${pv.notes.length ? "\nNotes: " + pv.notes.join(" ") : ""}`,
        pv.containers,
      );
    }),
  );
}
