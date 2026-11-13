import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const msg = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

const APPROVAL =
  "Show me each rendered post (media URL) and wait for my explicit approval before calling approve_post. Do not publish anything without my yes.";

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "pinterest_publisher",
    {
      title: "Publish due Pinterest pins",
      description: "Publisher agent loop: claim each due pin from Social MCP Studio and publish it on pinterest.com with Claude in Chrome.",
      argsSchema: { brand: z.string().optional().describe("Brand id (optional; default all brands)"), max: z.string().optional().describe("Max pins this run (default 10)") },
    },
    ({ brand, max }) =>
      msg(
        `You are the Pinterest publisher for Social MCP Studio.${brand ? ` Only brand ${brand}.` : ""} Publish at most ${max || "10"} pins this run.
Loop: call pinterest_claim_next${brand ? ` {brandId: "${brand}"}` : ""}. If it says nothing is due, stop and report. Otherwise follow the instructions it returns exactly: in Claude in Chrome (the profile signed in to that Pinterest account), open https://www.pinterest.com/pin-creation-tool/, upload the file path it gives, fill title, description, link, board (create it with that exact name if missing) and alt text, publish, copy the new pin's URL and call pinterest_mark_published. On any problem call pinterest_mark_failed (retry true for temporary problems) or pinterest_release. Never sign in, change account settings or accept terms yourself — stop and tell me instead. Wait about a minute between pins. Finish with a short list: pin title → URL.`,
      ),
  );

  server.registerPrompt(
    "weekly_content_plan",
    {
      title: "Weekly content plan",
      description: "Plan and create a week of Instagram content for a brand (reels + carousel + story), render it, and queue for approval.",
      argsSchema: {
        brand: z.string().describe("Brand name or id"),
        reels: z.string().optional().describe("Number of reels (default 3)"),
        focus: z.string().optional().describe("Theme / product / launch to focus on this week"),
      },
    },
    ({ brand, reels, focus }) =>
      msg(
        `Plan next week's Instagram content for the brand "${brand}" in Social MCP Studio.
1. Find the brand (list_brands), read its brain (get_brand) and the latest audit (get_latest_audit; run_audit if none).
2. Propose ${reels || "3"} reels, 1 carousel and 2 stories${focus ? ` focused on: ${focus}` : ""}, spread over the brand's best times (brain.bestTimes) — give me a short table (day/time, format, hook, pillar) first.
3. After I OK the plan, write each one yourself with create_reel / create_carousel / create_story (follow social-mcp://guides/reelspec: hook in 1.5s, 5–7 scenes, voiceoverText on every scene, captionStyle set, CTA keyword) using the brand's own assets (list_assets) where possible.
4. wait_for_render for each, then ${APPROVAL}
5. Set up a create_automation for each CTA keyword (confirm the wording with me).`,
      ),
  );

  server.registerPrompt(
    "viral_reel_from_idea",
    {
      title: "Viral reel from an idea",
      description: "Turn a rough idea into a polished, hook-first reel for a brand and render it.",
      argsSchema: {
        brand: z.string().describe("Brand name or id"),
        idea: z.string().describe("The rough idea / topic"),
        style: z.string().optional().describe("Preferred style id (optional; see list_styles)"),
      },
    },
    ({ brand, idea, style }) =>
      msg(
        `Make a reel for "${brand}" from this idea: ${idea}
- Read the brand brain (get_brand) and list_styles${style ? `; use style "${style}" if it fits` : "; pick the best style and caption style for the idea"}.
- Write 3 alternative hooks (≤ 7 words, scroll-stopping), pick the strongest and tell me why.
- Build 5–7 scenes with voiceoverText on each, a captionStyle, and a CTA with a comment keyword. Respect claimsToAvoid.
- create_reel, then wait_for_render. ${APPROVAL}`,
      ),
  );

  server.registerPrompt(
    "etsy_product_launch",
    {
      title: "Etsy product launch",
      description: "Launch campaign for a new Etsy product: teaser story, launch reel, detail carousel, and DM automation with the listing link.",
      argsSchema: {
        brand: z.string().describe("Brand name or id (the Etsy shop)"),
        product: z.string().describe("Product name and short description"),
        listingUrl: z.string().optional().describe("Etsy listing URL"),
        photosFolder: z.string().optional().describe("Local folder/paths of product photos to upload"),
      },
    },
    ({ brand, product, listingUrl, photosFolder }) =>
      msg(
        `Create an Etsy product launch campaign for "${brand}": ${product}${listingUrl ? ` (listing: ${listingUrl})` : ""}.
${photosFolder ? `First upload the product photos from ${photosFolder} with upload_asset.\n` : ""}- get_brand for voice/colors; use the product photos as scene media (list_assets).
- 1 teaser story (create_story, "something new drops <day>"), 1 launch reel (create_reel: hook on the problem it solves or how it's made, show it in hand, price/benefit, CTA "Comment SHOP for the link"), 1 carousel with details/sizes/gift ideas (create_carousel).
- Propose scheduledAt across 3 days at the brand's best times.
- create_automation keyword SHOP: reply "Sent you the link! 💌", DM with the listing link${listingUrl ? "" : " (ask me for it)"} — confirm wording with me first.
- wait_for_render for each. ${APPROVAL}`,
      ),
  );

  server.registerPrompt(
    "academy_course_promo",
    {
      title: "Academy course promo",
      description: "Promote a course / cohort for an academy brand (e.g. Saqqa Academy) with value-first reels and an enrol-via-DM automation.",
      argsSchema: {
        brand: z.string().describe("Brand name or id (the academy)"),
        course: z.string().describe("Course name, what students learn, who it's for"),
        enrolUrl: z.string().optional().describe("Enrolment / landing page URL"),
        deadline: z.string().optional().describe("Enrolment deadline or start date"),
      },
    },
    ({ brand, course, enrolUrl, deadline }) =>
      msg(
        `Promote this course for "${brand}": ${course}${deadline ? ` — enrolment closes / starts ${deadline}` : ""}.
- get_brand + get_latest_audit. Value-first: 2 reels that teach one quick lesson from the course (hook = the outcome or a common mistake), 1 reel on who it's for + what's inside, 1 carousel "curriculum at a glance", 1 story countdown${deadline ? " to the deadline" : ""}.
- Every reel: 5–7 scenes, voiceoverText on each, captionStyle set, CTA "Comment LEARN for the details". No invented testimonials, student results or income claims; follow claimsToAvoid.
- create_automation keyword LEARN with a DM containing ${enrolUrl ? enrolUrl : "the enrolment link (ask me)"} — confirm wording with me.
- wait_for_render for each. ${APPROVAL}`,
      ),
  );
}
