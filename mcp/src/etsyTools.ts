// Etsy shop tools: import a shop's listings, list them, add one by hand, and turn listings into posts.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Automation, EtsyListing, EtsyStatus, Post } from "../../shared/types.ts";
import { get, post } from "./api.ts";
import { ok, postLine, safe } from "./format.ts";

const brandId = z.string().min(1).describe("Brand id (from list_brands).");
const enc = encodeURIComponent;
const types = z
  .array(z.enum(["reel", "carousel", "story"]))
  .optional()
  .describe('Post types to make (default ["reel"]). Reel = product showcase with the listing photos + voiceover; carousel = photo, benefits, price, review, CTA; story = 3 quick scenes.');
const automation = z
  .boolean()
  .optional()
  .describe("Also create a comment→DM automation per reel/carousel: people who comment the keyword get the listing link (with UTM tags) by DM. Ask the user first; default false.");

const money = (l: EtsyListing) => (l.price !== undefined ? `${l.price.toFixed(2)} ${l.currency ?? ""}`.trim() : "no price");
const listingLine = (l: EtsyListing) =>
  `- ${l.listingId}: "${l.title.slice(0, 80)}" — ${money(l)} · ${l.imageAssetIds.length} photo(s)${l.favorers !== undefined ? ` · ${l.favorers} favorites` : ""}${l.reviews.length ? ` · ${l.reviews.length} review(s)` : ""} · source ${l.source}${l.posts?.length ? ` · posts: ${l.posts.map((p) => `${p.type} ${p.status}`).join(", ")}` : ""}\n  ${l.url}`;

export function registerEtsyTools(server: McpServer) {
  server.registerTool(
    "etsy_import",
    {
      title: "Import Etsy shop listings",
      description: [
        "Import the brand's Etsy shop: active listings (title, description, price, tags, materials, photos, favorites/views) and recent reviews.",
        "Photos are downloaded into the brand's assets and the Brand Brain gets products, price points, review quotes and keywords merged in (user edits are kept). Re-import updates listings in place.",
        "With an Etsy API key (Settings → Etsy, format keystring:shared_secret) the whole shop is read; without one only the 10 newest listings come from the shop's RSS feed (first photo, no tags/reviews) — use etsy_add_listing for others.",
      ].join(" "),
      inputSchema: {
        brandId,
        shop: z.string().optional().describe("Etsy shop name or URL (https://www.etsy.com/shop/<Name>). Saved on the brand; omit to reuse the saved one."),
        limit: z.number().int().min(1).max(100).optional().describe("Max listings (default 25)."),
      },
    },
    safe(async ({ brandId, shop, limit }) => {
      const r = await post<{ source: string; imported: number; updated: number; images: number; reviews: number; warnings: string[]; listings: EtsyListing[]; status: EtsyStatus }>(
        `/brands/${enc(brandId)}/etsy/import`,
        { shop, limit, wait: true },
        600_000,
      );
      return ok(
        [
          `Imported ${r.status.info?.name ?? r.status.shop} via ${r.source === "api" ? "Etsy API" : "RSS feed"}: ${r.imported} new, ${r.updated} updated, ${r.images} photo(s) downloaded, ${r.reviews} review(s).`,
          ...r.warnings.map((w) => `Note: ${w}`),
          "",
          r.listings.map(listingLine).join("\n"),
          "",
          "Next: etsy_create_posts {brandId, listingId, types} (or listingId \"newest\" / \"top\").",
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "etsy_list_listings",
    {
      title: "List imported Etsy listings",
      description: "List the brand's imported Etsy listings (newest first) with price, photos, favorites, reviews and the posts already made from each.",
      inputSchema: { brandId },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ brandId }) => {
      const [l, s] = await Promise.all([get<EtsyListing[]>(`/brands/${enc(brandId)}/etsy/listings`), get<EtsyStatus>(`/brands/${enc(brandId)}/etsy`)]);
      const head = `Shop: ${s.shop ?? "(not set)"} · import mode: ${s.mode}${s.lastImport ? ` · last import ${s.lastImport.at}` : ""}`;
      if (!l.length) return ok(`${head}\nNo listings yet. Use etsy_import (shop name or URL) or etsy_add_listing.`, []);
      return ok(`${head}\n${l.length} listing(s):\n${l.map(listingLine).join("\n")}`);
    }),
  );

  server.registerTool(
    "etsy_add_listing",
    {
      title: "Add an Etsy listing by hand",
      description:
        "Add (or update) one listing without an API key: the listing URL, title, price and photos the user uploaded first with upload_asset (pass their asset ids). Then use etsy_create_posts.",
      inputSchema: {
        brandId,
        url: z.string().describe("Listing URL, e.g. https://www.etsy.com/listing/1234567890/beaded-daisy-bracelet"),
        title: z.string().describe("Listing title."),
        price: z.number().optional().describe("Price in major units, e.g. 24.5"),
        currency: z.string().optional().describe("ISO currency code (default USD)."),
        description: z.string().optional(),
        tags: z.array(z.string()).optional().describe("Etsy tags / keywords."),
        assetIds: z.array(z.string()).optional().describe("Image asset ids from upload_asset / list_assets (the product photos)."),
        reviews: z.array(z.object({ rating: z.number().min(1).max(5), text: z.string() })).optional().describe("Real buyer reviews to quote (never invent)."),
      },
    },
    safe(async ({ brandId, ...body }) => {
      const l = await post<EtsyListing>(`/brands/${enc(brandId)}/etsy/listings`, body);
      return ok(`Saved listing:\n${listingLine(l)}`);
    }),
  );

  server.registerTool(
    "etsy_create_posts",
    {
      title: "Make posts from an Etsy listing",
      description: [
        "Create a product reel / carousel / story from one imported listing, or plan several from the shop's best listings.",
        "Uses the listing photos as scene media, writes the hook, benefit lines, price and a review quote, a keyword-first caption with max 5 hashtags and a 'Comment LINK' CTA. Each post stores the listing link with UTM tags (etsyLink).",
        "Pass listingId (or \"newest\" / \"top\" = most favorited), OR count (without listingId) to plan from the shop: the most favorited listings without posts first.",
        "Renders are queued unless render=false; then use wait_for_render and ask the user for approval. Nothing is published without approval.",
      ].join(" "),
      inputSchema: {
        brandId,
        listingId: z.string().optional().describe('Etsy listing id from etsy_list_listings, or "newest" / "top".'),
        count: z.number().int().min(1).max(10).optional().describe("Plan from shop: how many listings to make posts for (when listingId is omitted)."),
        types,
        style: z.string().optional().describe('Reel style id from list_styles (default rotates product-drop / paper / magazine), or "product-showcase" for the HyperFrames product template.'),
        render: z.boolean().optional().describe("Queue renders now (default true)."),
        automation,
        keyword: z.string().optional().describe('Comment keyword for the CTA + automation (default "LINK").'),
      },
    },
    safe(async ({ brandId, listingId, count, types, style, render, automation, keyword }) => {
      const body = { types, style, render, automation, keyword };
      const r = listingId
        ? await post<{ posts: Post[]; automations: Automation[] }>(`/brands/${enc(brandId)}/etsy/listings/${enc(listingId)}/posts`, body, 300_000)
        : await post<{ posts: Post[]; automations: Automation[]; listings: string[] }>(`/brands/${enc(brandId)}/etsy/plan`, { ...body, count: count ?? 3 }, 300_000);
      return ok(
        [
          `Created ${r.posts.length} post(s):`,
          ...r.posts.map((p) => `${postLine(p)}${p.etsyLink ? `\n  link: ${p.etsyLink}` : ""}`),
          r.automations.length ? `\nComment→DM automations: ${r.automations.map((a) => `${a.keyword} on post ${a.postId}`).join(", ")}` : "\nNo DM automation created (pass automation:true after the user agrees).",
          render === false ? "\nDrafts only — render with the render endpoint or request_change later." : "\nNext: wait_for_render, then show the user and ask for approval.",
        ].join("\n"),
      );
    }),
  );
}
