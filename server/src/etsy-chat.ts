// Chat assistant tools + no-key rule for the Etsy module ("make a reel from my newest Etsy listing").
import type { Brand, PostType } from "../../shared/types.ts";
import type { ChatTool } from "./chat-agent.ts";
import { createListingPosts, etsyStatus, importShop, listingsView, planFromShop, productName } from "./etsy.ts";
import * as db from "./db.ts";

const brandSchema = { type: "string", description: "Brand id (from list_brands)." };
const typesSchema = { type: "array", items: { type: "string", enum: ["reel", "carousel", "story"] }, description: 'Default ["reel"].' };
const brandOf = (id: unknown): Brand => {
  const b = typeof id === "string" ? db.getBrand(id) : undefined;
  if (!b) throw Object.assign(new Error(`Brand not found: ${id ?? "(none)"} — use list_brands.`), { status: 404 });
  return b;
};
const pLink = (p: { id: string; title: string }) => ({ label: p.title.length > 40 ? p.title.slice(0, 38) + "…" : p.title, postId: p.id });

export function etsyChatTools(): ChatTool[] {
  return [
    {
      name: "etsy_import",
      description: "Import the brand's Etsy shop listings (photos, prices, tags, reviews) and merge them into the Brand Brain. Needs the shop name/URL once.",
      input_schema: { type: "object", properties: { brandId: brandSchema, shop: { type: "string", description: "Etsy shop name or URL (optional if saved)." }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["brandId"] },
      run: async (a) => {
        const b = brandOf(a.brandId);
        const r = await importShop(b.id, { shop: a.shop, limit: a.limit });
        const s = r.summary;
        return {
          ok: true,
          label: `Imported ${r.listings.length} Etsy listing${r.listings.length === 1 ? "" : "s"}`,
          brandId: b.id,
          links: [{ label: "Etsy shop", to: "/etsy" }],
          text: `${s.imported} new, ${s.updated} updated, ${s.images} photos, ${s.reviews} reviews (via ${s.source === "api" ? "Etsy API" : "RSS feed"}).${s.warnings.length ? "\n" + s.warnings.join("\n") : ""}\n${r.listings.slice(0, 10).map((l) => `- ${l.listingId}: ${productName(l.title)}`).join("\n")}`,
        };
      },
    },
    {
      name: "etsy_list_listings",
      description: "List the brand's imported Etsy listings (newest first) with price and posts made from them.",
      input_schema: { type: "object", properties: { brandId: brandSchema }, required: ["brandId"] },
      run: async (a) => {
        const b = brandOf(a.brandId);
        const l = listingsView(b.id);
        const s = etsyStatus(b.id);
        return {
          ok: true,
          label: `${l.length} Etsy listing${l.length === 1 ? "" : "s"}`,
          brandId: b.id,
          links: [{ label: "Etsy shop", to: "/etsy" }],
          text: l.length
            ? l.map((x) => `- ${x.listingId}: ${productName(x.title)} — ${x.price ?? "?"} ${x.currency ?? ""}, ${x.imageAssetIds.length} photos${x.posts?.length ? `, posts: ${x.posts.map((p) => `${p.type} ${p.status}`).join(", ")}` : ""}`).join("\n")
            : `No listings yet${s.shop ? ` for shop ${s.shop}` : ""}. Import the shop first (etsy_import) or add a listing on the Etsy page.`,
        };
      },
    },
    {
      name: "etsy_create_posts",
      description:
        'Make a product reel / carousel / story from an Etsy listing (listingId, or "newest" / "top"), or plan posts from the shop\'s best listings (count, no listingId). Uses the listing photos; caption ends with "Comment LINK"; set automation:true (after the user agrees) to DM the listing link to commenters.',
      input_schema: {
        type: "object",
        properties: {
          brandId: brandSchema,
          listingId: { type: "string", description: 'Listing id, "newest" or "top".' },
          count: { type: "integer", minimum: 1, maximum: 10, description: "Plan from shop (when listingId is omitted)." },
          types: typesSchema,
          render: { type: "boolean", description: "Queue renders (default true)." },
          automation: { type: "boolean", description: "Create the comment→DM automation (default false)." },
        },
        required: ["brandId"],
      },
      run: async (a) => {
        const b = brandOf(a.brandId);
        const types = (Array.isArray(a.types) ? a.types : undefined) as PostType[] | undefined;
        const r = a.listingId
          ? await createListingPosts(b.id, String(a.listingId), { types, render: a.render !== false, automation: a.automation === true })
          : await planFromShop(b.id, { count: a.count ?? 3, types, render: a.render !== false, automation: a.automation === true });
        const label = `Made ${r.posts.length} post${r.posts.length === 1 ? "" : "s"} from Etsy`;
        return {
          ok: true,
          label,
          brandId: b.id,
          postIds: r.posts.map((p) => p.id),
          links: [...r.posts.map(pLink), { label: "Etsy shop", to: "/etsy" }],
          text: `${label}${a.render === false ? " (drafts)" : " — renders queued"}:\n${r.posts.map((p) => `- ${p.id} [${p.type}] ${p.title}`).join("\n")}${
            r.automations.length ? `\nComment ${r.automations[0].keyword} → DM automation added.` : "\nWant commenters to get the listing link by DM? Ask again and say “with DM link” (creates a Comment LINK automation)."
          }`,
        };
      },
    },
  ];
}

/** No-key router: Etsy requests. Returns a tool call, or undefined when the text isn't about Etsy. */
export function etsyRule(lower: string, brand: Brand | undefined): { tool: string; input: Record<string, unknown> } | { text: string } | undefined {
  if (!/\betsy\b|\blistings?\b/.test(lower)) return undefined;
  if (!brand) return { text: "Which brand is your Etsy shop on? Pick it in the brand switcher first." };
  const shop = lower.match(/etsy\.com\/(?:[a-z]{2}\/)?shop\/([a-z0-9]+)/i)?.[1];
  if (/\b(import|sync|connect|refresh|pull|load|fetch)\b/.test(lower)) return { tool: "etsy_import", input: { brandId: brand.id, ...(shop ? { shop } : {}) } };
  if (/\b(make|create|turn|generate|do|plan)\b/.test(lower) && /\b(reels?|carousels?|stor(y|ies)|posts?|content)\b/.test(lower)) {
    const types: PostType[] = [];
    if (/\breels?\b/.test(lower)) types.push("reel");
    if (/\bcarousels?\b/.test(lower)) types.push("carousel");
    if (/\bstor(y|ies)\b/.test(lower)) types.push("story");
    const automation = /\b(dm|automation|link)\b/.test(lower.replace(/\blisting\b/g, ""));
    const listingId = lower.match(/\b(\d{6,})\b/)?.[1] ?? (/\b(newest|latest|new|last|recent)\b/.test(lower) ? "newest" : /\b(best|top|popular|most favou?rited)\b/.test(lower) ? "top" : undefined);
    const count = Number(lower.match(/\b(\d{1,2})\s+(?:reels?|posts?|carousels?|stories)\b/)?.[1]);
    if (listingId) return { tool: "etsy_create_posts", input: { brandId: brand.id, listingId, types: types.length ? types : ["reel"], automation } };
    return { tool: "etsy_create_posts", input: { brandId: brand.id, count: Number.isFinite(count) && count > 0 ? count : 3, types: types.length ? types : ["reel"], automation } };
  }
  if (/\b(list|show|which|what)\b/.test(lower)) return { tool: "etsy_list_listings", input: { brandId: brand.id } };
  return undefined;
}
