// Google Play tools: import an app listing into a brand (facts + screenshots) and read it back for writing posts.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Asset, PlayStoreApp } from "../../shared/types.ts";
import { get, post } from "./api.ts";
import { ok, safe } from "./format.ts";

const enc = encodeURIComponent;
const brandId = z.string().min(1).describe("Brand id (from list_brands).");

type View = PlayStoreApp & { iconUrlLocal?: string; screenshots: Asset[] };

const describe = (a: View) =>
  [
    `${a.title} (${a.packageId}) — ${a.summary}`,
    `Listing: ${a.url}${a.updatedOn ? ` · updated ${a.updatedOn}` : ""}${a.rating ? ` · ★ ${a.rating.toFixed(1)} (${a.ratingCount ?? "?"} ratings)` : " · no public rating yet"}${a.free ? " · free" : ""}`,
    a.features.length ? `\nFeatures:\n${a.features.map((f) => `- ${f.title}: ${f.text}`).join("\n")}` : "",
    a.whatsNew ? `\nWhat's new: ${a.whatsNew}` : "",
    `\nScreenshots (use as scene media — {src: url, kind: "image"}; portrait phone screens):\n${a.screenshots.map((s, i) => `${i + 1}. ${s.url}`).join("\n")}`,
    a.iconUrlLocal ? `Icon: ${a.iconUrlLocal}` : "",
    `\nFull description:\n${a.description}`,
  ]
    .filter(Boolean)
    .join("\n");

export function registerPlayStoreTools(server: McpServer) {
  server.registerTool(
    "playstore_import",
    {
      title: "Import a Google Play app",
      description:
        "Read an app's public Google Play listing (name, descriptions, feature list, rating, last update, icon, phone screenshots) into a brand. Screenshots and icon are downloaded into the brand's assets so reels/image posts can show the real app. Re-run to refresh after an app update.",
      inputSchema: { brandId, url: z.string().optional().describe("Google Play link or package id; omit to refresh the saved one.") },
    },
    safe(async ({ brandId, url }) => {
      await post(`/brands/${enc(brandId)}/playstore/import`, { url }, 300_000);
      const a = await get<View>(`/brands/${enc(brandId)}/playstore`);
      return ok(`Imported.\n\n${describe(a)}`);
    }),
  );

  server.registerTool(
    "playstore_get",
    {
      title: "Read the brand's Google Play app",
      description: "The imported app facts, feature list and screenshot URLs — read this before writing posts for an app brand. Every post's CTA should send people to the listing URL (\"Download free on Google Play\").",
      inputSchema: { brandId },
    },
    safe(async ({ brandId }) => {
      const a = await get<View | null>(`/brands/${enc(brandId)}/playstore`);
      return ok(a ? describe(a) : "No Google Play app imported for this brand — use playstore_import.");
    }),
  );
}
