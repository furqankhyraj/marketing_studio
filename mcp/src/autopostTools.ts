// Image posts (single 4:5 feed graphics) + weekly autopilot tools.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AutopilotDigest, AutopilotSettings, Post } from "../../shared/types.ts";
import { get, patch, post } from "./api.ts";
import { fail, ok, postLine, safe } from "./format.ts";

const enc = encodeURIComponent;
const brandId = z.string().min(1).describe("Brand id (from list_brands).");
const DESIGNS = ["quote", "tip", "product", "offer", "testimonial", "question", "before-after", "fact"] as const;

const imageFields = {
  design: z
    .enum(DESIGNS)
    .optional()
    .describe(
      "quote = big quote + author · tip = eyebrow + headline + 2–4 bullets · product = brand photo + name + price + CTA button · offer = badge (NEW / 20% OFF) + headline + price + CTA · testimonial = stars + review + author (ONLY real reviews) · question = poll with options A/B · before-after = two panels · fact = 'Did you know?'",
    ),
  eyebrow: z.string().optional().describe("Small label above the headline, ≤3 words."),
  headline: z.string().optional().describe("Main text, ≤12 words (quotes ≤22). Omit to let the app write the post."),
  body: z.string().optional(),
  bullets: z.array(z.string()).max(4).optional().describe("tip: 2–4 short steps."),
  author: z.string().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  price: z.string().optional(),
  oldPrice: z.string().optional(),
  badge: z.string().optional().describe("e.g. NEW, 20% OFF — only real offers."),
  cta: z.string().optional().describe("Footer / button line, e.g. 'Comment A or B below'."),
  options: z.array(z.object({ label: z.string(), text: z.string() })).max(3).optional().describe("question: 2–3 options; before-after: [before, after]."),
  style: z.string().optional().describe("Style id from list_styles (background, fonts, decoration)."),
};

function apText(s: AutopilotSettings, status?: any): string {
  const per = (["reel", "carousel", "image", "story"] as const).map((f) => `${s.postsPerWeek[f]} ${f}`).join(", ");
  return [
    `Autopilot: ${s.enabled ? "ON" : "off"} · per week: ${per} · approval ${s.approval === "auto" ? "AUTO (publishes without review)" : "manual"} · keeps ${s.leadDays} days filled · occasions ${s.occasions === false ? "off" : "on"}`,
    s.pillars?.length ? `Pillars: ${s.pillars.join(", ")}` : "",
    status ? `Upcoming: ${Object.keys(status.targets).map((f) => `${f} ${status.scheduled[f]}/${status.targets[f]}`).join(", ")}` : "",
    status?.occasions?.length ? `Occasions in window: ${status.occasions.map((o: any) => `${o.name} (${o.date})`).join(", ")}` : "",
    s.lastRunAt ? `Last run ${s.lastRunAt}: ${s.lastResult ?? ""}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function registerAutopostTools(server: McpServer) {
  server.registerTool(
    "create_image_post",
    {
      title: "Create image post (single 4:5 graphic)",
      description: [
        "Create a single-image Instagram feed post: a branded 1080x1350 graphic rendered in seconds (brand colors, logo, handle and the chosen style's fonts are automatic).",
        "Write it yourself (headline + fields) for best results, or pass only design/topic to let the app write it.",
        "Never invent testimonials, prices, discounts or statistics. Product/offer designs use a brand photo when one is uploaded (or pass mediaAssetId).",
        "Like every post it waits for the user's approval before publishing. Publishing image posts needs publicBaseUrl (Instagram fetches the JPEG).",
      ].join(" "),
      inputSchema: {
        brandId,
        ...imageFields,
        topic: z.string().optional().describe("What it should be about (when you don't give a headline)."),
        title: z.string().optional(),
        caption: z.string().optional().describe("Instagram caption WITHOUT hashtags (search-first: keyword in line 1, one CTA)."),
        hashtags: z.array(z.string()).max(5).optional().describe("3–5 specific niche hashtags without '#'."),
        mediaAssetId: z.string().optional().describe("Brand image asset id (list_assets)."),
        scheduledAt: z.string().optional().describe("ISO time; default = next best-time slot."),
        render: z.boolean().optional().describe("Render now (default true)."),
      },
    },
    safe(async ({ brandId, ...rest }) => {
      const p = await post<Post>(`/brands/${enc(brandId)}/image-posts`, rest, 120_000);
      return ok(`Created image post (${(p.spec as any).design}, style ${(p.spec as any).style}):\n${postLine(p)}\nRenders in a few seconds — then wait_for_render / show it to the user for approval.`, { id: p.id, status: p.status, spec: p.spec, caption: p.caption, hashtags: p.hashtags });
    }),
  );

  server.registerTool(
    "update_image_post",
    {
      title: "Edit an image post",
      description: "Change an image post's text, design, style or colors and re-render it (a few seconds). Only the fields you pass change.",
      inputSchema: {
        postId: z.string().min(1),
        ...imageFields,
        colors: z.object({ primary: z.string().optional(), secondary: z.string().optional(), accent: z.string().optional(), background: z.string().optional(), text: z.string().optional() }).optional().describe("Hex colors to override for this post."),
        caption: z.string().optional(),
        hashtags: z.array(z.string()).max(5).optional(),
      },
    },
    safe(async ({ postId, colors, caption, hashtags, ...fields }) => {
      const cur = await get<Post>(`/posts/${enc(postId)}`);
      if (cur.type !== "image") return fail("update_image_post only works on image posts — use update_post / request_change for reels and carousels.");
      const spec: any = { ...cur.spec };
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) spec[k] = v;
      if (colors) spec.brand = { ...spec.brand, colors: { ...spec.brand.colors, ...colors } };
      const visual = Object.values(fields).some((v) => v !== undefined) || !!colors;
      const body: Record<string, unknown> = {};
      if (visual) body.spec = spec;
      if (fields.headline) body.hook = fields.headline;
      if (caption !== undefined) body.caption = caption;
      if (hashtags) body.hashtags = hashtags;
      if (!Object.keys(body).length) return fail("Nothing to change.");
      let p = await patch<Post>(`/posts/${enc(postId)}`, body);
      if (visual) p = await post<Post>(`/posts/${enc(postId)}/render`);
      return ok(`Updated${visual ? " — re-render queued" : ""}:\n${postLine(p)}`);
    }),
  );

  server.registerTool(
    "get_autopilot",
    {
      title: "Get autopilot settings",
      description: "Show a brand's weekly autopilot: on/off, posts per week per format, approval mode, lead days, pillars, how full the upcoming schedule is, upcoming occasions and what it would make next.",
      inputSchema: { brandId },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ brandId }) => {
      const r = await get<{ settings: AutopilotSettings; status: any; preview: any[] }>(`/brands/${enc(brandId)}/autopilot`);
      const next = r.preview.length ? `\nNext run would make: ${r.preview.map((x) => `${x.type} ${x.slot}${x.occasion ? ` (${x.occasion.name})` : ""}`).join("; ")}` : "\nSchedule is full.";
      return ok(apText(r.settings, r.status) + next, r);
    }),
  );

  server.registerTool(
    "set_autopilot",
    {
      title: "Set autopilot",
      description: [
        "Turn the weekly autopilot on/off and set how many reels / carousels / image posts / stories per week it keeps scheduled (it checks every 10 minutes, plans + renders posts into free best-time slots, rotates pillars and formats, avoids repeat topics and uses dates like Eid or Black Friday).",
        "Approval defaults to manual: new posts wait on the Approve screen. approval:'auto' publishes WITHOUT review — only set it if the user explicitly asked for that, and pass acknowledgeAutoApprove:true.",
      ].join(" "),
      inputSchema: {
        brandId,
        enabled: z.boolean().optional(),
        reels: z.number().int().min(0).max(14).optional(),
        carousels: z.number().int().min(0).max(14).optional(),
        images: z.number().int().min(0).max(14).optional(),
        stories: z.number().int().min(0).max(14).optional(),
        leadDays: z.number().int().min(1).max(21).optional().describe("Days ahead to keep filled (default 7)."),
        pillars: z.array(z.string()).optional().describe("Content pillars to rotate (default: brand brain)."),
        occasions: z.boolean().optional().describe("Use the built-in occasion calendar (default true)."),
        approval: z.enum(["manual", "auto"]).optional(),
        acknowledgeAutoApprove: z.boolean().optional().describe("Required true with approval 'auto' — the user explicitly accepted posts going live without review."),
      },
    },
    safe(async ({ brandId, reels, carousels, images, stories, ...rest }) => {
      const ppw: Record<string, number> = {};
      if (reels !== undefined) ppw.reel = reels;
      if (carousels !== undefined) ppw.carousel = carousels;
      if (images !== undefined) ppw.image = images;
      if (stories !== undefined) ppw.story = stories;
      const r = await patch<{ settings: AutopilotSettings; status: any }>(`/brands/${enc(brandId)}/autopilot`, { ...rest, ...(Object.keys(ppw).length ? { postsPerWeek: ppw } : {}) });
      return ok(apText(r.settings, r.status));
    }),
  );

  server.registerTool(
    "run_autopilot",
    {
      title: "Run autopilot now",
      description: "Fill the brand's upcoming schedule up to its weekly target right now (instead of waiting for the 10-minute check). dryRun:true only lists what it would make.",
      inputSchema: { brandId, dryRun: z.boolean().optional() },
    },
    safe(async ({ brandId, dryRun }) => {
      const r = await post<any>(`/brands/${enc(brandId)}/autopilot/run`, { dryRun: !!dryRun, force: !!dryRun }, 300_000);
      const lines = dryRun
        ? r.plan.map((x: any) => `- ${x.type} at ${x.slot}${x.pillar ? ` · ${x.pillar}` : ""}${x.occasion ? ` · ${x.occasion.name}` : ""}`)
        : r.created.map(postLine);
      return ok(`${r.summary}\n${lines.join("\n")}`);
    }),
  );

  server.registerTool(
    "autopilot_digest",
    {
      title: "Autopilot daily digest",
      description: "What autopilot made today, what is waiting for the user's approval, what is scheduled, and upcoming occasions — per brand.",
      inputSchema: { brandId: brandId.optional() },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ brandId }) => {
      const d = await get<AutopilotDigest>("/autopilot/digest", brandId ? { brandId } : undefined);
      const text = d.brands
        .map((b) =>
          [
            `${b.brandName} — autopilot ${b.enabled ? "on" : "off"} (${b.approval})${b.lastResult ? ` · last: ${b.lastResult}` : ""}`,
            `  Made today: ${b.madeToday.length ? b.madeToday.map((p) => `"${p.title}" (${p.type}, ${p.status})`).join(", ") : "nothing"}`,
            `  Waiting for approval: ${b.waiting.length}${b.waiting.length ? " — " + b.waiting.slice(0, 6).map((p) => `"${p.title}" [${p.id}]`).join(", ") : ""}`,
            `  Scheduled: ${b.scheduled.length}${b.scheduled.length ? " — " + b.scheduled.slice(0, 4).map((p) => `"${p.title}" ${p.scheduledAt}`).join(", ") : ""}`,
            b.upcomingOccasions.length ? `  Coming up: ${b.upcomingOccasions.map((o) => `${o.name} ${o.date}`).join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n\n");
      return ok(text || "No brands yet.");
    }),
  );

  server.registerTool(
    "list_occasions",
    {
      title: "List upcoming occasions",
      description: "Built-in calendar of dates relevant to the brand (Ramadan/Eid 2026–2027 (approximate, moon sighting), Pakistan days, Black Friday, Valentine's, Mother's Day, Etsy holiday cut-off…) for timely posts.",
      inputSchema: { brandId: brandId.optional(), days: z.number().int().min(1).max(400).optional().describe("Look-ahead, default 60.") },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ brandId, days }) => {
      const list = await get<any[]>("/occasions", { brandId, days });
      return ok(list.length ? list.map((o) => `- ${o.date} ${o.name}${o.approx ? " (approx.)" : ""} — ${o.angle}`).join("\n") : "No occasions in that window.");
    }),
  );
}
