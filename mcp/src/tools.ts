import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type {
  Asset,
  Audit,
  Automation,
  Brand,
  BrandBrain,
  CommentLog,
  MusicTrack,
  Post,
  PostStatus,
} from "../../shared/types.ts";
import { del, get, patch, post, sleep } from "./api.ts";
import {
  assetLine,
  auditText,
  automationLine,
  brandLine,
  commentLine,
  fail,
  ok,
  postDetail,
  postLine,
  safe,
} from "./format.ts";
import {
  DEFAULT_COLORS,
  buildCarouselSpec,
  buildHtmlReelSpec,
  buildReelSpec,
  buildScenes,
  cleanTags,
  fetchBrand,
  validateStyle,
  type StylesResponse,
} from "./specs.ts";

// ---------- shared zod pieces ----------
const brandId = z.string().min(1).describe("Brand id (from list_brands).");
const postId = z.string().min(1).describe("Post id (from list_posts / create_* results).");
const isoDate = z
  .string()
  .describe("ISO 8601 date-time, e.g. 2026-11-14T18:00:00+05:00. Interpreted by the server in the configured timezone.");
const hashtags = z
  .array(z.string())
  .describe("Hashtags without '#', e.g. [\"etsyfinds\",\"handmadejewelry\"]. MAX 5 (Instagram's limit; extras are dropped) — use 3–5 specific niche keywords, not generic tags.");
const cta = z
  .object({
    text: z.string().describe("End-card text, e.g. \"Comment GROW for the free guide\"."),
    keyword: z.string().optional().describe("Comment keyword shown big on the end card, e.g. \"GROW\" (pair with create_automation)."),
  })
  .describe("Final call-to-action end card.");

const sceneSchema = z.object({
  headline: z.string().describe("Big on-screen text. Short: max ~7 words."),
  subtext: z.string().optional().describe("Smaller supporting line."),
  bullets: z.array(z.string()).optional().describe("Optional 2–4 short bullet points."),
  voiceoverText: z
    .string()
    .optional()
    .describe(
      "Narration line for this scene. ALWAYS fill this: the server auto-generates a free voiceover + word-timed captions from it and stretches scene durations to fit the narration. English → Kokoro voice. For Urdu brands (brain.language \"ur\" or \"ur-roman\") write it in Urdu script (e.g. \"آج ہم سیکھیں گے\"; English terms phonetically: AI → \"اے آئی\"): Urdu script is voiced by a Piper Urdu voice, Roman Urdu/Latin text is NOT (it falls back to the English voice). For Arabic (brain.language \"ar\" or language \"ar\") write Modern Standard Arabic in Arabic script — voiced by the Piper Arabic voice.",
    ),
  captionText: z
    .string()
    .optional()
    .describe("Optional caption text when it should differ from voiceoverText, e.g. the Roman Urdu transliteration of Urdu-script narration for brain.language \"ur-roman\". Timings still follow the narration."),
  mediaAssetId: z.string().optional().describe("Id of an uploaded brand asset (image/video) to use as background (see list_assets)."),
  mediaUrl: z.string().optional().describe("Or a direct http(s) URL of an image/video to use as background."),
  durationSec: z.number().min(0.5).max(20).describe("Scene length in seconds (1.5–4 typical; first scene ≤ 2s for the hook)."),
});

const slideSchema = z.object({
  headline: z.string().describe("Slide headline (big text)."),
  body: z.string().optional().describe("Slide body text (1–3 short sentences)."),
  mediaAssetId: z.string().optional().describe("Uploaded brand asset id for a background image."),
  mediaUrl: z.string().optional().describe("Or a direct http(s) image URL."),
});

const userConfirmed = z
  .boolean()
  .describe(
    "Must be true, and only after the user has explicitly said yes in this conversation to this exact action. Never set it on your own initiative.",
  );

// ---------- progress helper ----------
type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

async function progress(extra: Extra, value: number, total: number, message: string) {
  const token = extra?._meta?.progressToken;
  if (token === undefined || !extra.sendNotification) return;
  try {
    await extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: value, total, message } });
  } catch {
    /* ignore */
  }
}

const DONE_STATUSES: PostStatus[] = ["ready", "failed", "approved", "posted", "publishing"];

async function waitForPost(id: string, timeoutSec: number, extra: Extra): Promise<{ post: Post; timedOut: boolean }> {
  const deadline = Date.now() + timeoutSec * 1000;
  let p = await get<Post>(`/posts/${encodeURIComponent(id)}`);
  let tick = 0;
  while (!DONE_STATUSES.includes(p.status)) {
    // A draft that isn't rendering will never finish by itself.
    if (p.status === "draft" && tick > 3) break;
    if (Date.now() >= deadline || extra?.signal?.aborted) return { post: p, timedOut: true };
    await progress(extra, Math.round((p.renderProgress ?? 0) * 100), 100, `${p.status} ${Math.round((p.renderProgress ?? 0) * 100)}%`);
    await sleep(3000);
    tick++;
    p = await get<Post>(`/posts/${encodeURIComponent(id)}`);
  }
  return { post: p, timedOut: false };
}

function mergeBrain(existing: BrandBrain | undefined, partial: Partial<BrandBrain>): BrandBrain {
  const base: BrandBrain = existing ?? {
    summary: "",
    products: [],
    audience: "",
    voice: "",
    niche: "",
    colors: { ...DEFAULT_COLORS },
    claimsToAvoid: [],
    differentiators: [],
    ctas: [],
    keywords: [],
    contentPillars: [],
  };
  const merged: BrandBrain = { ...base, ...stripUndefined(partial) } as BrandBrain;
  merged.colors = { ...base.colors, ...stripUndefined(partial.colors ?? {}) };
  if (partial.fonts) merged.fonts = { ...(base.fonts ?? {}), ...stripUndefined(partial.fonts) };
  return merged;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const READY_HINT =
  "Next: call wait_for_render, then show the user the video/thumbnail URL and ask for approval. Do NOT approve or publish without the user's explicit yes.";

export function registerTools(server: McpServer) {
  // ================= Brands =================
  server.registerTool(
    "list_brands",
    {
      title: "List brands",
      description: "List all brands in Social MCP Studio with their ids, analysis status and Instagram connection state. Start here.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const brands = await get<Brand[]>("/brands");
      if (!brands.length) return ok("No brands yet. Create one with create_brand (name + website and/or description).", []);
      return ok(`${brands.length} brand(s):\n${brands.map(brandLine).join("\n")}`, brands.map(({ brain, ...b }) => ({ ...b, hasBrain: !!brain })));
    }),
  );

  server.registerTool(
    "get_brand",
    {
      title: "Get brand (with brain)",
      description:
        "Get one brand including its brand brain (summary, products, audience, voice, colors, logo, CTAs, keywords, content pillars, best posting times, claims to avoid). Read this before writing any content for the brand.",
      inputSchema: { brandId },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ brandId }) => {
      const b = await fetchBrand(brandId);
      const br = b.brain;
      const text = [
        brandLine(b),
        br
          ? [
              `Summary: ${br.summary}`,
              `Niche: ${br.niche} | Audience: ${br.audience}`,
              `Voice: ${br.voice}`,
              `Products: ${br.products.join(", ")}`,
              `Pillars: ${br.contentPillars.join(", ")}`,
              `CTAs: ${br.ctas.join(" / ")}`,
              `Claims to avoid: ${br.claimsToAvoid.join("; ") || "-"}`,
              `Best times: ${br.bestTimes?.join(", ") || "-"}`,
              `Language: ${br.language || "en"}${br.voiceId ? ` (voice ${br.voiceId})` : ""}${/^ar/i.test(br.language ?? "") ? " — write voiceoverText, headlines and caption in Modern Standard Arabic (Arabic script)" : ""}${/^ur/i.test(br.language ?? "") ? " — write voiceoverText in Urdu script" + (/roman/i.test(br.language ?? "") ? ", headlines + captionText in Roman Urdu" : ", headlines in Urdu script") : ""}`,
              `Colors: ${Object.entries(br.colors).map(([k, v]) => `${k} ${v}`).join(", ")}`,
            ].join("\n")
          : "No brand brain yet — run analyze_brand (or fill it with update_brand_brain).",
      ].join("\n");
      return ok(text, b);
    }),
  );

  server.registerTool(
    "create_brand",
    {
      title: "Create brand",
      description:
        "Create a new brand. If a website or description is given, the server starts building the brand brain in the background — follow with analyze_brand to wait for it.",
      inputSchema: {
        name: z.string().min(1).describe("Brand / business name."),
        website: z.string().optional().describe("Website or shop URL (e.g. Etsy shop URL)."),
        instagramHandle: z.string().optional().describe("Instagram handle, with or without @."),
        driveLink: z.string().optional().describe("Optional Google Drive folder link with brand media."),
        description: z.string().optional().describe("What the business does, in the user's words."),
      },
    },
    safe(async (args) => {
      const b = await post<Brand>("/brands", stripUndefined(args));
      return ok(`Created brand ${b.name} (id: ${b.id}). Analysis: ${b.analysisStatus}. Next: analyze_brand to wait for / build the brand brain.`, b);
    }),
  );

  server.registerTool(
    "analyze_brand",
    {
      title: "Analyze brand (build brand brain)",
      description:
        "Scrape the brand's website/description and build its brand brain. Starts analysis if not already running and waits up to ~90s for it to finish.",
      inputSchema: {
        brandId,
        restart: z.boolean().optional().describe("Force a fresh analysis even if one already finished (default: true unless already running)."),
      },
    },
    safe(async ({ brandId, restart }, extra: Extra) => {
      let b = await fetchBrand(brandId);
      if (b.analysisStatus !== "running" && restart !== false) {
        b = await post<Brand>(`/brands/${encodeURIComponent(brandId)}/analyze`);
      }
      const deadline = Date.now() + 90_000;
      let i = 0;
      while (b.analysisStatus === "running" && Date.now() < deadline) {
        await progress(extra, i, 30, "analyzing brand…");
        await sleep(3000);
        i++;
        b = await fetchBrand(brandId);
      }
      if (b.analysisStatus === "running")
        return ok(`Analysis still running after 90s for ${b.name}. Call analyze_brand again with restart=false to keep waiting, or get_brand later.`, { id: b.id, analysisStatus: b.analysisStatus });
      if (b.analysisStatus === "failed") return fail(`Analysis failed for ${b.name}: ${b.analysisError ?? "unknown error"}`);
      return ok(`Brand brain ready for ${b.name}.\n${b.brain?.summary ?? ""}`, b.brain);
    }),
  );

  const colorsSchema = z
    .object({
      primary: z.string().optional(),
      secondary: z.string().optional(),
      accent: z.string().optional(),
      background: z.string().optional(),
      text: z.string().optional(),
    })
    .describe("Hex colors, e.g. {primary:\"#1E3A8A\"}");

  server.registerTool(
    "update_brand_brain",
    {
      title: "Update brand brain",
      description:
        "Merge a partial update into the brand brain (fields you pass replace those fields; colors/fonts are merged key by key; everything else is kept). Use to fix voice, colors, CTAs, keywords, best times, etc.",
      inputSchema: {
        brandId,
        brain: z
          .object({
            summary: z.string().optional(),
            products: z.array(z.string()).optional(),
            audience: z.string().optional(),
            voice: z.string().optional(),
            niche: z.string().optional(),
            colors: colorsSchema.optional(),
            fonts: z.object({ heading: z.string().optional(), body: z.string().optional() }).optional(),
            logoUrl: z.string().optional(),
            claimsToAvoid: z.array(z.string()).optional(),
            differentiators: z.array(z.string()).optional(),
            ctas: z.array(z.string()).optional(),
            keywords: z.array(z.string()).optional(),
            contentPillars: z.array(z.string()).optional(),
            competitors: z.array(z.string()).optional(),
            bestTimes: z.array(z.string()).optional().describe("e.g. [\"Tue 18:00\",\"Thu 12:30\"] local time"),
            language: z
              .enum(["en", "ur", "ur-roman", "ar"])
              .optional()
              .describe("Posting language: en = English; ur = Urdu script (Urdu voice + Nastaliq captions); ur-roman = Urdu voice with Roman Urdu on-screen text; ar = Modern Standard Arabic (Arabic voice ar_kareem + Naskh captions)."),
            voiceId: z
              .string()
              .optional()
              .describe("Optional narration voice for this brand: \"ur_fasih\" (male) or \"ur_aegis_female\" (female) for Urdu, or a Kokoro id (see list_voices if available). \"\" = default."),
          })
          .describe("Partial brand brain."),
      },
    },
    safe(async ({ brandId, brain }) => {
      const b = await fetchBrand(brandId);
      const merged = mergeBrain(b.brain, brain as Partial<BrandBrain>);
      const updated = await patch<Brand>(`/brands/${encodeURIComponent(brandId)}`, { brain: merged });
      return ok(`Updated brand brain for ${updated.name} (fields: ${Object.keys(brain).join(", ")}).`, updated.brain);
    }),
  );

  // ================= Assets & stock =================
  server.registerTool(
    "upload_asset",
    {
      title: "Upload local file as brand asset",
      description:
        "Add a local image/video/audio file (absolute path on this computer) to the brand's media library. Returns the asset id to use as scene mediaAssetId.",
      inputSchema: { brandId, path: z.string().min(1).describe("Absolute local file path, e.g. C:\\Users\\me\\Pictures\\product.jpg") },
    },
    safe(async ({ brandId, path: p }) => {
      const abs = path.resolve(p);
      if (!fs.existsSync(abs)) return fail(`File not found: ${abs}`);
      const a = await post<Asset>(`/brands/${encodeURIComponent(brandId)}/assets/from-path`, { path: abs });
      return ok(`Uploaded asset:\n${assetLine(a)}`, a);
    }),
  );

  server.registerTool(
    "list_assets",
    {
      title: "List brand assets",
      description: "List the brand's uploaded media (images, videos, audio) with ids and URLs.",
      inputSchema: { brandId, kind: z.enum(["image", "video", "audio"]).optional() },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ brandId, kind }) => {
      let assets = await get<Asset[]>(`/brands/${encodeURIComponent(brandId)}/assets`);
      if (kind) assets = assets.filter((a) => a.kind === kind);
      if (!assets.length) return ok("No assets. Use upload_asset (local file) or search_stock + add_stock_asset.", []);
      return ok(`${assets.length} asset(s):\n${assets.map(assetLine).join("\n")}`, assets);
    }),
  );

  server.registerTool(
    "search_stock",
    {
      title: "Search free stock footage/images",
      description:
        "Search free portrait stock videos or images (Pexels/Pixabay; needs an API key in Settings). Use add_stock_asset to import one into the brand library before using it in a scene.",
      inputSchema: {
        query: z.string().min(1).describe("Search terms, e.g. \"handmade jewelry closeup\"."),
        kind: z.enum(["video", "image"]).default("video"),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query, kind }) => {
      const res = await get<unknown>("/stock", { query, kind, orientation: "portrait" });
      const items = (Array.isArray(res) ? res : ((res as { results?: unknown[]; items?: unknown[] })?.results ?? (res as { items?: unknown[] })?.items ?? [])) as {
        id: string; kind: string; url: string; previewUrl: string; width: number; height: number; credit: string; source: string;
      }[];
      if (!items.length) return ok(`No ${kind} results for "${query}".`, res);
      return ok(
        `${items.length} ${kind} result(s) for "${query}":\n` +
          items.map((x) => `- ${x.id} ${x.width}x${x.height} ${x.source} (${x.credit}) url: ${x.url} preview: ${x.previewUrl}`).join("\n"),
        items,
      );
    }),
  );

  server.registerTool(
    "add_stock_asset",
    {
      title: "Import stock item into brand assets",
      description: "Download a stock video/image URL (from search_stock) into the brand's media library. Returns an asset id usable as mediaAssetId.",
      inputSchema: { brandId, url: z.string().url().describe("The stock item's url from search_stock."), kind: z.enum(["video", "image"]) },
    },
    safe(async ({ brandId, url, kind }) => {
      const a = await post<Asset>(`/brands/${encodeURIComponent(brandId)}/assets/from-stock`, { url, kind }, 300_000);
      return ok(`Imported stock asset:\n${assetLine(a)}`, a);
    }),
  );

  server.registerTool(
    "list_voices",
    {
      title: "List voiceover voices",
      description: "List the free local Kokoro TTS voices available for auto-voiceover (the active voice is set in app Settings).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const voices = await get<{ id: string; name: string; gender: string; accent: string }[] | { voices: { id: string; name: string; gender: string; accent: string }[] }>("/voices");
      const list = Array.isArray(voices) ? voices : (voices.voices ?? []);
      return ok(`${list.length} voice(s):\n${list.map((v) => `- ${v.id}: ${v.name} (${v.gender}, ${v.accent})`).join("\n")}`, voices);
    }),
  );

  // ================= Music =================
  server.registerTool(
    "list_music",
    {
      title: "List background music",
      description:
        "List background-music tracks: built-in royalty-free tracks (one per mood: calm, lofi, upbeat, inspiring, cinematic, playful, elegant, focus), files in data/music/library and audio assets uploaded to the brand. With auto-music on (default), every reel/story gets a mood-matched track automatically; use set_post_music to change or remove it.",
      inputSchema: { brandId: z.string().optional().describe("Also list this brand's uploaded audio assets (omit = all brands).") },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ brandId }) => {
      const tracks = await get<MusicTrack[]>(`/music${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ""}`);
      const line = (t: MusicTrack) =>
        `- ${t.id}: ${t.name}${t.mood ? ` [${t.mood}]` : ""} (${t.source}${t.durationSec ? `, ${Math.round(t.durationSec)}s` : ""})${t.credit ? ` — credit: ${t.credit}` : ""}`;
      return ok(`${tracks.length} track(s):\n${tracks.map(line).join("\n")}`, tracks);
    }),
  );

  server.registerTool(
    "set_post_music",
    {
      title: "Set or remove a post's music",
      description:
        "Change the background music of a reel/story: a trackId from list_music, \"auto\" (mood-matched pick), or null to remove music (auto-music will then leave the post silent apart from the voice). Music is mixed under the voiceover and ducked while speaking. With render=true the audio of the existing video is re-mixed in seconds (or the post is re-rendered if needed).",
      inputSchema: {
        postId,
        trackId: z.string().nullable().optional().describe('Track id (e.g. "builtin:elegant"), "auto", or null to remove music. Omit to change only the volume.'),
        volume: z.number().min(0).max(1).optional().describe("Music level relative to the voice, 0–1 (default from Settings, 0.3)."),
        render: z.boolean().optional().describe("Apply now: re-mix/re-render the video (default false: applies on the next render)."),
      },
    },
    safe(async ({ postId, trackId, volume, render }) => {
      const p = await post<Post>(`/posts/${encodeURIComponent(postId)}/music`, stripUndefined({ trackId, volume, render }));
      const m = (p.spec as { music?: { trackId?: string; src: string; volume?: number } }).music;
      const what = m ? `Music: ${m.trackId ?? m.src}${m.volume !== undefined ? ` at ${Math.round(m.volume * 100)}%` : ""}` : "Music removed";
      return ok(`${what}.\n${postLine(p)}${render ? "\n\nIf the status is rendering, call wait_for_render." : ""}`, slimPost(p));
    }),
  );

  // ================= Audit =================
  server.registerTool(
    "run_audit",
    {
      title: "Run growth audit",
      description: "Run a growth audit for the brand (strengths, weaknesses, opportunities, first 3 reels to make). Takes up to ~30–60s.",
      inputSchema: { brandId },
    },
    safe(async ({ brandId }) => {
      const a = await post<Audit>(`/brands/${encodeURIComponent(brandId)}/audit`, {}, 240_000);
      return ok(auditText(a), a);
    }),
  );

  server.registerTool(
    "get_latest_audit",
    {
      title: "Get latest audit",
      description: "Get the most recent growth audit for the brand.",
      inputSchema: { brandId },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ brandId }) => {
      const list = await get<Audit[]>(`/brands/${encodeURIComponent(brandId)}/audits`);
      if (!list.length) return ok("No audits yet — run run_audit.", null);
      return ok(auditText(list[0]), list[0]);
    }),
  );

  // ================= Styles / templates =================
  server.registerTool(
    "list_styles",
    {
      title: "List styles",
      description: "List reel/carousel/story visual styles and caption styles (ids to pass as style / captionStyle), plus HyperFrames HTML templates.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const s = await get<StylesResponse>("/styles");
      const text = [
        `Styles (${s.styles.length}):`,
        ...s.styles.map((x) => `- ${x.id}: ${x.name} — ${x.description} [${x.supports.join("/")}] ${x.tags?.length ? `(${x.tags.join(", ")})` : ""}`),
        "",
        `Caption styles (${s.captionStyles.length}):`,
        ...s.captionStyles.map((c) => `- ${c.id}: ${c.name} — ${c.description}`),
        ...(s.htmlTemplates?.length
          ? ["", `HTML templates (HyperFrames, ${s.htmlTemplates.length}):`, ...s.htmlTemplates.map((t) => `- ${t.id}: ${t.name} — ${t.description}`)]
          : []),
      ].join("\n");
      return ok(text, s);
    }),
  );

  server.registerTool(
    "list_html_templates",
    {
      title: "List HyperFrames HTML templates",
      description: "List the brand-able HyperFrames (HTML + GSAP) reel templates for create_reel_from_html_template.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const s = await get<StylesResponse>("/styles");
      const t = s.htmlTemplates ?? [];
      if (!t.length) return ok("No HTML templates available (HyperFrames engine not installed on the server?).", []);
      return ok(`${t.length} HTML template(s):\n${t.map((x) => `- ${x.id}: ${x.name} — ${x.description}${x.tags?.length ? ` (${x.tags.join(", ")})` : ""}`).join("\n")}`, t);
    }),
  );

  // ================= Planning & creation =================
  server.registerTool(
    "plan_content",
    {
      title: "Plan content",
      description:
        "Let the server auto-plan draft posts for the brand (scheduled at the brand's best times) and queue renders. Good for a quick batch; for higher-quality custom content write it yourself with create_reel / create_carousel / create_story.",
      inputSchema: {
        brandId,
        reels: z.number().int().min(0).max(20).optional().describe("Number of reels (default 3)."),
        carousels: z.number().int().min(0).max(20).optional(),
        stories: z.number().int().min(0).max(20).optional(),
        images: z.number().int().min(0).max(20).optional().describe("Single-image feed posts (designed 4:5 graphics: tip, quote, poll, product, fact…). For one specific image post use create_image_post."),
        startDate: isoDate.optional().describe("First day to schedule from (ISO)."),
        render: z.boolean().optional().describe("Queue renders right away (default true)."),
      },
    },
    safe(async ({ brandId, render, ...rest }) => {
      const posts = await post<Post[]>(`/brands/${encodeURIComponent(brandId)}/plan`, { ...stripUndefined(rest), render: render ?? true }, 300_000);
      return ok(`Planned ${posts.length} post(s):\n${posts.map(postLine).join("\n")}\n\n${READY_HINT}`, posts.map(slimPost));
    }),
  );

  server.registerTool(
    "create_reel",
    {
      title: "Create reel (Remotion)",
      description: [
        "Write a full Instagram reel yourself and queue its render. The brand's colors, name, handle and logo are filled in automatically from the brand brain.",
        "Guidelines: hook in the first 1.5s (scene 1 headline = the hook, ≤2s); 5–7 scenes; one idea per scene; short headlines.",
        "ALWAYS fill every scene's voiceoverText (the server auto-generates a free Kokoro voiceover + word-timed captions from it and fits scene durations to the narration) and ALWAYS set captionStyle (see list_styles).",
        "End with a cta that has a comment keyword (e.g. \"Comment GROW\") and create a matching automation.",
        "Respect the brand brain's voice and claimsToAvoid. Read the social-mcp://guides/reelspec resource for the full guide.",
      ].join(" "),
      inputSchema: {
        brandId,
        title: z.string().describe("Internal title for the post."),
        hook: z.string().describe("The scroll-stopping hook line (also scene 1 headline usually)."),
        caption: z.string().describe("Instagram caption WITHOUT hashtags."),
        hashtags,
        style: z.string().describe("Style id from list_styles (must support reel)."),
        captionStyle: z.string().optional().describe("Caption style id from list_styles — always set one for burned-in captions."),
        scenes: z.array(sceneSchema).min(1).max(15).describe("5–7 scenes recommended."),
        language: z.enum(["en", "ur", "ur-roman", "ar"]).optional().describe("Language of THIS post (overrides the brand's): en, ur (Urdu script), ur-roman, ar (Modern Standard Arabic — Arabic voice + Naskh captions; write voiceoverText and headlines in Arabic script)."),
        cta: cta.optional(),
        musicUrl: z.string().optional().describe("Optional http(s) URL of background music."),
        scheduledAt: isoDate.optional().describe("Proposed publish time. Posting still requires the user's approval."),
      },
    },
    safe(async (a) => createReelLike("reel", a)),
  );

  server.registerTool(
    "create_story",
    {
      title: "Create story (Remotion)",
      description:
        "Write an Instagram story (9:16 video, 1–4 short scenes, ~5–15s total) and queue its render. Brand styling is filled in automatically. Fill voiceoverText per scene and set captionStyle as for reels.",
      inputSchema: {
        brandId,
        title: z.string(),
        hook: z.string().optional(),
        caption: z.string().optional().describe("Optional (stories have no caption on IG, kept for reference)."),
        hashtags: hashtags.optional(),
        style: z.string().describe("Style id from list_styles (must support story)."),
        captionStyle: z.string().optional(),
        scenes: z.array(sceneSchema).min(1).max(6),
        language: z.enum(["en", "ur", "ur-roman", "ar"]).optional().describe("Language of THIS post (overrides the brand's): en, ur (Urdu script), ur-roman, ar (Modern Standard Arabic — Arabic voice + Naskh captions; write voiceoverText and headlines in Arabic script)."),
        cta: cta.optional(),
        musicUrl: z.string().optional(),
        scheduledAt: isoDate.optional(),
      },
    },
    safe(async (a) => createReelLike("story", { ...a, hook: a.hook ?? a.title, caption: a.caption ?? "", hashtags: a.hashtags ?? [] })),
  );

  server.registerTool(
    "create_carousel",
    {
      title: "Create carousel",
      description:
        "Write an Instagram carousel (2–10 slides, 1080x1350) and queue its render to PNGs. Slide 1 = hook, middle slides = value, last slide = CTA. Brand styling is automatic.",
      inputSchema: {
        brandId,
        title: z.string(),
        hook: z.string().optional(),
        caption: z.string().describe("Instagram caption WITHOUT hashtags."),
        hashtags,
        style: z.string().describe("Style id from list_styles that supports carousel."),
        slides: z.array(slideSchema).min(2).max(10),
        scheduledAt: isoDate.optional(),
      },
    },
    safe(async (a) => {
      const err = await validateStyle(a.style, "carousel").catch(() => undefined);
      if (err) return fail(err);
      const brand = await fetchBrand(a.brandId);
      const spec = await buildCarouselSpec({ brand, style: a.style, slides: a.slides });
      const p = await post<Post>("/posts", {
        brandId: a.brandId,
        type: "carousel",
        title: a.title,
        hook: a.hook ?? a.slides[0].headline,
        caption: a.caption,
        hashtags: cleanTags(a.hashtags),
        spec,
        scheduledAt: a.scheduledAt,
        render: true,
      });
      return ok(`Created carousel (${spec.slides.length} slides):\n${postLine(p)}\n\n${READY_HINT}`, slimPost(p));
    }),
  );

  server.registerTool(
    "create_html_reel",
    {
      title: "Create reel from custom HTML (HyperFrames)",
      description:
        "Author a fully custom reel as a HyperFrames HTML+GSAP composition (1080x1920, 30fps) and queue its render. Read the social-mcp://guides/hyperframes resource first. Assets listed here are downloaded next to index.html and referenced as ./assets/<name>.",
      inputSchema: {
        brandId,
        html: z.string().min(20).describe("Full index.html contents of the HyperFrames composition."),
        durationSec: z.number().min(1).max(90),
        title: z.string(),
        hook: z.string(),
        caption: z.string().describe("Instagram caption WITHOUT hashtags."),
        hashtags,
        assets: z
          .array(z.object({ name: z.string().describe("File name, e.g. product.jpg"), src: z.string().describe("http(s) URL (e.g. an asset url from list_assets)") }))
          .optional(),
        type: z.enum(["reel", "story"]).optional().describe("Default reel."),
        scheduledAt: isoDate.optional(),
      },
    },
    safe(async (a) => {
      const brand = await fetchBrand(a.brandId);
      const spec = buildHtmlReelSpec({ brand, html: a.html, durationSec: a.durationSec, assets: a.assets });
      const p = await post<Post>("/posts", {
        brandId: a.brandId,
        type: a.type ?? "reel",
        title: a.title,
        hook: a.hook,
        caption: a.caption,
        hashtags: cleanTags(a.hashtags),
        spec,
        scheduledAt: a.scheduledAt,
        render: true,
      });
      return ok(`Created HTML reel:\n${postLine(p)}\n\n${READY_HINT}`, slimPost(p));
    }),
  );

  server.registerTool(
    "create_reel_from_html_template",
    {
      title: "Create reel from HyperFrames template",
      description:
        "Build a reel from a brand-able HyperFrames HTML template (see list_html_templates) with your scenes and CTA; the server brands it and queues the render. Fill voiceoverText on scenes.",
      inputSchema: {
        brandId,
        templateId: z.string().describe("Template id from list_html_templates."),
        scenes: z.array(sceneSchema).min(1).max(15),
        cta: cta.optional(),
        title: z.string().optional(),
        hook: z.string().optional(),
        caption: z.string().optional(),
        hashtags: hashtags.optional(),
        scheduledAt: isoDate.optional(),
      },
    },
    safe(async (a) => {
      const scenes = await buildScenes(a.brandId, a.scenes);
      const p = await post<Post>(
        `/brands/${encodeURIComponent(a.brandId)}/html-reel-from-template`,
        stripUndefined({
          templateId: a.templateId,
          scenes,
          cta: a.cta,
          title: a.title,
          hook: a.hook,
          caption: a.caption,
          hashtags: a.hashtags ? cleanTags(a.hashtags) : undefined,
          scheduledAt: a.scheduledAt,
          render: true,
        }),
      );
      return ok(`Created reel from template ${a.templateId}:\n${postLine(p)}\n\n${READY_HINT}`, slimPost(p));
    }),
  );

  // ================= Posts =================
  server.registerTool(
    "list_posts",
    {
      title: "List posts",
      description: "List posts, optionally filtered by brand, status (draft, rendering, ready, changes_requested, approved, publishing, posted, failed) and type.",
      inputSchema: {
        brandId: brandId.optional(),
        status: z.enum(["draft", "rendering", "ready", "changes_requested", "approved", "publishing", "posted", "failed"]).optional(),
        type: z.enum(["reel", "carousel", "story", "image"]).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async (q) => {
      const posts = await get<Post[]>("/posts", q);
      if (!posts.length) return ok("No posts match.", []);
      return ok(`${posts.length} post(s):\n${posts.map(postLine).join("\n")}`, posts.map(slimPost));
    }),
  );

  server.registerTool(
    "get_post",
    {
      title: "Get post",
      description: "Get one post with full details, its render spec, rendered media URLs and status.",
      inputSchema: { postId },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ postId }) => {
      const p = await get<Post>(`/posts/${encodeURIComponent(postId)}`);
      return ok(postDetail(p), p);
    }),
  );

  server.registerTool(
    "wait_for_render",
    {
      title: "Wait for render",
      description:
        "Poll a post until its render is ready or failed (default timeout 300s). Then show the user the media URL and ask whether to approve, change, or skip it.",
      inputSchema: { postId, timeoutSec: z.number().int().min(5).max(1800).default(300) },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ postId, timeoutSec }, extra: Extra) => {
      const { post: p, timedOut } = await waitForPost(postId, timeoutSec ?? 300, extra);
      if (timedOut) return ok(`Still ${p.status} after ${timeoutSec}s (${Math.round((p.renderProgress ?? 0) * 100)}%). Call wait_for_render again.\n${postLine(p)}`, slimPost(p));
      if (p.status === "failed") return fail(`Render failed for ${p.id}: ${p.error ?? "unknown error"}`);
      if (p.status === "draft") return ok(`Post ${p.id} is a draft and is not rendering. Use update_post with render or ask the server to render it.\n${postLine(p)}`, slimPost(p));
      return ok(
        `${postDetail(p)}\n\nShow the user the media above and ask: approve (and when), request a change, or skip. Only call approve_post after an explicit yes.`,
        slimPost(p),
      );
    }),
  );

  server.registerTool(
    "request_change",
    {
      title: "Request change",
      description: "Send revision feedback for a post (e.g. \"make the hook punchier, use green\"); the server revises the spec and re-renders. Then use wait_for_render.",
      inputSchema: { postId, text: z.string().min(1).describe("What to change, in plain words.") },
    },
    safe(async ({ postId, text }) => {
      const p = await post<Post>(`/posts/${encodeURIComponent(postId)}/change`, { text }, 180_000);
      return ok(`Change requested — ${postLine(p)}\nNext: wait_for_render.`, slimPost(p));
    }),
  );

  server.registerTool(
    "update_post",
    {
      title: "Update post",
      description:
        "Edit a post's title, hook, caption, hashtags, schedule, or full spec (pass the complete spec object from get_post, modified). Set rerender=true to re-render after a spec change. Editing an APPROVED post sends it back to 'ready' (needs the user's approval again): approval is tied to the exact words, media and time that were approved.",
      inputSchema: {
        postId,
        title: z.string().optional(),
        hook: z.string().optional(),
        caption: z.string().optional(),
        hashtags: hashtags.optional(),
        scheduledAt: isoDate.optional(),
        spec: z.record(z.string(), z.unknown()).optional().describe("Complete replacement ReelSpec / CarouselSpec / HtmlReelSpec."),
        rerender: z.boolean().optional().describe("Queue a re-render after updating (default: true if spec changed)."),
      },
    },
    safe(async ({ postId, rerender, hashtags, ...rest }) => {
      const body = stripUndefined({ ...rest, hashtags: hashtags ? cleanTags(hashtags) : undefined });
      let p = await patch<Post>(`/posts/${encodeURIComponent(postId)}`, body);
      if (rerender ?? !!rest.spec) p = await post<Post>(`/posts/${encodeURIComponent(postId)}/render`);
      return ok(`Updated:\n${postLine(p)}${(rerender ?? !!rest.spec) ? "\nRe-render queued — use wait_for_render." : ""}`, slimPost(p));
    }),
  );

  server.registerTool(
    "approve_post",
    {
      title: "Approve post (schedule)",
      description:
        "Approve a rendered post so it auto-publishes to Instagram at scheduledAt (or the next best time slot). ONLY call after the user has explicitly approved this specific post in the conversation.",
      inputSchema: { postId, scheduledAt: isoDate.optional(), userConfirmed },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    safe(async ({ postId, scheduledAt, userConfirmed }) => {
      if (userConfirmed !== true) return fail("Not approved: ask the user to explicitly approve this post first, then call again with userConfirmed=true.");
      const p = await post<Post>(`/posts/${encodeURIComponent(postId)}/approve`, stripUndefined({ scheduledAt }));
      return ok(`Approved — will publish at ${p.scheduledAt ?? "the next best time"}.\n${postLine(p)}`, slimPost(p));
    }),
  );

  server.registerTool(
    "publish_now",
    {
      title: "Publish now to Instagram",
      description:
        "Immediately publish a rendered post to the brand's Instagram account. Public and irreversible — ONLY call after the user explicitly asked to post this specific post now.",
      inputSchema: { postId, userConfirmed },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    safe(async ({ postId, userConfirmed }) => {
      if (userConfirmed !== true) return fail("Not published: ask the user to explicitly confirm posting this now, then call again with userConfirmed=true.");
      const p = await post<Post>(`/posts/${encodeURIComponent(postId)}/publish`, {}, 600_000);
      return ok(`Publish result:\n${postLine(p)}`, slimPost(p));
    }),
  );

  server.registerTool(
    "delete_post",
    {
      title: "Delete post",
      description: "Delete a post (draft or rendered) from Social MCP Studio. Does not delete anything already on Instagram. Confirm with the user first.",
      inputSchema: { postId },
      annotations: { destructiveHint: true },
    },
    safe(async ({ postId }) => {
      await del(`/posts/${encodeURIComponent(postId)}`);
      return ok(`Deleted post ${postId}.`);
    }),
  );

  server.registerTool(
    "get_calendar",
    {
      title: "Get content calendar",
      description: "List posts scheduled in a date range (default: today through the next 14 days).",
      inputSchema: { brandId: brandId.optional(), from: isoDate.optional(), to: isoDate.optional() },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ brandId, from, to }) => {
      const f = from ?? new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      const t = to ?? new Date(Date.now() + 14 * 86400_000).toISOString();
      const posts = await get<Post[]>("/calendar", { brandId, from: f, to: t });
      const sorted = [...posts].sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
      if (!sorted.length) return ok(`Nothing scheduled between ${f} and ${t}.`, []);
      return ok(`Calendar ${f} → ${t}:\n${sorted.map(postLine).join("\n")}`, sorted.map(slimPost));
    }),
  );

  // ================= Instagram =================
  server.registerTool(
    "connect_instagram_url",
    {
      title: "Get Instagram connect link",
      description:
        "Get the Instagram Login OAuth URL for a brand. Give the link to the user to open in their browser and log in themselves; never ask for their password or token.",
      inputSchema: { brandId },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ brandId }) => {
      const r = await get<{ url: string }>("/instagram/auth-url", { brandId });
      return ok(`Ask the user to open this link and log in to Instagram to connect the account:\n${r.url}`, r);
    }),
  );

  server.registerTool(
    "instagram_insights",
    {
      title: "Instagram insights",
      description: "Get followers, media count and recent posts (likes, comments, permalinks) for a connected brand.",
      inputSchema: { brandId },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ brandId }) => {
      const r = await get<{ followers?: number; mediaCount?: number; recent: { id: string; caption: string; likeCount: number; commentsCount: number; permalink: string; timestamp: string }[] }>(
        `/brands/${encodeURIComponent(brandId)}/instagram/insights`,
      );
      const text = [
        `Followers: ${r.followers ?? "?"} | Media: ${r.mediaCount ?? "?"}`,
        ...(r.recent ?? []).map((m) => `- ${m.timestamp} ♥${m.likeCount} 💬${m.commentsCount} ${m.permalink} — ${(m.caption ?? "").slice(0, 80)}`),
      ].join("\n");
      return ok(text, r);
    }),
  );

  // ================= Automations =================
  server.registerTool(
    "list_automations",
    {
      title: "List comment→DM automations",
      description: "List the brand's comment-keyword automations (public reply + private DM).",
      inputSchema: { brandId },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ brandId }) => {
      const list = await get<Automation[]>(`/brands/${encodeURIComponent(brandId)}/automations`);
      if (!list.length) return ok("No automations yet.", []);
      return ok(`${list.length} automation(s):\n${list.map(automationLine).join("\n")}`, list);
    }),
  );

  server.registerTool(
    "create_automation",
    {
      title: "Create comment→DM automation",
      description:
        "When someone comments the keyword (case-insensitive) on the brand's posts, reply publicly and send them a DM (with optional link). The exact reply and DM wording must be shown to the user and approved before this is called (userConfirmed=true); the server records who created it.",
      inputSchema: {
        brandId,
        userConfirmed,
        keyword: z.string().min(1).describe("e.g. GROW"),
        replyText: z.string().describe("Public comment reply, e.g. \"Sent you a DM! 📩\""),
        dmText: z.string().describe("Private DM text."),
        link: z.string().optional().describe("Link included in the DM."),
        postId: z.string().optional().describe("Limit to one post (omit = all posts)."),
        enabled: z.boolean().optional(),
      },
    },
    safe(async ({ brandId, userConfirmed, ...body }) => {
      if (userConfirmed !== true) return fail("Not approved: show the user the exact reply and DM text, get an explicit yes, then call again with userConfirmed=true.");
      const a = await post<Automation>(`/brands/${encodeURIComponent(brandId)}/automations`, stripUndefined(body));
      return ok(`Created automation:\n${automationLine(a)}`, a);
    }),
  );

  server.registerTool(
    "delete_automation",
    {
      title: "Delete automation",
      description: "Delete a comment→DM automation by id.",
      inputSchema: { automationId: z.string().min(1) },
      annotations: { destructiveHint: true },
    },
    safe(async ({ automationId }) => {
      await del(`/automations/${encodeURIComponent(automationId)}`);
      return ok(`Deleted automation ${automationId}.`);
    }),
  );

  server.registerTool(
    "get_comment_log",
    {
      title: "Get comment log",
      description: "Recent Instagram comments the automation poller has seen, with keyword matches and whether reply/DM were sent.",
      inputSchema: { brandId, limit: z.number().int().min(1).max(500).default(50) },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ brandId, limit }) => {
      const list = (await get<CommentLog[]>(`/brands/${encodeURIComponent(brandId)}/comments`)).slice(0, limit ?? 50);
      if (!list.length) return ok("No comments logged yet.", []);
      return ok(`${list.length} comment(s):\n${list.map(commentLine).join("\n")}`, list);
    }),
  );
}

// ---------- helpers ----------
type ReelArgs = {
  brandId: string;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  style: string;
  captionStyle?: string;
  scenes: z.infer<typeof sceneSchema>[];
  cta?: { text: string; keyword?: string };
  musicUrl?: string;
  scheduledAt?: string;
  language?: string;
};

async function createReelLike(type: "reel" | "story", a: ReelArgs) {
  const err = await validateStyle(a.style, type, a.captionStyle).catch(() => undefined);
  if (err) return fail(err);
  const brand = await fetchBrand(a.brandId);
  const scenes = await buildScenes(a.brandId, a.scenes);
  const spec = buildReelSpec({ brand, style: a.style, captionStyle: a.captionStyle, scenes, cta: a.cta, musicUrl: a.musicUrl });
  if (a.language) (spec as { language?: string }).language = a.language;
  const p = await post<Post>("/posts", {
    brandId: a.brandId,
    type,
    title: a.title,
    hook: a.hook,
    caption: a.caption,
    hashtags: cleanTags(a.hashtags),
    spec,
    scheduledAt: a.scheduledAt,
    render: true,
  });
  const total = scenes.reduce((s, x) => s + x.durationSec, 0);
  const warn = scenes.some((s) => !s.voiceoverText) ? "\nNote: some scenes have no voiceoverText (no narration/captions for them)." : "";
  return ok(`Created ${type} (${scenes.length} scenes, ~${total.toFixed(1)}s):\n${postLine(p)}${warn}\n\n${READY_HINT}`, slimPost(p));
}

/** Post without the (possibly large) spec, for list outputs. */
function slimPost(p: Post) {
  const { spec, changeRequests, ...rest } = p;
  return { ...rest, changeRequests: changeRequests?.length ?? 0, specStyle: (spec as { style?: string; engine?: string })?.style ?? (spec as { engine?: string })?.engine };
}
