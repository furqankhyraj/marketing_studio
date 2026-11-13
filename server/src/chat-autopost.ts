// Chat tools + no-key rules for image posts and autopilot. Tools are appended to chat-tools.ts buildTools().
// Self-contained (no import of chat-tools.ts / chat-rules.ts, to keep module init order simple).
import type { Brand, ImageDesign, Post } from "../../shared/types.ts";
import type { ChatTool, ToolResult } from "./chat-agent.ts";
import * as db from "./db.ts";
import { nowIso } from "./config.ts";
import { enqueueRender } from "./render.ts";
import { getStyles } from "./engines.ts";
import { IMAGE_DESIGNS, IMAGE_DESIGN_INFO, imageDetail, imageHeuristicChange, isImageSpec, normalizeImageSpec } from "./imagepost.ts";
import { createImagePost } from "./autopost-routes.ts";
import { autopilotDigest, autopilotOf, autopilotStatus, runAutopilot, setAutopilot, FORMATS } from "./autopilot.ts";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required });
const brandIdS = { type: "string", description: "Brand id (from list_brands)." };
const line = (p: Post) => `- ${p.id} [${p.type}, ${p.status}] "${p.title}" — ${p.scheduledAt ?? "unscheduled"}, rev ${p.revision}`;
const link = (p: Post) => ({ label: p.title.length > 40 ? p.title.slice(0, 38) + "…" : p.title, postId: p.id });
function brandOr(id: unknown): Brand {
  const b = db.getBrand(String(id ?? ""));
  if (!b) throw Object.assign(new Error("Brand not found — call list_brands for ids"), { status: 404 });
  return b;
}
function postOr(id: unknown): Post {
  const p = db.getPost(String(id ?? ""));
  if (!p) throw Object.assign(new Error("Post not found"), { status: 404 });
  return p;
}

const imageFields = {
  design: { type: "string", enum: IMAGE_DESIGNS, description: IMAGE_DESIGNS.map((d) => `${d}: ${IMAGE_DESIGN_INFO[d]}`).join(" | ") },
  eyebrow: { type: "string", description: "Small label above the headline (≤3 words)." },
  headline: { type: "string", description: "Main text (≤12 words; quotes ≤22)." },
  body: { type: "string" },
  bullets: { type: "array", items: { type: "string" }, description: "Tip steps, 2–4." },
  author: { type: "string" },
  rating: { type: "integer", minimum: 1, maximum: 5 },
  price: { type: "string" },
  oldPrice: { type: "string" },
  badge: { type: "string", description: "e.g. NEW, 20% OFF (only real offers)." },
  cta: { type: "string", description: "Footer / button line." },
  options: { type: "array", items: obj({ label: { type: "string" }, text: { type: "string" } }, ["text"]), description: "question: 2–3 options; before-after: [before, after]." },
  style: { type: "string", description: "Style id from list_styles (background, fonts, decoration)." },
};

const SET_AP_PROPS = {
  brandId: brandIdS,
  enabled: { type: "boolean" },
  reels: { type: "integer", minimum: 0, maximum: 14, description: "Reels per week." },
  carousels: { type: "integer", minimum: 0, maximum: 14 },
  images: { type: "integer", minimum: 0, maximum: 14, description: "Single-image feed posts per week." },
  stories: { type: "integer", minimum: 0, maximum: 14 },
  leadDays: { type: "integer", minimum: 1, maximum: 21, description: "Keep this many days ahead filled (default 7)." },
  pillars: { type: "array", items: { type: "string" }, description: "Content pillars to rotate (default: the brand brain's)." },
  occasions: { type: "boolean", description: "Use the built-in occasion calendar (Eid, Black Friday…)." },
};

function apText(b: Brand): string {
  const ap = autopilotOf(b);
  const st = autopilotStatus(b);
  const per = FORMATS.map((f) => `${ap.postsPerWeek[f]} ${f === "story" ? (ap.postsPerWeek[f] === 1 ? "story" : "stories") : f + (ap.postsPerWeek[f] === 1 ? "" : "s")}`).join(", ");
  return [
    `Autopilot for ${b.name}: ${ap.enabled ? "ON" : "off"} · ${per} per week · approval ${ap.approval === "auto" ? "AUTO (posts publish without review)" : "manual (you approve each post)"} · keeps ${ap.leadDays} days filled`,
    `Next ${ap.leadDays} days: ${FORMATS.map((f) => `${f} ${st.scheduled[f]}/${st.targets[f]}`).join(", ")}`,
    st.occasions.length ? `Occasions in window: ${st.occasions.map((o) => `${o.name} (${o.date})`).join(", ")}` : "",
    ap.lastRunAt ? `Last run ${ap.lastRunAt}: ${ap.lastResult ?? ""}` : "Not run yet.",
  ]
    .filter(Boolean)
    .join("\n");
}

function apPatch(a: any) {
  const ppw: Record<string, number> = {};
  if (a.reels !== undefined) ppw.reel = a.reels;
  if (a.carousels !== undefined) ppw.carousel = a.carousels;
  if (a.images !== undefined) ppw.image = a.images;
  if (a.stories !== undefined) ppw.story = a.stories;
  return { enabled: a.enabled, leadDays: a.leadDays, pillars: a.pillars, occasions: a.occasions, ...(Object.keys(ppw).length ? { postsPerWeek: ppw } : {}) };
}

export function autopostChatTools(): ChatTool[] {
  return [
    {
      name: "create_image_post",
      description:
        "Create a single-image Instagram feed post (designed 1080x1350 graphic: quote, tip, product, offer, testimonial, question/poll, before-after, fact) and queue its render (a few seconds). Give headline (+fields) to write it yourself, or only design/topic to let the app write it. Never invent reviews, prices or statistics.",
      input_schema: obj(
        {
          brandId: brandIdS,
          ...imageFields,
          topic: { type: "string", description: "What it should be about (when you don't give a headline)." },
          title: { type: "string" },
          caption: { type: "string", description: "Instagram caption without hashtags." },
          hashtags: { type: "array", items: { type: "string" }, description: "Max 5, no #." },
          mediaAssetId: { type: "string", description: "Brand image asset id (list_assets) for product/offer designs." },
          scheduledAt: { type: "string", description: "ISO time; default = next best-time slot." },
        },
        ["brandId"],
      ),
      run: async (a) => {
        const p = await createImagePost(brandOr(a.brandId).id, a);
        return { ok: true, label: `Created image post “${p.title}”`, postIds: [p.id], links: [link(p)], brandId: p.brandId, text: `Created image post (${(p.spec as any).design}), render queued:\n${line(p)}` };
      },
    },
    {
      name: "update_image_post",
      description: "Precise text/design edits on an image post (headline, eyebrow, body, bullets, cta, options, author, price, badge, design, style, colors). Re-renders in a few seconds.",
      input_schema: obj(
        {
          postId: { type: "string" },
          ...imageFields,
          colors: obj({ primary: { type: "string" }, secondary: { type: "string" }, accent: { type: "string" }, background: { type: "string" }, text: { type: "string" } }),
        },
        ["postId"],
      ),
      run: async ({ postId, colors, ...fields }) => {
        const cur = postOr(postId);
        if (cur.type !== "image" || !isImageSpec(cur.spec)) return { ok: false, label: "Not an image post", text: "update_image_post only works on image posts — use update_post for reels/carousels." };
        if (["posted", "publishing"].includes(cur.status)) return { ok: false, label: "Already published", text: `This post is already ${cur.status}.` };
        const brand = brandOr(cur.brandId);
        const merged: any = { ...cur.spec };
        for (const [k, v] of Object.entries(fields)) if (v !== undefined) merged[k] = v;
        if (colors) merged.brand = { ...cur.spec.brand, colors: { ...cur.spec.brand.colors, ...colors } };
        const spec = normalizeImageSpec(merged, brand);
        const changed = Object.keys(fields).filter((k) => (fields as any)[k] !== undefined).concat(colors ? ["colors"] : []);
        if (!changed.length) return { ok: false, label: "Nothing changed", text: "No fields given." };
        db.updatePost(cur.id, (x: Post) => {
          x.spec = spec;
          if (fields.headline) x.hook = spec.headline;
          x.revision += 1;
          x.changeRequests.push({ text: `Chat edit: ${changed.join(", ")}`, createdAt: nowIso() });
        });
        const p = enqueueRender(cur.id)!;
        return { ok: true, label: `Revision ${p.revision}: ${changed.join(", ")}`, revision: p.revision, postIds: [p.id], links: [link(p)], text: `Changed ${changed.join(", ")}; re-render queued.\n${imageDetail(spec)}` };
      },
    },
    {
      name: "get_autopilot",
      description: "Show a brand's autopilot settings (posts per week per format, approval mode, lead days) and how full the upcoming schedule is.",
      input_schema: obj({ brandId: brandIdS }, ["brandId"]),
      run: async ({ brandId }) => {
        const b = brandOr(brandId);
        return { ok: true, label: `Autopilot ${autopilotOf(b).enabled ? "on" : "off"} for ${b.name}`, brandId: b.id, links: [{ label: "Autopilot", to: "/autopilot" }], text: apText(b) };
      },
    },
    {
      name: "set_autopilot",
      description:
        "Turn autopilot on/off for a brand and set posts per week (reels, carousels, images, stories), lead days, pillars. Approval stays MANUAL (posts wait for the user's yes); auto-approval is a separate, confirmed tool. When enabling, formats you don't mention keep their current values — pass 0 to switch a format off.",
      input_schema: obj(SET_AP_PROPS, ["brandId"]),
      run: async (a) => {
        const b = setAutopilot(brandOr(a.brandId).id, apPatch(a));
        return { ok: true, label: `Autopilot ${autopilotOf(b).enabled ? "on" : "off"} for ${b.name}`, brandId: b.id, links: [{ label: "Autopilot", to: "/autopilot" }], text: apText(b) + (autopilotOf(b).enabled ? "\nIt checks every 10 minutes and fills free best-time slots; new posts land on the Approve screen." : "") };
      },
    },
    {
      name: "set_autopilot_auto_approve",
      sensitive: true,
      describe: (i) => (i.enabled ? "Let autopilot approve posts automatically (they publish WITHOUT review)" : "Switch autopilot back to manual approval"),
      description: "Switch autopilot approval between automatic (posts are approved and published at their time without review) and manual. Needs the user's confirmation.",
      input_schema: obj({ brandId: brandIdS, enabled: { type: "boolean", description: "true = auto-approve, false = manual." } }, ["brandId", "enabled"]),
      run: async ({ brandId, enabled }) => {
        const b = setAutopilot(brandOr(brandId).id, { approval: enabled ? "auto" : "manual", acknowledgeAutoApprove: true });
        return { ok: true, label: enabled ? "Autopilot will auto-approve" : "Autopilot approval: manual", brandId: b.id, text: apText(b) };
      },
    },
    {
      name: "run_autopilot",
      description: "Run autopilot for a brand now (fills the upcoming schedule up to its weekly target). dryRun=true only shows what it would make.",
      input_schema: obj({ brandId: brandIdS, dryRun: { type: "boolean" } }, ["brandId"]),
      run: async ({ brandId, dryRun }) => {
        const b = brandOr(brandId);
        const r = await runAutopilot(b.id, { dryRun: !!dryRun, force: !!dryRun });
        const plan = r.plan.map((x) => `- ${x.type} at ${x.slot}${x.pillar ? ` · pillar “${x.pillar}”` : ""}${x.occasion ? ` · for ${x.occasion.name}` : ""}`).join("\n");
        return { ok: true, label: r.summary, brandId: b.id, postIds: r.created.map((p) => p.id), links: [...r.created.slice(0, 6).map(link), { label: "Approve", to: "/approve" }], text: `${r.summary}\n${dryRun ? plan : r.created.map(line).join("\n")}` };
      },
    },
    {
      name: "autopilot_digest",
      description: "Daily digest: what autopilot made today, what's waiting for approval, what's scheduled, upcoming occasions.",
      input_schema: obj({ brandId: brandIdS }),
      run: async ({ brandId }) => {
        const d = autopilotDigest(typeof brandId === "string" ? brandId : undefined);
        const text = d.brands
          .map((b) =>
            [
              `${b.brandName} — autopilot ${b.enabled ? "on" : "off"}${b.lastResult ? ` (${b.lastResult})` : ""}`,
              `  Made today: ${b.madeToday.map((p) => `“${p.title}”`).join(", ") || "nothing"}`,
              `  Waiting for your yes: ${b.waiting.length}${b.waiting.length ? ` — ${b.waiting.slice(0, 5).map((p) => `“${p.title}”`).join(", ")}` : ""}`,
              `  Scheduled: ${b.scheduled.length}${b.scheduled.length ? ` — next “${b.scheduled[0].title}” ${b.scheduled[0].scheduledAt}` : ""}`,
              b.upcomingOccasions.length ? `  Coming up: ${b.upcomingOccasions.map((o) => `${o.name} ${o.date}`).join(", ")}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n");
        return { ok: true, label: "Autopilot digest", links: [{ label: "Approve", to: "/approve" }, { label: "Home", to: "/" }], text: text || "No brands." };
      },
    },
  ];
}

// ---------------------------------------------------------------- rules (no API key)

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };
const toNum = (s: string) => (/^\d+$/.test(s) ? +s : NUM[s.toLowerCase()] ?? NaN);

/** "4 reels and 3 image posts" → {reels:4, images:3}. */
export function parseFormatCounts(lower: string): Partial<Record<"reels" | "carousels" | "images" | "stories", number>> {
  const out: Partial<Record<"reels" | "carousels" | "images" | "stories", number>> = {};
  const re = /\b(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\s+(?:more\s+|new\s+|short\s+|single[- ]?)?(reels?|carousels?|stor(?:y|ies)|(?:image|picture|photo|graphic|feed)(?:\s+posts?)?|quote cards?|tip cards?|polls?|posts?)\b/g;
  for (const m of lower.matchAll(re)) {
    const n = toNum(m[1]);
    if (isNaN(n)) continue;
    const w = m[2];
    const k = w.startsWith("reel") ? "reels" : w.startsWith("carousel") ? "carousels" : w.startsWith("stor") ? "stories" : /^(image|picture|photo|graphic|feed|quote|tip|poll)/.test(w) ? "images" : "reels";
    out[k] = (out[k] ?? 0) + Math.min(20, n);
  }
  return out;
}

const DESIGN_HINTS: [RegExp, ImageDesign][] = [
  [/\bquote\b/, "quote"],
  [/\btip\b/, "tip"],
  [/\bproduct|spotlight\b/, "product"],
  [/\b(offer|announcement|announce|sale|launch|promo)\b/, "offer"],
  [/\b(testimonial|review)\b/, "testimonial"],
  [/\b(poll|question|which one|this or that|a or b)\b/, "question"],
  [/\bbefore\b.*\bafter\b/, "before-after"],
  [/\b(did you know|fact)\b/, "fact"],
];

type One = (name: string, input: Record<string, unknown>, intro?: string) => Promise<{ text: string; actions: any[]; lastPostIds?: string[]; brandId?: string }>;

/**
 * Global-assistant rules for image posts and autopilot. Returns undefined when the message is about something else.
 * `one` runs a tool and formats the reply; `pending` builds a confirmation card for a sensitive tool.
 */
export async function autopostGlobalRule(
  text: string,
  brand: Brand | undefined,
  h: { one: One; needBrand: () => { text: string; actions: any[] }; pending: (name: string, input: Record<string, unknown>) => any },
): Promise<{ text: string; actions: any[]; lastPostIds?: string[]; brandId?: string } | undefined> {
  const lower = text.toLowerCase();
  // ----- autopilot -----
  if (/\bauto-?pilot\b/.test(lower)) {
    if (!brand) return h.needBrand();
    const counts = parseFormatCounts(lower);
    const wantsAuto = /\b(auto[- ]?approv\w*|without (my )?(review|approval)|publish automatically|post automatically|no approval)\b/.test(lower) && !/\b(don'?t|never|no)\s+(auto|publish)/.test(lower);
    const wantsManual = /\b(manual( approval)?|ask me first|i('ll| will) approve|with (my )?approval)\b/.test(lower);
    const off = /\b(turn off|switch off|disable|stop|pause)\b/.test(lower);
    const on = /\b(turn on|switch on|enable|start|activate|set up|setup)\b/.test(lower) || Object.keys(counts).length > 0;
    if (off) return h.one("set_autopilot", { brandId: brand.id, enabled: false });
    if (/\b(run|fill|top up)\b/.test(lower) && !on) return h.one("run_autopilot", { brandId: brand.id });
    if (/\b(digest|today|made)\b/.test(lower) && !on) return h.one("autopilot_digest", { brandId: brand.id });
    if (on || wantsAuto || wantsManual) {
      const input: Record<string, unknown> = { brandId: brand.id, enabled: true };
      if (Object.keys(counts).length) for (const k of ["reels", "carousels", "images", "stories"]) input[k] = (counts as any)[k] ?? 0;
      const days = lower.match(/\b(\d{1,2})\s*days?\s*(ahead|in advance|lead)/)?.[1];
      if (days) input.leadDays = +days;
      const r = await h.one("set_autopilot", input, `Autopilot for ${brand.name}:`);
      if (wantsAuto) {
        return { ...r, text: `${r.text}\n\nYou asked for automatic approval — that means posts publish WITHOUT you reviewing them. Press Confirm only if you're sure.`, actions: [...r.actions, h.pending("set_autopilot_auto_approve", { brandId: brand.id, enabled: true })] };
      }
      if (wantsManual && autopilotOf(brand).approval === "auto") return { ...r, actions: [...r.actions, h.pending("set_autopilot_auto_approve", { brandId: brand.id, enabled: false })] };
      return r;
    }
    return h.one("get_autopilot", { brandId: brand.id });
  }
  // ----- image posts -----
  const imageWords = /\b(image|picture|photo|graphic|feed|single[- ]image)\s+posts?\b|\bquote cards?\b|\btip cards?\b|\bpoll posts?\b|\b(did you know|before[- ]and[- ]after|before\/after) posts?\b|\bimage posts?\b/;
  if (imageWords.test(lower) && /\b(make|create|generate|design|write|plan|add|do|need|want)\b/.test(lower)) {
    if (!brand) return h.needBrand();
    const counts = parseFormatCounts(lower);
    const n = counts.images ?? 1;
    const others = (counts.reels ?? 0) + (counts.carousels ?? 0) + (counts.stories ?? 0);
    const render = !/\b(no render|don'?t render|drafts? only|just drafts?)\b/.test(lower);
    if (n > 1 || others > 0 || /\bplan\b/.test(lower)) {
      return h.one("plan_content", { brandId: brand.id, reels: counts.reels ?? 0, carousels: counts.carousels ?? 0, stories: counts.stories ?? 0, images: n, render }, `On it — planning for ${brand.name}.`);
    }
    const design = DESIGN_HINTS.find(([re]) => re.test(lower))?.[1];
    const topic = text.match(/\b(?:about|on|for)\s+(?!saqqa|the brand)(.{3,80}?)(?:[.!?]|$)/i)?.[1];
    const quoted = text.match(/["“]([^"”]{3,140})["”]/)?.[1];
    return h.one("create_image_post", { brandId: brand.id, design, topic: quoted ? undefined : topic, headline: quoted, render }, `Making an image post for ${brand.name}.`);
  }
  return undefined;
}

/** Post-chat rules for image posts. Returns undefined when nothing image-specific was understood. */
export async function imagePostRule(post: Post, text: string): Promise<{ text: string; changes: string[]; revision: number } | undefined> {
  if (post.type !== "image" || !isImageSpec(post.spec)) return undefined;
  if (["posted", "publishing"].includes(post.status)) return undefined;
  // caption / hashtag / schedule edits are handled by the generic post rules
  if (/\b(instagram\s+)?caption\b|hashtags?\b|\bschedule|\breschedule|\bapprove|\bpublish/.test(text.toLowerCase())) return undefined;
  const { styles } = await getStyles();
  const r = imageHeuristicChange(post, text, styles);
  if (!r.changed.length) return undefined;
  const brand = db.getBrand(post.brandId)!;
  const spec = normalizeImageSpec(r.spec, brand);
  db.updatePost(post.id, (x: Post) => {
    x.spec = spec;
    Object.assign(x, r.meta);
    x.revision += 1;
    x.changeRequests.push({ text, createdAt: nowIso() });
  });
  const p = enqueueRender(post.id)!;
  return { text: `Done — ${r.changed.join(", ")}. Re-rendering as revision ${p.revision} (images take a few seconds).`, changes: r.changed, revision: p.revision };
}

