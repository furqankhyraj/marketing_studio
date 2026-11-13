// Planner: post ideas → full ReelSpec / CarouselSpec / HtmlReelSpec, scheduled into best-time slots.
import type { Brand, BrandBrain, Post, PostType, ReelSpec, CarouselSpec, Scene, MediaRef, StyleMeta, CaptionStyleMeta } from "../../shared/types.ts";
import { listAssets, listPosts, getSettings, savePost } from "./db.ts";
import { ensureBrain, brandStyleRef, topKeywords } from "./brain.ts";
import { askJson, llmAvailable } from "./llm.ts";
import { getStyles, loadHyperframes, loadVoice, tryLoad, type HtmlTemplateMeta } from "./engines.ts";
import { nextSlots, takenSlots } from "./schedule.ts";
import { newPost, type AnySpec } from "./posts.ts";
import { enqueueRender, configureVoice } from "./render.ts";
import { brandLanguage, languageGuide } from "./language.ts";
import { capHashtags, heuristicHashtags, keywordFirstCaption, shortTopic, smartLower } from "./hashtags.ts";
import { planImageIdeas, imageSpecFromIdea, brandPhotos, type ImageIdea } from "./imagepost.ts";

export interface Idea {
  type: PostType;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  style?: string;
  captionStyle?: string;
  scenes?: { headline: string; subtext?: string; bullets?: string[]; voiceoverText?: string; captionText?: string; durationSec?: number; mediaQuery?: string }[];
  slides?: { headline: string; body?: string }[];
  cta?: { text: string; keyword?: string };
  image?: ImageIdea["image"]; // type "image" (imagepost.ts)
  usePhoto?: boolean;
}

const pick = <T>(arr: T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length];

function ctaFor(brain: BrandBrain): { text: string; keyword: string } {
  for (const c of brain.ctas) {
    const m = c.match(/comment\s+["']?([A-Z0-9]{3,12})["']?/i);
    if (m) return { text: c, keyword: m[1].toUpperCase() };
  }
  const kw = /course|class|learn|academy/i.test(brain.niche + brain.summary) ? "LEARN" : /shop|etsy|handmade|gift/i.test(brain.niche + brain.summary) ? "SHOP" : "INFO";
  return { text: `Comment ${kw} and we'll DM you the link`, keyword: kw };
}

/** Max 5 specific niche hashtags (Instagram limit since Dec 2025), topic-aware. */
function hashtagsFor(brain: BrandBrain, topic = ""): string[] {
  return heuristicHashtags(brain, topic);
}

// ---------- heuristic ideas ----------
type Tpl = (b: BrandBrain, name: string, i: number) => Omit<Idea, "type" | "hashtags" | "caption"> & { captionLead: string };

const topicOf = (b: BrandBrain, i: number) => smartLower(shortTopic(pick(b.products, i) || b.niche) || b.niche);

const REEL_TEMPLATES: Tpl[] = [
  (b, n, i) => {
    const t = topicOf(b, i);
    return {
      title: `3 mistakes with ${t}`,
      hook: `Stop making these 3 mistakes with ${t}`,
      captionLead: `Most people get ${t} wrong in the same three ways. Here's how to avoid them.`,
      scenes: [
        { headline: `Stop making these 3 mistakes with ${t}`, voiceoverText: `Stop making these three mistakes with ${t}.` },
        { headline: "Mistake #1", subtext: "Going for the cheapest option", voiceoverText: "Mistake one: going for the cheapest option and paying for it later." },
        { headline: "Mistake #2", subtext: "Not asking what's included", voiceoverText: "Mistake two: not asking exactly what's included." },
        { headline: "Mistake #3", subtext: "Waiting until the last minute", voiceoverText: "Mistake three: waiting until the last minute." },
        { headline: `The ${n} way`, bullets: b.differentiators.slice(0, 3), voiceoverText: `Here's how we do it differently at ${n}.` },
      ],
    };
  },
  (b, n, i) => {
    const t = topicOf(b, i);
    return {
      title: `Behind the scenes: ${t}`,
      hook: `What goes into one ${t}`,
      captionLead: `Ever wondered what really goes into ${t}? A peek behind the scenes at ${n}.`,
      scenes: [
        { headline: `What goes into one ${t}?`, voiceoverText: `Ever wondered what goes into ${t}?` },
        { headline: "Step 1", subtext: "It starts with an idea", voiceoverText: "It all starts with an idea and a lot of care." },
        { headline: "Step 2", subtext: "Every detail by hand", voiceoverText: "Then every detail gets our full attention." },
        { headline: "Step 3", subtext: "Checked twice", voiceoverText: "Everything is checked twice before it goes out." },
        { headline: "Made for you", subtext: b.audience, voiceoverText: "And then it's ready for you." },
      ],
    };
  },
  (b, n) => ({
    title: `Why ${n} is different`,
    hook: `Why people choose ${n}`,
    captionLead: `${b.summary.split(/(?<=\.)\s/)[0]}`,
    scenes: [
      { headline: `Why people choose ${n}`, voiceoverText: `Here's why people choose ${n}.` },
      ...b.differentiators.slice(0, 3).map((d, k) => ({ headline: d, subtext: `Reason ${k + 1}`, voiceoverText: d + "." })),
      { headline: "See for yourself", subtext: b.products.slice(0, 3).join(" · "), voiceoverText: "See for yourself." },
    ],
  }),
  (b, n, i) => {
    const t = topicOf(b, i + 1);
    return {
      title: `Myth vs fact: ${t}`,
      hook: `You've been lied to about ${t}`,
      captionLead: `Let's clear up the biggest myths about ${t}.`,
      scenes: [
        { headline: `You've been lied to about ${t}`, voiceoverText: `You've probably heard some myths about ${t}.` },
        { headline: "Myth", subtext: "It has to be expensive", voiceoverText: "Myth: it has to be expensive." },
        { headline: "Fact", subtext: "Quality comes from care, not price tags", voiceoverText: "Fact: quality comes from care, not price tags." },
        { headline: "Myth", subtext: "It takes forever", voiceoverText: "Myth: it takes forever." },
        { headline: "Fact", subtext: `${n} makes it simple`, voiceoverText: `Fact: ${n} makes it simple.` },
      ],
    };
  },
  (b, n) => ({
    title: `Is ${n} for you?`,
    hook: "This is for you if…",
    captionLead: `Made for ${b.audience.charAt(0).toLowerCase() + b.audience.slice(1)}.`,
    scenes: [
      { headline: "This is for you if…", voiceoverText: "This is for you if…" },
      { headline: "You want something special", voiceoverText: "you want something that actually feels special," },
      { headline: "You value quality", voiceoverText: "you care about quality," },
      { headline: "You hate the hassle", voiceoverText: "and you don't want the hassle." },
      { headline: `Meet ${n}`, subtext: b.summary.slice(0, 90), voiceoverText: `Meet ${n}.` },
    ],
  }),
  (b, n, i) => {
    const t = topicOf(b, i + 2);
    return {
      title: `Quick tips: ${t}`,
      hook: `3 quick tips for ${t}`,
      captionLead: `Save this for later: three quick tips for ${t}.`,
      scenes: [
        { headline: `3 quick tips for ${t}`, voiceoverText: `Three quick tips for ${t}. Save this.` },
        { headline: "Tip 1", subtext: "Start with what matters most", voiceoverText: "Tip one: start with what matters most." },
        { headline: "Tip 2", subtext: "Keep it simple", voiceoverText: "Tip two: keep it simple." },
        { headline: "Tip 3", subtext: "Ask an expert", voiceoverText: `Tip three: ask an expert, like the team at ${n}.` },
        { headline: "Save & share", subtext: "Send this to a friend who needs it", voiceoverText: "Save this and share it with a friend." },
      ],
    };
  },
];

function heuristicIdea(type: PostType, brain: BrandBrain, brand: Brand, i: number): Idea {
  const tpl = pick(REEL_TEMPLATES, i)(brain, brand.name, i);
  const cta = ctaFor(brain);
  let scenes = tpl.scenes!;
  if (scenes.length < 5) scenes = [...scenes, { headline: brain.products[0] ?? brand.name, voiceoverText: brain.products[0] }];
  if (type === "story") scenes = [scenes[0], scenes[scenes.length - 1]];
  const idea: Idea = {
    type,
    title: tpl.title,
    hook: tpl.hook,
    // search-first caption: line 1 = hook containing the main keyword, then value, then one CTA
    caption: keywordFirstCaption({
      hook: tpl.hook,
      keyword:
        [i, i + 1, i + 2].map((k) => topicOf(brain, k)).find((t) => tpl.hook.toLowerCase().includes(t.toLowerCase())) ??
        (shortTopic(brain.products[0] ?? "") || topicOf(brain, i)),
      body: tpl.captionLead,
      cta: cta.text,
    }),
    hashtags: hashtagsFor(brain, `${topicOf(brain, i)} ${tpl.title}`),
    scenes: scenes.map((s, k) => ({ ...s, durationSec: k === 0 ? 2.5 : 3.5 })),
    cta,
  };
  if (type === "carousel") {
    idea.slides = [
      { headline: tpl.hook, body: `Swipe →` },
      ...scenes.slice(1).map((s) => ({ headline: s.headline, body: s.subtext ?? s.bullets?.join(" · ") ?? s.voiceoverText })),
      { headline: "Save this post", body: cta.text },
    ].slice(0, 8);
    while (idea.slides.length < 5) idea.slides.splice(idea.slides.length - 1, 0, { headline: pick(brain.differentiators, idea.slides.length), body: brain.summary.slice(0, 120) });
    delete idea.scenes;
  }
  return idea;
}

// ---------- LLM ideas ----------
const PLAN_SYSTEM = `You are the creative director of an Instagram autopilot. You write scroll-stopping short-form content.
Return JSON: {"posts": [ { "type": "reel"|"carousel"|"story", "title": string, "hook": string (<= 10 words),
 "caption": string (search-first: line 1 = the hook and contains the main keyword people would type into Instagram search; then 1-3 short value lines with natural keywords; last line = one clear CTA; no hashtags),
 "hashtags": string[] (3-5, no #, MAX 5 = Instagram's limit; specific niche keywords, no generic tags like love/instagood/reels),
 "style": one of the given style ids, "captionStyle": one of the given caption style ids,
 "scenes": [ {"headline": string (<= 7 words, big on-screen text), "subtext"?: string, "bullets"?: string[],
              "voiceoverText": string (1 natural spoken sentence), "durationSec": number (2-5), "mediaQuery": string (2-4 words for stock b-roll)} ],
 "slides": [ {"headline": string, "body"?: string} ],
 "cta": {"text": string, "keyword": string (one UPPERCASE word people comment)} } ] }
Reels: 5-7 scenes, first scene is the hook. Stories: 1-3 scenes. Carousels: 5-8 slides (no scenes), slide 1 = hook, last = CTA.
Match the brand voice, respect claimsToAvoid, vary formats (tips, myths, behind-the-scenes, social proof, offers). Never repeat existing titles.`;

async function llmIdeas(brand: Brand, brain: BrandBrain, counts: Record<PostType, number>, styles: StyleMeta[], captionStyles: CaptionStyleMeta[], ctx: PlanContext = {}): Promise<Idea[]> {
  const existing = [...listPosts({ brandId: brand.id }).slice(-30).map((p) => p.title), ...(ctx.avoidTitles ?? []).slice(-40)];
  const input = {
    brand: { name: brand.name, website: brand.website, instagram: brand.instagramHandle },
    brain,
    make: { reel: counts.reel, carousel: counts.carousel, story: counts.story },
    ...(ctx.pillar ? { pillar: ctx.pillar, pillarNote: "Every post must be about this content pillar." } : {}),
    ...(ctx.occasion ? { occasion: ctx.occasion, occasionNote: "Make the post timely for this occasion (no invented discounts)." } : {}),
    styles: styles.map((s) => ({ id: s.id, description: s.description, supports: s.supports })),
    captionStyles: captionStyles.map((c) => c.id),
    existingTitles: existing,
  };
  const guide = languageGuide(brandLanguage(brand)); // Urdu brands: Urdu-script narration (+ Roman Urdu on screen if chosen)
  const out = await askJson<{ posts: Idea[] }>(guide ? `${PLAN_SYSTEM}\n${guide}` : PLAN_SYSTEM, JSON.stringify(input), 12000);
  const posts = Array.isArray(out?.posts) ? out.posts : Array.isArray(out) ? (out as any) : [];
  return posts
    .filter((p: any) => p && ["reel", "carousel", "story"].includes(p.type))
    .map((p: any) => ({
      ...p,
      title: String(p.title ?? p.hook ?? "Untitled"),
      hook: String(p.hook ?? p.title ?? ""),
      caption: String(p.caption ?? ""),
      hashtags: Array.isArray(p.hashtags) && capHashtags(p.hashtags).length ? capHashtags(p.hashtags) : hashtagsFor(brain, String(p.title ?? "")),
    }));
}

// ---------- media ----------
interface MediaPool {
  next(query: string, kind?: "image" | "video"): Promise<MediaRef | undefined>;
}
async function mediaPool(brand: Brand, brain: BrandBrain): Promise<MediaPool> {
  const own = listAssets(brand.id)
    .filter((a) => (a.kind === "image" || a.kind === "video") && !/logo/i.test(a.originalName))
    .map((a) => ({ src: a.url, kind: a.kind as "image" | "video" }));
  let i = Math.floor(Math.random() * Math.max(1, own.length));
  if (own.length) return { next: async () => own[i++ % own.length] };
  const s = getSettings();
  if (!(s.pexelsApiKeySet || s.pixabayApiKeySet)) return { next: async () => undefined };
  const v = await tryLoad(loadVoice);
  if (!v) return { next: async () => undefined };
  await configureVoice(v);
  const used = new Set<string>();
  const cache = new Map<string, MediaRef[]>();
  return {
    async next(query: string, kind: "image" | "video" = "video") {
      const q = (query || brain.niche).trim().slice(0, 60) || brain.niche;
      try {
        if (!cache.has(q)) {
          const items = await v.searchStock(q, { kind, orientation: "portrait", perPage: 6 });
          cache.set(q, (items ?? []).map((it) => ({ src: it.url, kind: it.kind })));
        }
        const list = cache.get(q)!;
        const m = list.find((x) => !used.has(x.src)) ?? list[0];
        if (m) used.add(m.src);
        return m;
      } catch {
        return undefined;
      }
    },
  };
}

// ---------- assembly ----------
async function ideaToSpec(
  idea: Idea,
  brand: Brand,
  brain: BrandBrain,
  idx: number,
  styles: StyleMeta[],
  captionStyles: CaptionStyleMeta[],
  media: MediaPool,
  htmlTemplates: HtmlTemplateMeta[],
): Promise<AnySpec> {
  if (idea.type === "image" && idea.image) {
    // single 4:5 graphic: brand photo (own image assets first, else stock image) for product/offer designs
    let photo: MediaRef | undefined;
    if (idea.usePhoto || idea.image.design === "product") {
      const own = brandPhotos(brand.id);
      photo = own.length ? own[idx % own.length] : await media.next(topKeywords(`${idea.image.headline} ${brain.niche}`, 3).join(" "), "image");
      if (photo?.kind !== "image") photo = undefined;
    }
    return imageSpecFromIdea({ title: idea.title, hook: idea.hook, caption: idea.caption, hashtags: idea.hashtags, image: idea.image, usePhoto: idea.usePhoto }, brand, brain, idx, styles, photo);
  }
  const ref = brandStyleRef(brand);
  const kind = idea.type === "carousel" ? "carousel" : idea.type === "story" ? "story" : "reel";
  const compatible = styles.filter((s) => s.supports.includes(kind as any));
  const pool = compatible.length ? compatible : styles;
  const style = pool.find((s) => s.id === idea.style)?.id ?? pick(pool, idx).id;
  if (idea.type === "carousel") {
    const slides = (idea.slides?.length ? idea.slides : (idea.scenes ?? []).map((s) => ({ headline: s.headline, body: s.subtext })))
      .slice(0, 8)
      .map((s) => ({ headline: s.headline, body: s.body }));
    const out: CarouselSpec = { width: 1080, height: 1350, style, brand: ref, slides: [] };
    for (let k = 0; k < slides.length; k++) {
      const m = k === 0 || k === slides.length - 1 || k % 2 === 1 ? await media.next(topKeywords(slides[k].headline + " " + brain.niche, 3).join(" "), "image") : undefined;
      out.slides.push({ ...slides[k], ...(m ? { media: m } : {}) });
    }
    return out;
  }
  let raw = idea.scenes?.length ? idea.scenes : [{ headline: idea.hook }];
  raw = idea.type === "story" ? raw.slice(0, 3) : raw.slice(0, 7);
  const scenes: Scene[] = [];
  for (let k = 0; k < raw.length; k++) {
    const s = raw[k];
    const q = s.mediaQuery || topKeywords(`${s.headline} ${s.subtext ?? ""} ${brain.niche}`, 3).join(" ");
    const m = await media.next(q, "video");
    scenes.push({
      id: `s${k + 1}`,
      durationSec: Math.max(1.5, Math.min(8, Number(s.durationSec) || (k === 0 ? 2.5 : 3.5))),
      headline: s.headline,
      ...(s.subtext ? { subtext: s.subtext } : {}),
      ...(s.bullets?.length ? { bullets: s.bullets.slice(0, 4) } : {}),
      ...(s.voiceoverText ? { voiceoverText: s.voiceoverText } : {}),
      ...(s.captionText ? { captionText: s.captionText } : {}),
      ...(m ? { media: m } : {}),
    });
  }
  const cta = idea.cta?.text ? { text: idea.cta.text, keyword: idea.cta.keyword?.toUpperCase() } : ctaFor(brain);
  // ~1 in 3 reels uses a HyperFrames template when that engine is available
  if (idea.type === "reel" && htmlTemplates.length && idx % 3 === 2) {
    const h = await tryLoad(loadHyperframes);
    if (h) {
      try {
        const tpl = pick(htmlTemplates, Math.floor(idx / 3));
        return h.buildFromTemplate(tpl.id, { brand: ref, scenes, cta });
      } catch (e: any) {
        console.warn("[plan] hyperframes template failed, using Remotion:", e?.message ?? e);
      }
    }
  }
  const spec: ReelSpec = {
    width: 1080,
    height: 1920,
    fps: 30,
    style,
    captionStyle: captionStyles.find((c) => c.id === idea.captionStyle)?.id ?? pick(captionStyles, idx)?.id,
    brand: ref,
    scenes,
    cta,
    ...(brandLanguage(brand) !== "en" ? { language: brandLanguage(brand) } : {}),
  };
  return spec;
}

/** Extra planning context (autopilot): content pillar, occasion, titles to avoid. */
export interface PlanContext {
  pillar?: string;
  occasion?: { name: string; date: string; angle?: string };
  avoidTitles?: string[];
}

export interface PlanOptions extends PlanContext {
  reels?: number;
  carousels?: number;
  stories?: number;
  images?: number;              // single-image feed posts (type "image")
  startDate?: string;
  render?: boolean;
  slots?: string[];             // explicit ISO slots (autopilot); otherwise next best-time slots
  extra?: Partial<Post>;        // fields merged into every new post (e.g. { autopilot: true, pillar })
}

const normTitle = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export async function planPosts(brand: Brand, opts: PlanOptions): Promise<Post[]> {
  const brain = ensureBrain(brand);
  const counts: Record<PostType, number> = {
    reel: clampN(opts.reels ?? (opts.images || opts.carousels || opts.stories ? 0 : 3)),
    carousel: clampN(opts.carousels ?? 0),
    story: clampN(opts.stories ?? 0),
    image: clampN(opts.images ?? 0),
  };
  const total = counts.reel + counts.carousel + counts.story + counts.image;
  if (!total) return [];
  const { styles, captionStyles, htmlTemplates } = await getStyles();
  const ctx: PlanContext = { pillar: opts.pillar, occasion: opts.occasion, avoidTitles: opts.avoidTitles };
  // heuristic brain variant that talks about the pillar
  const hBrain: BrandBrain = opts.pillar ? { ...brain, products: [opts.pillar, ...(brain.products ?? [])] } : brain;

  let ideas: Idea[] = [];
  if (llmAvailable() && counts.reel + counts.carousel + counts.story > 0) {
    try {
      ideas = await llmIdeas(brand, brain, counts, styles, captionStyles, ctx);
    } catch (e: any) {
      console.warn("[plan] LLM planning failed, using heuristic:", e?.message ?? e);
    }
  }
  // top up / trim per type with heuristics (skipping titles we already have)
  const offset = listPosts({ brandId: brand.id }).length;
  const seen = new Set([...listPosts({ brandId: brand.id }).slice(-60).map((p) => normTitle(p.title)), ...(opts.avoidTitles ?? []).map(normTitle)]);
  const final: Idea[] = [];
  for (const type of ["reel", "carousel", "story"] as PostType[]) {
    const ofType = ideas.filter((x) => x.type === type).slice(0, counts[type]);
    for (let k = ofType.length, tries = 0; ofType.length < counts[type]; k++, tries++) {
      const idea = heuristicIdea(type, hBrain, brand, offset + final.length + k);
      if (tries < 12 && seen.has(normTitle(idea.title))) continue;
      seen.add(normTitle(idea.title));
      ofType.push(idea);
    }
    final.push(...ofType);
  }
  if (counts.image) {
    const imgs = await planImageIdeas(brand, brain, counts.image, offset + final.length, { existingTitles: [...seen], pillar: opts.pillar, occasion: opts.occasion });
    final.push(...imgs.map((x): Idea => ({ type: "image", title: x.title, hook: x.hook, caption: x.caption, hashtags: x.hashtags, image: x.image, usePhoto: x.usePhoto })));
  }

  const from = opts.startDate && !isNaN(Date.parse(opts.startDate)) ? new Date(opts.startDate) : new Date();
  const slots = opts.slots?.length ? opts.slots : nextSlots(brain.bestTimes, final.length, from, takenSlots(brand.id));
  const media = await mediaPool(brand, brain);
  const posts: Post[] = [];
  let reelIdx = 0;
  for (let k = 0; k < final.length; k++) {
    const idea = final[k];
    const idx = idea.type === "reel" ? offset + reelIdx++ : offset + k;
    const spec = await ideaToSpec(idea, brand, brain, idx, styles, captionStyles, media, htmlTemplates);
    let p = newPost({
      brandId: brand.id,
      type: idea.type,
      title: idea.title,
      hook: idea.hook,
      caption: idea.caption,
      hashtags: idea.hashtags,
      spec,
      scheduledAt: slots[k],
    });
    if (opts.extra) p = savePost({ ...p, ...opts.extra });
    posts.push(p);
  }
  if (opts.render !== false) return posts.map((p) => enqueueRender(p.id) ?? p);
  return posts;
}

function clampN(n: unknown): number {
  const x = Math.floor(Number(n) || 0);
  return Math.max(0, Math.min(20, x));
}
