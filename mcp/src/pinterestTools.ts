// Pinterest tools: generate pins into the publish queue, and the publisher-agent loop
// (claim the next due pin → upload it on pinterest.com in Chrome → report the pin URL).
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PinClaim, PinterestPin, PinterestStatus } from "../../shared/types.ts";
import { get, post, patch, api } from "./api.ts";
import { ok, safe } from "./format.ts";

const enc = encodeURIComponent;
const brandId = z.string().min(1).describe("Brand id (from list_brands).");
const pinId = z.string().min(1).describe("Pin id.");

const pinLine = (p: PinterestPin) =>
  `- ${p.id} [${p.status}] ${p.kind}/${p.layout} → board "${p.board}"${p.scheduledAt ? ` · due ${p.scheduledAt}` : ""}${p.pinUrl ? ` · ${p.pinUrl}` : ""}\n  "${p.title}"${p.error ? `\n  error: ${p.error}` : ""}`;

const claimText = (c: PinClaim) =>
  [
    `Claimed pin ${c.pin.id} for ${c.brandName} (lease 30 min). Publish it now on pinterest.com, then call pinterest_mark_published.`,
    c.account ? `Pinterest account: ${c.account}` : "",
    c.chromeProfile ? `Chrome profile signed in to it: ${c.chromeProfile}` : "",
    "",
    `File to upload (${c.pin.kind}): ${c.pin.mediaPath}`,
    c.pin.coverPath ? `Cover image (optional): ${c.pin.coverPath}` : "",
    `Title: ${c.pin.title}`,
    `Description: ${c.pin.description}`,
    `Link: ${c.pin.link ?? "(none)"}`,
    `Board: ${c.pin.board}`,
    `Alt text: ${c.pin.altText}`,
    c.pin.keywords.length ? `Topic ideas: ${c.pin.keywords.slice(0, 5).join(", ")}` : "",
    "",
    "How to publish:",
    c.instructions,
  ]
    .filter((l) => l !== "")
    .join("\n");

export function registerPinterestTools(server: McpServer) {
  server.registerTool(
    "pinterest_status",
    {
      title: "Pinterest queue status",
      description: "Pinterest settings and queue counts for a brand (rendering / ready / queued / claimed / published / failed), how many pins are due now and when the next one is due.",
      inputSchema: { brandId },
    },
    safe(async ({ brandId }) => {
      const s = await get<PinterestStatus>(`/brands/${enc(brandId)}/pinterest`);
      const c = s.counts;
      return ok(
        [
          `Pinterest is ${s.settings.enabled ? "ON" : "OFF"} · approval ${s.settings.approval} · ${s.settings.pinsPerDay} pins/day · keep ${s.settings.leadDays} day(s) queued`,
          `Queue: ${c.rendering} rendering, ${c.ready} waiting for approval, ${c.queued} queued (${s.due} due now${s.nextDueAt ? `, next at ${s.nextDueAt}` : ""}), ${c.claimed} being published, ${c.published} published (${s.publishedToday} in the last 24h), ${c.failed} failed.`,
          `Boards: ${s.settings.boards.map((b) => b.name).join(", ") || "(none set — pins use the default board)"}${s.settings.defaultBoard ? ` · default "${s.settings.defaultBoard}"` : ""}`,
          s.settings.account ? `Account: ${s.settings.account}${s.settings.chromeProfile ? ` (Chrome profile: ${s.settings.chromeProfile})` : ""}` : "",
          s.settings.lastResult ? `Last run: ${s.settings.lastResult} (${s.settings.lastRunAt})` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }),
  );

  server.registerTool(
    "pinterest_settings",
    {
      title: "Change Pinterest settings",
      description:
        "Turn the Pinterest pin generator on/off for a brand and set how it works. enabled = the background worker keeps the queue filled (every 15 min). approval auto = new pins go straight to the publish queue; manual = they wait for the user's yes in the dashboard.",
      inputSchema: {
        brandId,
        enabled: z.boolean().optional(),
        approval: z.enum(["auto", "manual"]).optional(),
        pinsPerDay: z.number().int().min(1).max(25).optional().describe("Publish slots per day (default 5)."),
        leadDays: z.number().int().min(1).max(14).optional().describe("Days of pins to keep queued (default 3)."),
        fromPosts: z.boolean().optional().describe("Approved/posted reels and image posts become pins."),
        fromEtsy: z.boolean().optional().describe("Etsy listings become fresh 2:3 image pins."),
        boards: z.array(z.object({ name: z.string(), keywords: z.array(z.string()).optional() })).optional().describe("Pinterest boards (exact names) with matching keywords. Replaces the list."),
        defaultBoard: z.string().optional(),
        account: z.string().optional().describe("Pinterest account name, for the publisher agent."),
        chromeProfile: z.string().optional().describe("Chrome profile signed in to that Pinterest account."),
        design: z.enum(["classic", "persian"]).optional().describe("Image pin look: classic, or Persian art cards."),
      },
    },
    safe(async ({ brandId, ...body }) => {
      const s = await patch<PinterestStatus>(`/brands/${enc(brandId)}/pinterest`, body);
      return ok(`Saved. Pinterest is ${s.settings.enabled ? "ON" : "OFF"} · approval ${s.settings.approval} · ${s.settings.pinsPerDay}/day.`);
    }),
  );

  server.registerTool(
    "pinterest_generate",
    {
      title: "Generate Pinterest pins",
      description: [
        "Create pins now. With postId: a pin from that post (reels/stories become video pins using the same MP4; image posts/carousels use the first image).",
        "With listingId: a fresh 1000x1500 image pin for that Etsy listing (layout photo, collage or text; rotates automatically).",
        "With neither: run the generator for the brand (pins for approved posts that don't have one yet + Etsy listing pins until the queue holds pinsPerDay × leadDays).",
        "Pins are scheduled into the next free publish slots.",
      ].join(" "),
      inputSchema: {
        brandId,
        postId: z.string().optional(),
        listingId: z.string().optional(),
        layout: z.enum(["photo", "collage", "text", "persian"]).optional(),
      },
    },
    safe(async ({ brandId, postId, listingId, layout }) => {
      if (postId || listingId) {
        const r = await post<{ pins: PinterestPin[] }>(`/brands/${enc(brandId)}/pinterest/pins`, { postId, listingId, layout }, 180_000);
        return ok(`Created:\n${r.pins.map(pinLine).join("\n")}\nImage pins render in ~10-30 s.`);
      }
      const r = await post<{ created: PinterestPin[]; summary: string }>(`/brands/${enc(brandId)}/pinterest/run`, {}, 600_000);
      return ok(`${r.summary}\n${r.created.map(pinLine).join("\n")}`);
    }),
  );

  server.registerTool(
    "pinterest_queue",
    {
      title: "List Pinterest pins",
      description: "List pins (optionally for one brand and/or statuses, comma-separated: rendering,ready,queued,claimed,published,failed,skipped).",
      inputSchema: { brandId: brandId.optional(), status: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
    },
    safe(async ({ brandId, status, limit }) => {
      const pins = await get<PinterestPin[]>("/pinterest/pins", { brandId, status, limit: limit ?? 50 });
      return ok(pins.length ? pins.map(pinLine).join("\n") : "No pins.");
    }),
  );

  server.registerTool(
    "pinterest_claim_next",
    {
      title: "Claim the next Pinterest pin to publish",
      description:
        "For the PUBLISHER agent. Claims the next due pin (30-minute lease) and returns the file path, title, description, link, board, alt text and step-by-step publishing instructions for pinterest.com. Returns nothing when no pin is due. After publishing call pinterest_mark_published; on trouble call pinterest_mark_failed or pinterest_release.",
      inputSchema: {
        brandId: brandId.optional().describe("Only this brand (default: any brand)."),
        agent: z.string().optional().describe("Your name, shown in the dashboard."),
        any: z.boolean().optional().describe("Also claim pins scheduled for later (publish ahead of time). Default false."),
      },
    },
    safe(async ({ brandId, agent, any }) => {
      const r = await post<PinClaim | { pin: null; message: string }>("/pinterest/claim", { brandId, agent: agent ?? "claude-publisher", any });
      if (!r.pin) return ok((r as { message: string }).message);
      return ok(claimText(r as PinClaim));
    }),
  );

  server.registerTool(
    "pinterest_mark_published",
    {
      title: "Report a pin as published",
      description: "Call after the pin is live on Pinterest, with its URL (https://www.pinterest.com/pin/<id>/).",
      inputSchema: { pinId, pinUrl: z.string().url() },
    },
    safe(async ({ pinId, pinUrl }) => {
      const p = await post<PinterestPin>(`/pinterest/pins/${enc(pinId)}/published`, { pinUrl });
      return ok(`Marked published: ${p.pinUrl}. Call pinterest_claim_next for the next one.`);
    }),
  );

  server.registerTool(
    "pinterest_mark_failed",
    {
      title: "Report a pin that could not be published",
      description: "retry true (default) = back in the queue in 30 min (max 3 attempts); false = permanently failed. Describe what went wrong.",
      inputSchema: { pinId, error: z.string().min(1), retry: z.boolean().optional() },
    },
    safe(async ({ pinId, error, retry }) => {
      const p = await post<PinterestPin>(`/pinterest/pins/${enc(pinId)}/failed`, { error, retry });
      return ok(`Pin ${p.id} is now ${p.status}${p.status === "queued" ? ` (retry at ${p.scheduledAt})` : ""}.`);
    }),
  );

  server.registerTool(
    "pinterest_release",
    {
      title: "Hand a claimed pin back",
      description: "Put a claimed pin back in the queue untouched (e.g. you are not signed in to Pinterest).",
      inputSchema: { pinId },
    },
    safe(async ({ pinId }) => {
      const p = await post<PinterestPin>(`/pinterest/pins/${enc(pinId)}/release`, {});
      return ok(`Pin ${p.id} is ${p.status} again.`);
    }),
  );

  server.registerTool(
    "pinterest_update_pin",
    {
      title: "Edit a pin",
      description: "Change a pin's title (<=100), description (<=500), link, board, alt text or scheduled time before it is published.",
      inputSchema: {
        pinId,
        title: z.string().optional(),
        description: z.string().optional(),
        link: z.string().optional(),
        board: z.string().optional(),
        altText: z.string().optional(),
        scheduledAt: z.string().optional().describe("ISO date-time."),
      },
    },
    safe(async ({ pinId, ...body }) => {
      const p = await api<PinterestPin>("PATCH", `/pinterest/pins/${enc(pinId)}`, { body });
      return ok(`Updated:\n${pinLine(p)}`);
    }),
  );
}
