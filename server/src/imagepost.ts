// Single-image feed posts (Post.type "image", ImageSpec): normalization, heuristic + LLM ideas, render dispatch,
// rule-based change requests and chat helpers. Rendering is a Remotion still (renderer renderImagePost → image.jpg).
import type { Brand, BrandBrain, ImageDesign, ImageOption, ImageSpec, MediaRef, Post, StyleMeta } from "../../shared/types.ts";
import { brandStyleRef, ensureBrain, isHex } from "./brain.ts";
import { listAssets } from "./db.ts";
import { askJson, llmAvailable } from "./llm.ts";
import { loadRenderer } from "./engines.ts";
import { fileUrlFor } from "./config.ts";
import { brandLanguage, languageGuide } from "./language.ts";
import { brandKind, capHashtags, heuristicHashtags, keywordFirstCaption, shortTopic, smartLower, type BrandKind } from "./hashtags.ts";

export const IMAGE_DESIGNS: ImageDesign[] = ["quote", "tip", "product", "offer", "testimonial", "question", "before-after", "fact"];
export const IMAGE_DESIGN_INFO: Record<ImageDesign, string> = {
  quote: "Quote card: big quote (headline) + author",
  tip: "Tip card: eyebrow, headline, 1-4 numbered bullets",
  product: "Product spotlight: brand photo, product name (headline), body, price/oldPrice, cta button",
  offer: "Announcement / offer: badge (e.g. 20% OFF, NEW), headline, body, price/oldPrice, cta; optional photo background",
  testimonial: "Review card: stars (rating), quote (headline), author — ONLY with a real review the owner gave you",
  question: "Engagement poll: question headline + 2-3 options [{label:'A',text}], cta 'Comment A or B'",
  "before-after": "Before/after: headline + options [{label:'Before',text},{label:'After',text}]",
  fact: "Did you know?: a surprising but TRUE fact as headline + short explanation body",
};

export const isImageSpec = (s: any): s is ImageSpec => !!s && s.kind === "image";

const str = (v: unknown, max = 400) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const pick = <T>(arr: T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length];

function cleanMedia(m: any): MediaRef | undefined {
  return m && typeof m.src === "string" && /^https?:\/\//.test(m.src) ? { src: m.src, kind: "image" } : undefined;
}

/** Validate + fill defaults (throws readable errors). */
export function normalizeImageSpec(spec: any, brand: Brand): ImageSpec {
  if (!spec || typeof spec !== "object") throw new Error("image spec is required");
  const headline = str(spec.headline, 300) ?? str(spec.title, 300);
  if (!headline) throw new Error("image spec needs a headline");
  const design: ImageDesign = IMAGE_DESIGNS.includes(spec.design) ? spec.design : "tip";
  const ref = brandStyleRef(brand);
  const options: ImageOption[] | undefined = Array.isArray(spec.options)
    ? spec.options
        .slice(0, 3)
        .map((o: any, i: number) => ({ label: str(o?.label, 20) ?? (design === "before-after" ? (i ? "After" : "Before") : String.fromCharCode(65 + i)), text: str(o?.text, 140) ?? "", ...(cleanMedia(o?.media) ? { media: cleanMedia(o.media) } : {}) }))
    : undefined;
  const rating = Number(spec.rating);
  const out: ImageSpec = {
    kind: "image",
    width: Number(spec.width) || 1080,
    height: Number(spec.height) || 1350,
    design,
    style: str(spec.style, 40),
    brand: { ...ref, ...(spec.brand ?? {}), colors: { ...ref.colors, ...(spec.brand?.colors ?? {}) } },
    headline,
    eyebrow: str(spec.eyebrow, 40),
    body: str(spec.body, 300),
    bullets: Array.isArray(spec.bullets) ? spec.bullets.map((b: any) => str(b, 120)).filter(Boolean).slice(0, 4) : undefined,
    author: str(spec.author, 80),
    rating: Number.isFinite(rating) && rating > 0 ? Math.max(1, Math.min(5, Math.round(rating))) : undefined,
    price: str(spec.price, 24),
    oldPrice: str(spec.oldPrice, 24),
    badge: str(spec.badge, 24),
    cta: str(spec.cta, 80),
    options: options?.length ? options : undefined,
    media: cleanMedia(spec.media),
    language: str(spec.language, 10),
  };
  for (const k of Object.keys(out) as (keyof ImageSpec)[]) if (out[k] === undefined) delete out[k];
  if (!out.bullets?.length) delete out.bullets;
  return out;
}

export function imageHook(spec: ImageSpec): string {
  return spec.headline;
}

/** One-line description for chat / MCP. */
export function imageDetail(s: ImageSpec): string {
  const bits = [
    `Image post — design ${s.design}${s.style ? `, style ${s.style}` : ""}`,
    s.eyebrow ? `Eyebrow: ${s.eyebrow}` : "",
    `Headline: "${s.headline}"`,
    s.body ? `Body: ${s.body}` : "",
    s.bullets?.length ? `Bullets: ${s.bullets.map((b, i) => `${i + 1}. ${b}`).join(" ")}` : "",
    s.options?.length ? `Options: ${s.options.map((o) => `${o.label}: ${o.text}`).join(" | ")}` : "",
    s.author ? `Author: ${s.author}` : "",
    s.price ? `Price: ${s.price}${s.oldPrice ? ` (was ${s.oldPrice})` : ""}` : "",
    s.badge ? `Badge: ${s.badge}` : "",
    s.cta ? `CTA: ${s.cta}` : "",
    s.media ? "Photo: yes" : "",
  ];
  return bits.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- styles per design

const STYLE_PREFS: Record<ImageDesign, Record<BrandKind, string[]>> = {
  quote: { academy: ["magazine", "story", "ember"], handmade: ["paper", "story", "magazine"], general: ["magazine", "cinematic", "clarity"] },
  tip: { academy: ["clarity", "text-list", "blueprint"], handmade: ["paper", "clarity", "story"], general: ["clarity", "text-list", "bold"] },
  product: { academy: ["clarity", "magazine"], handmade: ["paper", "product-drop", "magazine"], general: ["product-drop", "clarity"] },
  offer: { academy: ["bold", "clarity"], handmade: ["bold", "product-drop", "paper"], general: ["bold", "velocity", "product-drop"] },
  testimonial: { academy: ["story", "clarity"], handmade: ["story", "paper"], general: ["story", "clarity"] },
  question: { academy: ["clarity", "zine", "bold"], handmade: ["zine", "paper", "clarity"], general: ["zine", "bold", "clarity"] },
  "before-after": { academy: ["clarity", "blueprint"], handmade: ["paper", "clarity"], general: ["clarity", "bold"] },
  fact: { academy: ["neon", "clarity", "ember"], handmade: ["paper", "magazine"], general: ["neon", "bold", "clarity"] },
};

export function imageStyleFor(design: ImageDesign, brain: BrandBrain, idx: number, styles?: StyleMeta[]): string {
  const prefs = STYLE_PREFS[design][brandKind(brain)];
  const ok = styles?.length ? prefs.filter((p) => styles.some((s) => s.id === p)) : prefs;
  return pick(ok.length ? ok : prefs, idx);
}

// ---------------------------------------------------------------- heuristic ideas

export interface ImageIdea {
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  image: Partial<ImageSpec> & { design: ImageDesign; headline: string };
  usePhoto?: boolean;
}

/** Heuristic rotation (no testimonials: we never invent reviews). */
const ROTATION: ImageDesign[] = ["tip", "question", "quote", "product", "fact", "before-after", "offer"];

function ctaLine(brain: BrandBrain, kind: BrandKind): string {
  const c = brain.ctas?.find((x) => x.length <= 60);
  if (c) return c;
  return kind === "academy" ? "Book a free trial class — link in bio" : kind === "handmade" ? "Shop now — link in bio" : "Learn more — link in bio";
}

const KIND_COPY: Record<BrandKind, { tips: string[]; quote: string[]; fact: { h: string; b: string }[]; ba: [string, string][]; q: [string, string, string][] }> = {
  academy: {
    tips: ["Practise 15 minutes every day", "Revise yesterday's lesson first", "Ask your teacher one question each class", "Read aloud, not just in your head"],
    quote: ["Small steps every day lead to big progress.", "Learning is a journey, not a race.", "The best time to start was yesterday. The next best time is today."],
    fact: [
      { h: "Reading aloud helps you remember more", b: "Saying words out loud uses more of your memory than reading silently — try it in your next revision." },
      { h: "Short daily practice beats long weekly sessions", b: "Spacing your practice across the week helps lessons stick for longer." },
    ],
    ba: [["Reading letter by letter", "Reading with confidence"], ["Unsure where to start", "A clear weekly plan"]],
    q: [["Morning or evening practice?", "Morning, before the day starts", "Evening, after dinner"], ["How do you learn best?", "One-to-one with a teacher", "In a small group class"]],
  },
  handmade: {
    tips: ["Store it away from moisture", "Clean gently with a soft cloth", "Pair it with simple basics", "Keep the gift box for travel"],
    quote: ["Made slowly, by hand, to be loved for years.", "Every piece tells a story — make it yours.", "Small shop, big heart."],
    fact: [
      { h: "No two handmade pieces are exactly alike", b: "Tiny differences are the maker's fingerprint — that's what makes yours one of a kind." },
      { h: "Every order supports a real maker", b: "When you buy handmade, you keep a small studio and its craft alive." },
    ],
    ba: [["A plain gift", "A personalised keepsake"], ["Mass-produced", "Made by hand, just for you"]],
    q: [["Which one would you pick?", "", ""], ["Gift for them or a treat for you?", "A gift for someone special", "A treat for me"]],
  },
  general: {
    tips: ["Start with what matters most", "Keep it simple", "Ask an expert when you're stuck", "Review what worked each week"],
    quote: ["Quality is never an accident.", "Do the small things well.", "Built with care, made for you."],
    fact: [{ h: "Most people decide in the first few seconds", b: "That's why we keep things clear, simple and easy to choose." }],
    ba: [["Guesswork", "A clear plan"], ["Hours of hassle", "Done in minutes"]],
    q: [["Which do you prefer?", "Option A", "Option B"]],
  },
};

const OCCASION_WORDS = /eid|ramadan|christmas|valentine|mother|father|independence|new year|diwali|black friday|cyber|small business|teacher|back to school|pakistan/i;

export function heuristicImageIdea(
  brand: Brand,
  brain: BrandBrain,
  i: number,
  opts: { design?: ImageDesign; pillar?: string; occasion?: { name: string; angle?: string }; topic?: string } = {},
): ImageIdea {
  const kind = brandKind(brain);
  const copy = KIND_COPY[kind];
  const design = opts.design ?? (opts.occasion ? "offer" : opts.topic ? "tip" : pick(ROTATION, i));
  const prods = (brain.products ?? []).filter((p) => p.trim().split(/\s+/).length >= 2);
  const product = shortTopic(pick(prods.length ? prods : brain.products?.length ? brain.products : [brain.niche], i) || brain.niche, 5) || brand.name;
  const topic = smartLower(shortTopic(opts.topic || opts.pillar || product, 4) || brain.niche);
  const cta = ctaLine(brain, kind);
  let img: ImageIdea["image"];
  let title: string;
  let lead: string;
  switch (design) {
    case "tip": {
      const start = i % copy.tips.length;
      img = { design, eyebrow: opts.pillar ? shortTopic(opts.pillar, 3) : "Quick tip", headline: `3 simple ways to get better at ${topic}`, bullets: [0, 1, 2].map((k) => copy.tips[(start + k) % copy.tips.length]), cta: "Save this for later" };
      title = `Tip card: ${topic}`;
      lead = `Three simple habits for ${topic}. Save this post so you have it when you need it.`;
      break;
    }
    case "question": {
      const q = pick(copy.q, i);
      const a = q[1] || brain.products?.[0] || "Option A";
      const b = q[2] || brain.products?.[1] || "Option B";
      img = { design, eyebrow: "Your turn", headline: q[0], options: [{ label: "A", text: shortTopic(a, 6) || a }, { label: "B", text: shortTopic(b, 6) || b }], cta: "Comment A or B below" };
      title = `Poll: ${q[0]}`;
      lead = `Tell us in the comments: A or B? We read every answer.`;
      break;
    }
    case "quote": {
      const text = pick(copy.quote, i);
      img = { design, headline: text, author: brand.name, cta: "Follow for more" };
      title = `Quote: ${text.slice(0, 40)}`;
      lead = `${text} A little reminder from ${brand.name}.`;
      break;
    }
    case "product": {
      img = { design, eyebrow: kind === "academy" ? "Now enrolling" : "Featured", headline: product, body: brain.differentiators?.[i % Math.max(1, brain.differentiators.length)] ?? brain.summary.slice(0, 110), cta: kind === "academy" ? "Enrol now" : "Shop now" };
      title = `Spotlight: ${product}`;
      lead = `Meet ${product} from ${brand.name}. ${brain.differentiators?.[0] ?? ""}`.trim();
      break;
    }
    case "fact": {
      const f = pick(copy.fact, i);
      img = { design, headline: f.h, body: f.b, cta: "Follow for more" };
      title = `Did you know: ${f.h.slice(0, 40)}`;
      lead = `${f.h}. ${f.b}`;
      break;
    }
    case "before-after": {
      const [b0, a0] = pick(copy.ba, i);
      img = { design, headline: kind === "academy" ? `What a few weeks of ${topic} can change` : `The difference ${brand.name} makes`, options: [{ label: "Before", text: b0 }, { label: "After", text: a0 }], cta };
      title = `Before / after: ${topic}`;
      lead = `From "${b0.toLowerCase()}" to "${a0.toLowerCase()}".`;
      break;
    }
    case "testimonial":
      // Never invent a review: a testimonial needs the owner's real words. Fall back to a quote card.
      return heuristicImageIdea(brand, brain, i, { ...opts, design: "quote" });
    case "offer":
    default: {
      if (opts.occasion) {
        const o = opts.occasion.name.replace(/\s+\d{4}$/, "");
        const greeting = /eid/i.test(o) ? `${o} Mubarak` : /ramadan/i.test(o) ? "Ramadan Mubarak" : /independence/i.test(o) ? "Happy Independence Day" : /black friday|cyber|small business/i.test(o) ? `${o} is here` : `Happy ${o}`;
        img = { design: "offer", badge: /black friday|cyber/i.test(o) ? "Sale" : undefined, eyebrow: o, headline: `${greeting} from ${brand.name}`, body: opts.occasion.angle, cta };
        title = `${o} post`;
        lead = `${greeting}! ${opts.occasion.angle ?? ""}`.trim();
      } else {
        img = { design: "offer", badge: "New", eyebrow: kind === "academy" ? "Admissions open" : "Just launched", headline: kind === "academy" ? `Enrolment is open for ${product}` : `${product} is here`, body: brain.differentiators?.[0], cta };
        title = `Announcement: ${product}`;
        lead = `${img.headline}. ${brain.differentiators?.[0] ?? ""}`.trim();
      }
    }
  }
  const hook = img.headline;
  // search keyword in line 1 only where the headline is about the topic (quotes/polls/facts read better as-is)
  const keyword = ["quote", "question", "fact"].includes(img.design) || OCCASION_WORDS.test(hook) ? "" : topic;
  return {
    title,
    hook,
    caption: keywordFirstCaption({ hook, keyword, body: lead, cta }),
    hashtags: heuristicHashtags(brain, `${topic} ${title}`),
    image: img,
    usePhoto: design === "product" || design === "offer",
  };
}

// ---------------------------------------------------------------- LLM ideas

const IMAGE_SYSTEM = `You design single-image Instagram FEED posts (one 1080x1350 branded graphic each) for a brand.
Designs: ${IMAGE_DESIGNS.map((d) => `"${d}" = ${IMAGE_DESIGN_INFO[d]}`).join("; ")}.
Return JSON {"posts":[{"design": one of the designs, "title": string (internal), "hook": string (= headline idea, <= 12 words),
 "caption": string (search-first: line 1 contains the main keyword; 1-3 short value lines; last line one CTA; no hashtags),
 "hashtags": string[] (3-5, no #, specific niche keywords, MAX 5),
 "eyebrow"?: string (<= 3 words), "headline": string (<= 12 words; quotes <= 22 words), "body"?: string (<= 22 words),
 "bullets"?: string[] (tip only, 2-4 items, <= 7 words each), "author"?: string, "price"?: string, "oldPrice"?: string,
 "badge"?: string (<= 2 words, e.g. "NEW", "20% OFF"), "cta"?: string (<= 7 words),
 "options"?: [{"label": string, "text": string (<= 5 words)}], "usePhoto"?: boolean (true for product/offer when a brand photo fits)}]}
Rules: vary designs (do not repeat a design unless asked for more than 4 posts); prefer tip, question, quote, product, fact.
NEVER invent testimonials, reviews, customer names, prices, discounts or statistics: only use "testimonial", "price", "oldPrice" or a discount badge if
the input contains them (input.facts). Facts must be true and general. Respect claimsToAvoid and the brand voice. Never repeat existingTitles.
If input.pillar is given, every post is about that content pillar. If input.occasion is given, make the post timely for it (greeting or offer) without inventing discounts.`;

export async function llmImageIdeas(
  brand: Brand,
  brain: BrandBrain,
  n: number,
  ctx: { existingTitles?: string[]; pillar?: string; occasion?: { name: string; date: string; angle?: string }; facts?: string; topic?: string } = {},
): Promise<ImageIdea[]> {
  const guide = languageGuide(brandLanguage(brand));
  const input = {
    brand: { name: brand.name, website: brand.website, instagram: brand.instagramHandle },
    brain: { summary: brain.summary, products: brain.products, audience: brain.audience, voice: brain.voice, niche: brain.niche, claimsToAvoid: brain.claimsToAvoid, differentiators: brain.differentiators, ctas: brain.ctas, keywords: brain.keywords },
    count: n,
    existingTitles: ctx.existingTitles ?? [],
    pillar: ctx.pillar,
    occasion: ctx.occasion,
    topic: ctx.topic,
    facts: ctx.facts,
  };
  const out = await askJson<{ posts: any[] }>(guide ? `${IMAGE_SYSTEM}\n${guide.replace(/"voiceoverText"/g, '"headline"')}` : IMAGE_SYSTEM, JSON.stringify(input), 6000);
  const posts = Array.isArray(out?.posts) ? out.posts : [];
  return posts
    .filter((p) => p && typeof p.headline === "string" && p.headline.trim())
    .slice(0, n)
    .map((p) => {
      const design: ImageDesign = IMAGE_DESIGNS.includes(p.design) ? p.design : "tip";
      return {
        title: String(p.title ?? p.headline).slice(0, 120),
        hook: String(p.hook ?? p.headline).slice(0, 160),
        caption: String(p.caption ?? ""),
        hashtags: Array.isArray(p.hashtags) && capHashtags(p.hashtags).length ? capHashtags(p.hashtags) : heuristicHashtags(brain, String(p.title ?? p.headline)),
        usePhoto: !!p.usePhoto,
        image: {
          design,
          headline: String(p.headline),
          eyebrow: p.eyebrow,
          body: p.body,
          bullets: Array.isArray(p.bullets) ? p.bullets : undefined,
          author: p.author,
          price: p.price,
          oldPrice: p.oldPrice,
          badge: p.badge,
          cta: p.cta,
          options: Array.isArray(p.options) ? p.options : undefined,
        },
      } satisfies ImageIdea;
    });
}

/** Image ideas: LLM when available (falls back per missing item to heuristics). */
export async function planImageIdeas(
  brand: Brand,
  brain: BrandBrain,
  n: number,
  offset: number,
  ctx: { existingTitles?: string[]; pillar?: string; occasion?: { name: string; date: string; angle?: string }; design?: ImageDesign; topic?: string } = {},
): Promise<ImageIdea[]> {
  if (n <= 0) return [];
  let ideas: ImageIdea[] = [];
  if (llmAvailable() && !ctx.design) {
    try {
      ideas = await llmImageIdeas(brand, brain, n, ctx);
    } catch (e: any) {
      console.warn("[image] LLM image ideas failed, using heuristic:", e?.message ?? e);
    }
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const seen = new Set((ctx.existingTitles ?? []).map(norm));
  for (const x of ideas) seen.add(norm(x.title));
  for (let k = ideas.length, tries = 0; ideas.length < n && tries < n * 8; k++, tries++) {
    const idea = heuristicImageIdea(brand, brain, offset + k, { design: ctx.design, pillar: ctx.pillar, occasion: ctx.occasion, topic: ctx.topic });
    if (seen.has(norm(idea.title)) || seen.has(norm(idea.hook))) continue;
    seen.add(norm(idea.title));
    ideas.push(idea);
  }
  return ideas;
}

/** Brand photos (non-logo image assets), used by product/offer designs. */
export function brandPhotos(brandId: string): MediaRef[] {
  return listAssets(brandId)
    .filter((a) => a.kind === "image" && !/logo/i.test(a.originalName))
    .map((a) => ({ src: a.url, kind: "image" as const }));
}

export function imageSpecFromIdea(idea: ImageIdea, brand: Brand, brain: BrandBrain, idx: number, styles?: StyleMeta[], photo?: MediaRef): ImageSpec {
  const design = idea.image.design;
  const lang = brandLanguage(brand);
  return normalizeImageSpec(
    {
      ...idea.image,
      style: idea.image.style && styles?.some((s) => s.id === idea.image.style) ? idea.image.style : imageStyleFor(design, brain, idx, styles),
      media: idea.image.media ?? (idea.usePhoto || design === "product" ? photo : undefined),
      ...(lang !== "en" ? { language: lang } : {}),
    },
    brand,
  );
}

// ---------------------------------------------------------------- render

/** Render an image post into outDir → { urls: [image.jpg], thumb }. Called by render.ts. */
export async function renderImageOutputs(post: Post, outDir: string, onProgress?: (p: number) => void): Promise<{ urls: string[]; thumb?: string }> {
  const r: any = await loadRenderer();
  if (typeof r.renderImagePost !== "function") throw new Error("renderer has no renderImagePost (update renderer/)");
  onProgress?.(0.2);
  const res = await r.renderImagePost(post.spec as ImageSpec, outDir);
  onProgress?.(0.95);
  // ?v= busts the browser cache when a revision is re-rendered in place (Instagram ignores the query string)
  const v = `?v=${Date.now().toString(36)}`;
  return { urls: [fileUrlFor(res.imagePath) + v], thumb: res.thumbnailPath ? fileUrlFor(res.thumbnailPath) + v : undefined };
}

// ---------------------------------------------------------------- rule-based change requests

const COLOR_WORDS: Record<string, string> = {
  red: "#D32F2F", crimson: "#B71C1C", maroon: "#7A1F2B", pink: "#E91E63", rose: "#C2185B", purple: "#7B1FA2", violet: "#6A3DE8",
  blue: "#1565C0", navy: "#0B2A5B", sky: "#29B6F6", teal: "#00897B", turquoise: "#00ACC1", green: "#2E7D32", emerald: "#047857",
  lime: "#7CB342", yellow: "#FBC02D", gold: "#C9A227", orange: "#EF6C00", brown: "#6D4C41", beige: "#E8DCC8", black: "#111111",
  white: "#FFFFFF", gray: "#616161", grey: "#616161", cream: "#FAF3E0",
};

/** Plain-words edits for image posts (no LLM): text fields, design, style, colors. */
export function imageHeuristicChange(post: Post, text: string, styles: StyleMeta[] = []): { spec: ImageSpec; meta: Partial<Post>; changed: string[] } {
  const spec = structuredClone(post.spec) as ImageSpec;
  const meta: Partial<Post> = {};
  const changed: string[] = [];
  const t = text.trim();
  const lower = t.toLowerCase();
  const val = (re: RegExp) => t.match(re)?.[1]?.trim().replace(/^["“'‘]+|["”'’.!]+$/g, "").trim() || undefined;
  const TO = String.raw`\s*(?:text\s*)?(?:to|:|=|->|→|should be|should say|says?)\s*`;
  const field = (names: string) => val(new RegExp(String.raw`\b(?:${names})${TO}(.+)$`, "i"));

  const headline = field("headline|hook|title|main text|quote|question|fact|heading");
  if (headline) {
    spec.headline = headline;
    meta.hook = headline;
    changed.push("headline");
  }
  const body = field("body|subtext|sub text|description|small text|explanation");
  if (body) {
    spec.body = body;
    changed.push("body");
  }
  const cta = field("cta|call to action|button|footer");
  if (cta) {
    spec.cta = cta;
    changed.push("cta");
  }
  const eyebrow = field("eyebrow|label|tag line|tagline|kicker");
  if (eyebrow) {
    spec.eyebrow = eyebrow;
    changed.push("eyebrow");
  }
  const badge = field("badge|sticker");
  if (badge) {
    spec.badge = badge;
    changed.push("badge");
  }
  const old = field("old price|was price|original price");
  if (old) {
    spec.oldPrice = old;
    changed.push("oldPrice");
  }
  const price = !old ? field("price") : undefined;
  if (price) {
    spec.price = price;
    changed.push("price");
  }
  const author = field("author|name|attribution|signed");
  if (author && !headline) {
    spec.author = author;
    changed.push("author");
  }
  const opt = t.match(/\boption\s*([a-c1-3])\s*(?:text\s*)?(?:to|:|=|->|→)\s*(.+)$/i);
  if (opt && spec.options?.length) {
    const i = /\d/.test(opt[1]) ? Number(opt[1]) - 1 : opt[1].toLowerCase().charCodeAt(0) - 97;
    if (spec.options[i]) {
      spec.options[i] = { ...spec.options[i], text: opt[2].trim().replace(/^["“']|["”'.]$/g, "") };
      changed.push(`option ${spec.options[i].label}`);
    }
  }
  const bullet = t.match(/\b(?:bullet|step|point|tip)\s*#?\s*(\d)\s*(?:to|:|=|->|→)\s*(.+)$/i);
  if (bullet && spec.bullets?.length) {
    const i = Number(bullet[1]) - 1;
    if (i >= 0 && i < 4) {
      const b = [...spec.bullets];
      b[i] = bullet[2].trim().replace(/^["“']|["”'.]$/g, "");
      spec.bullets = b.filter(Boolean);
      changed.push(`bullet ${i + 1}`);
    }
  }
  // design switch ("make it a quote card", "turn into a poll")
  const designWords: [RegExp, ImageDesign][] = [
    [/\bquote( card)?\b/, "quote"],
    [/\btip( card)?\b/, "tip"],
    [/\bproduct( spotlight)?\b|\bspotlight\b/, "product"],
    [/\b(offer|announcement|sale post|promo)\b/, "offer"],
    [/\b(testimonial|review card)\b/, "testimonial"],
    [/\b(poll|question post|this or that|a or b)\b/, "question"],
    [/\bbefore\s*(\/|and|&|-)?\s*after\b/, "before-after"],
    [/\b(did you know|fact card|fact post)\b/, "fact"],
  ];
  if (/\b(make it|turn (it )?into|change (it )?to|switch to|convert to|as)\s+an?\b/.test(lower) && !headline && !body) {
    const d = designWords.find(([re]) => re.test(lower))?.[1];
    if (d && d !== spec.design) {
      spec.design = d;
      if (d === "question" && !spec.options?.length) spec.options = [{ label: "A", text: "Option A" }, { label: "B", text: "Option B" }];
      if (d === "before-after" && (spec.options?.length ?? 0) < 2) spec.options = [{ label: "Before", text: "Before" }, { label: "After", text: "After" }];
      changed.push(`design → ${d}`);
    }
  }
  // style
  let best: { id: string; len: number } | undefined;
  for (const s of styles) {
    for (const cand of [s.id.toLowerCase(), s.name.toLowerCase(), s.id.toLowerCase().replace(/-/g, " ")]) {
      if (new RegExp(`\\b${cand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower) && (!best || cand.length > best.len)) best = { id: s.id, len: cand.length };
    }
  }
  if (best && best.id !== spec.style && !changed.some((c) => c.startsWith("design"))) {
    spec.style = best.id;
    changed.push(`style → ${best.id}`);
  } else if (/\b(different|another|new|other|fresh)\s+(style|look|vibe)\b|\bchange\s+the\s+(style|look)\b/.test(lower) && styles.length) {
    const i = styles.findIndex((s) => s.id === spec.style);
    spec.style = styles[(i + 1) % styles.length].id;
    changed.push(`style → ${spec.style}`);
  } else if (/\b(darker|dark mode|dark background|moodier)\b/.test(lower)) {
    spec.style = "cinematic";
    changed.push("style → cinematic (dark)");
  } else if (/\b(lighter|brighter|light background|cleaner|minimal)\b/.test(lower)) {
    spec.style = "clarity";
    changed.push("style → clarity (light)");
  }
  // colors: "use red", "accent #ff8800", "primary color to navy"
  const hexes = t.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? [];
  const named = Object.keys(COLOR_WORDS).filter((w) => new RegExp(`\\b${w}\\b`).test(lower));
  if ((hexes.length || named.length) && /\b(colou?rs?|accent|primary|background|brand colou?r|use|make it|in)\b/.test(lower) && !changed.some((c) => c === "headline" || c === "body" || c === "cta")) {
    const c = (hexes[0] && isHex(hexes[0]) ? hexes[0] : COLOR_WORDS[named[0]]).toUpperCase();
    const key = /\baccent\b/.test(lower) ? "accent" : /\bbackground\b/.test(lower) ? "background" : /\bsecondary\b/.test(lower) ? "secondary" : "primary";
    spec.brand = { ...spec.brand, colors: { ...spec.brand.colors, [key]: c } };
    changed.push(`${key} color → ${c}`);
  }
  // fallback: quoted text becomes the headline
  if (!changed.length) {
    const q = t.match(/["“]([^"”]{2,200})["”]/)?.[1];
    if (q) {
      spec.headline = q;
      meta.hook = q;
      changed.push("headline");
    }
  }
  return { spec, meta, changed };
}

/** Ensure a brand has a brain (for callers outside the planner). */
export const brainFor = (brand: Brand) => ensureBrain(brand);
