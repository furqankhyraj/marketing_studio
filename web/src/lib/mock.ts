// Dev-only in-memory mock of the HTTP API. Enabled only with ?mock=1 (see api.ts). Never used by default.
import type { Asset, Audit, Automation, Brand, BrandBrain, CommentLog, Post, ReelSpec, CarouselSpec } from "./types";
import { ApiError } from "./api";

const now = Date.now();
const iso = (offsetH: number) => new Date(now + offsetH * 3600_000).toISOString();
let seq = 100;
const id = () => `m${++seq}`;

const brain = (name: string, primary: string, accent: string): BrandBrain => ({
  summary: `${name} helps people learn and buy with confidence.`,
  products: ["Digital downloads", "Courses"],
  audience: "Busy adults aged 22-45 who want practical results",
  voice: "Warm, clear and encouraging",
  niche: "Education",
  colors: { primary, secondary: "#0f172a", accent, background: "#ffffff", text: "#0f172a" },
  fonts: { heading: "Poppins", body: "Inter" },
  claimsToAvoid: ["Guaranteed results"],
  differentiators: ["Handmade", "Personal feedback"],
  ctas: ["Link in bio"],
  keywords: ["learning", "smallbusiness"],
  contentPillars: ["Tips", "Behind the scenes", "Testimonials"],
  competitors: [],
  bestTimes: ["Tue 18:00", "Thu 12:30", "Sat 10:00"],
  language: "en",
});

const brands: Brand[] = [
  { id: "b1", name: "Saqqa Academy", website: "https://saqqa.academy", instagramHandle: "saqqa.academy", description: "Online Arabic & Quran academy",
    brain: brain("Saqqa Academy", "#0f766e", "#f59e0b"), analysisStatus: "done", igConnected: true, igUserId: "1789", createdAt: iso(-200), updatedAt: iso(-2) },
  { id: "b2", name: "Linen & Thread (Etsy)", website: "https://etsy.com/shop/example", instagramHandle: "linenandthread", description: "Handmade linen goods",
    brain: brain("Linen & Thread", "#9a3412", "#fde68a"), analysisStatus: "done", igConnected: false, createdAt: iso(-100), updatedAt: iso(-3) },
];

const reelSpec = (b: Brand, style = "cinematic"): ReelSpec => ({
  width: 1080, height: 1920, fps: 30, style, captionStyle: "white-pill",
  brand: { name: b.name, handle: `@${b.instagramHandle}`, colors: b.brain!.colors },
  scenes: [
    { id: "s1", durationSec: 3, headline: "Stop scrolling", subtext: "This changes everything", voiceoverText: "Stop scrolling for a second." },
    { id: "s2", durationSec: 4, headline: "3 tips in 30 seconds", voiceoverText: "Here are three tips you can use today." },
  ],
  cta: { text: "Comment GROW", keyword: "GROW" },
});
const carSpec = (b: Brand): CarouselSpec => ({
  width: 1080, height: 1350, style: "bold-minimal", brand: { name: b.name, colors: b.brain!.colors },
  slides: [{ headline: "5 mistakes" }, { headline: "Mistake #1", body: "Skipping basics" }, { headline: "Save this" }],
});

const mkPost = (b: Brand, p: Partial<Post>): Post => ({
  id: id(), brandId: b.id, type: "reel", status: "ready", title: "Untitled", hook: "A strong hook", caption: "Caption text here.",
  hashtags: ["learning", "tips"], spec: reelSpec(b), mediaUrls: [], revision: 1, changeRequests: [], createdAt: iso(-10), updatedAt: iso(-1), ...p,
});

const posts: Post[] = [
  mkPost(brands[0], { title: "Why Arabic feels hard (it isn't)", hook: "You're learning Arabic backwards", scheduledAt: iso(20) }),
  mkPost(brands[0], { title: "3 habits of fluent students", status: "rendering", renderProgress: 0.42, scheduledAt: iso(44) }),
  mkPost(brands[0], { title: "Tajweed in 30 seconds", status: "approved", scheduledAt: iso(70) }),
  mkPost(brands[0], { title: "Student story: Amina", status: "posted", scheduledAt: iso(-30), postedAt: iso(-30), igPermalink: "https://instagram.com/p/x" }),
  mkPost(brands[0], { title: "Mistakes beginners make", type: "carousel", spec: carSpec(brands[0]), status: "ready", scheduledAt: iso(96) }),
  mkPost(brands[0], { title: "HTML promo", status: "draft", spec: { engine: "hyperframes", width: 1080, height: 1920, durationSec: 12, html: "<!doctype html>\n<html>\n  <body>\n    <h1>Hello</h1>\n  </body>\n</html>" } }),
  mkPost(brands[1], { title: "How we dye linen", spec: reelSpec(brands[1], "warm-film"), scheduledAt: iso(30) }),
];

const assets: Asset[] = [];
const audits: Audit[] = [{
  id: "a1", brandId: "b1", summary: "Strong teaching content, but posting is irregular and hooks are slow.",
  strengths: ["Clear, trustworthy voice", "Consistent brand colors"], weaknesses: ["No reels in 30 days", "Hooks start after 3s"],
  opportunities: ["Short tajweed tips", "Student testimonials"],
  firstReels: [
    { title: "The 1 letter everyone mispronounces", hook: "Say this letter out loud…", why: "Interactive, high saves" },
    { title: "Arabic in 5 minutes a day", hook: "No time? Try this.", why: "Addresses main objection" },
    { title: "Before/after recitation", hook: "Week 1 vs week 12", why: "Social proof" },
  ], createdAt: iso(-5),
}];
const automations: Automation[] = [
  { id: "au1", brandId: "b1", keyword: "GROW", replyText: "Sent you a DM!", dmText: "Here is your free guide:", link: "https://saqqa.academy/guide", enabled: true, createdAt: iso(-50) },
];
const comments: CommentLog[] = [
  { id: "c1", brandId: "b1", igCommentId: "1", igMediaId: "m", username: "sara.k", text: "GROW please!", matchedKeyword: "GROW", replied: true, dmSent: true, createdAt: iso(-3) },
  { id: "c2", brandId: "b1", igCommentId: "2", igMediaId: "m", username: "omar_99", text: "Love this", replied: false, dmSent: false, createdAt: iso(-2) },
];
let settings = {
  anthropicApiKeySet: false, anthropicModel: "claude-sonnet-5-5", igAppSecretSet: false, timezone: "Asia/Karachi", autoPublish: true,
  voice: "af_heart", autoVoiceover: true, pexelsApiKeySet: false, pixabayApiKeySet: false, etsyApiKeySet: false,
} as Record<string, unknown>;

const styles = ["cinematic", "bold-minimal", "warm-film", "neon-pop", "editorial", "kinetic-type", "gradient-wave", "split-screen", "retro-vhs", "clean-corporate", "handwritten", "news-flash"]
  .map((s) => ({ id: s, name: s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), description: `A ${s.replace(/-/g, " ")} look for reels.`, tags: ["motion", "text"], supports: (s.length % 2 ? ["reel", "carousel"] : ["reel", "story"]) as ("reel" | "carousel" | "story")[] }));
const captionStyles = ["white-pill", "karaoke", "bold-outline", "minimal", "boxed", "typewriter"].map((c) => ({ id: c, name: c.replace(/-/g, " "), description: `${c} captions` }));
const htmlTemplates = ["promo-burst", "quote-card", "product-spin", "countdown", "listicle", "testimonial"].map((t) => ({ id: t, name: t.replace(/-/g, " "), description: `HTML/GSAP ${t} composition`, tags: ["gsap", "html"] }));
const voices = [{ id: "af_heart", name: "Heart", gender: "female", accent: "American" }, { id: "am_adam", name: "Adam", gender: "male", accent: "American" }, { id: "bf_emma", name: "Emma", gender: "female", accent: "British" }];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockHandle(method: string, path: string, body: any): Promise<unknown> {
  await sleep(150);
  if (/^\/api\/brands\/[^/]+\/etsy(\/|$|\?)/.test(path)) return (await import("./mockEtsy")).mockEtsy(method, path.split("?")[0], body, { brands, posts, mkPost }); // Etsy shop (mockEtsy.ts)
  const [p, qs] = path.split("?");
  const query = new URLSearchParams(qs ?? "");
  const seg = p.split("/").filter(Boolean).slice(1); // drop "api"
  const key = `${method} /${seg.map((s, i) => (i > 0 && /^(b\d|m\d+|a\w*\d|au\d+)$/.test(s) ? ":id" : s)).join("/")}`;
  const sid = seg.find((s, i) => i > 0 && /^(b\d|m\d+|a\w*\d|au\d+)$/.test(s)) ?? "";
  const brand = brands.find((b) => b.id === sid);
  const post = posts.find((x) => x.id === sid);
  const touch = <T extends { updatedAt?: string }>(o: T) => { o.updatedAt = new Date().toISOString(); return o; };

  switch (key) {
    case "GET /health": return { ok: true, version: "mock" };
    case "GET /settings": return settings;
    case "PATCH /settings": {
      const b = { ...body };
      if (b.anthropicApiKey) { settings.anthropicApiKeySet = true; delete b.anthropicApiKey; }
      if (b.igAppSecret) { settings.igAppSecretSet = true; delete b.igAppSecret; }
      if (b.pexelsApiKey) { settings.pexelsApiKeySet = true; delete b.pexelsApiKey; }
      if (b.pixabayApiKey) { settings.pixabayApiKeySet = true; delete b.pixabayApiKey; }
      if (b.etsyApiKey) { settings.etsyApiKeySet = true; delete b.etsyApiKey; }
      settings = { ...settings, ...b }; return settings;
    }
    case "GET /styles": return { styles, captionStyles, htmlTemplates };
    case "GET /voices": return voices;
    case "GET /music": return ["calm", "lofi", "upbeat", "inspiring", "cinematic", "playful", "elegant", "focus"].map((m) => ({ id: `builtin:${m}`, name: m[0].toUpperCase() + m.slice(1), mood: m, source: "builtin", url: "", durationSec: 30 }));
    case "POST /posts/:id/music": {
      if (!post) break;
      const sp = post.spec as unknown as Record<string, any>;
      if (body.trackId === null) { delete sp.music; sp.musicOff = true; }
      else if (body.trackId) { sp.music = { src: "", trackId: body.trackId === "auto" ? "builtin:calm" : body.trackId, volume: sp.music?.volume }; delete sp.musicOff; }
      if (typeof body.volume === "number" && sp.music) sp.music.volume = body.volume;
      return touch(post);
    }
    case "GET /stock": return Array.from({ length: 8 }, (_, i) => ({ id: `st${i}`, kind: query.get("kind"), url: `https://example.com/${i}`, previewUrl: `https://picsum.photos/seed/${query.get("query")}${i}/300/530`, width: 1080, height: 1920, credit: `Photographer ${i}`, source: i % 2 ? "pexels" : "pixabay" }));
    case "GET /brands": return brands;
    case "POST /brands": {
      const b: Brand = { id: `b${brands.length + 1}`, ...body, analysisStatus: "running", igConnected: false, createdAt: iso(0), updatedAt: iso(0) };
      brands.push(b);
      setTimeout(() => { b.brain = brain(b.name, "#7c3aed", "#ec4899"); b.analysisStatus = "done"; }, 6000);
      return b;
    }
    case "GET /brands/:id": if (!brand) break; return brand;
    case "PATCH /brands/:id": if (!brand) break; Object.assign(brand, body); return touch(brand);
    case "DELETE /brands/:id": if (!brand) break; brands.splice(brands.indexOf(brand), 1); return { ok: true };
    case "POST /brands/:id/analyze": if (!brand) break; brand.analysisStatus = "running"; setTimeout(() => (brand.analysisStatus = "done"), 5000); return brand;
    case "GET /brands/:id/assets": return assets.filter((a) => a.brandId === sid);
    case "POST /brands/:id/assets": {
      const files = (body as FormData).getAll("files") as File[];
      const out = files.map((f) => ({ id: id(), brandId: sid, kind: f.type.startsWith("video") ? "video" : f.type.startsWith("audio") ? "audio" : "image", url: URL.createObjectURL(f), path: f.name, originalName: f.name, mime: f.type, size: f.size, createdAt: iso(0) }) as Asset);
      assets.push(...out); return out;
    }
    case "POST /brands/:id/assets/from-stock": { const a: Asset = { id: id(), brandId: sid, kind: body.kind, url: `https://picsum.photos/seed/${seq}/300/530`, path: "", originalName: "stock", mime: "image/jpeg", size: 1, createdAt: iso(0) }; assets.push(a); return a; }
    case "POST /brands/:id/audit": { await sleep(1500); const a = { ...audits[0], id: id(), brandId: sid, createdAt: iso(0) }; audits.unshift(a); return a; }
    case "GET /brands/:id/audits": return audits.filter((a) => a.brandId === sid);
    case "POST /brands/:id/plan": {
      const out: Post[] = [];
      for (let i = 0; i < (body.reels ?? 0); i++) out.push(mkPost(brand!, { title: `Planned reel ${i + 1}`, status: "rendering", renderProgress: 0.1, scheduledAt: iso(24 * (i + 1)) }));
      for (let i = 0; i < (body.carousels ?? 0); i++) out.push(mkPost(brand!, { title: `Planned carousel ${i + 1}`, type: "carousel", spec: carSpec(brand!), status: "draft", scheduledAt: iso(36 * (i + 1)) }));
      for (let i = 0; i < (body.stories ?? 0); i++) out.push(mkPost(brand!, { title: `Planned story ${i + 1}`, type: "story", status: "draft", scheduledAt: iso(12 * (i + 1)) }));
      posts.push(...out); return out;
    }
    case "POST /brands/:id/html-reel-from-template": { const x = mkPost(brand!, { title: `From template ${body.templateId}`, status: "rendering", renderProgress: 0, spec: { engine: "hyperframes", width: 1080, height: 1920, durationSec: 10, html: "<html></html>", template: body.templateId } }); posts.push(x); return x; }
    case "GET /posts": return posts.filter((x) => (!query.get("brandId") || x.brandId === query.get("brandId")) && (!query.get("status") || x.status === query.get("status")));
    case "GET /posts/:id": if (!post) break; return post;
    case "PATCH /posts/:id": if (!post) break; Object.assign(post, body); return touch(post);
    case "DELETE /posts/:id": if (!post) break; posts.splice(posts.indexOf(post), 1); return { ok: true };
    case "POST /posts/:id/render": if (!post) break; post.status = "rendering"; post.renderProgress = 0; return touch(post);
    case "POST /posts/:id/approve": if (!post) break; post.status = "approved"; post.scheduledAt = body?.scheduledAt ?? post.scheduledAt ?? iso(24); return touch(post);
    case "POST /posts/:id/change": if (!post) break; post.status = "changes_requested"; post.changeRequests.push({ text: body.text, createdAt: iso(0) }); return touch(post);
    case "POST /posts/:id/publish": if (!post) break; post.status = "posted"; post.postedAt = iso(0); return touch(post);
    case "GET /calendar": {
      const from = +new Date(query.get("from")!), to = +new Date(query.get("to")!);
      return posts.filter((x) => x.scheduledAt && (!query.get("brandId") || x.brandId === query.get("brandId")) && +new Date(x.scheduledAt) >= from && +new Date(x.scheduledAt) <= to);
    }
    case "GET /brands/:id/automations": return automations.filter((a) => a.brandId === sid);
    case "POST /brands/:id/automations": { const a = { id: id(), brandId: sid, enabled: true, createdAt: iso(0), ...body }; automations.push(a); return a; }
    case "PATCH /automations/:id": { const a = automations.find((x) => x.id === sid); if (!a) break; Object.assign(a, body); return a; }
    case "DELETE /automations/:id": { const i = automations.findIndex((x) => x.id === sid); automations.splice(i, 1); return { ok: true }; }
    case "GET /brands/:id/comments": return comments.filter((c) => c.brandId === sid);
    case "POST /brands/:id/instagram/token": if (!brand) break; brand.igConnected = true; return brand;
    case "DELETE /brands/:id/instagram": if (!brand) break; brand.igConnected = false; return brand;
    case "GET /instagram/auth-url": throw new ApiError("Set your Instagram App ID in Settings first (mock)", 400);
    case "GET /brands/:id/instagram/insights": return { followers: 12840, mediaCount: 212, recent: [{ id: "r1", caption: "Student story", likeCount: 432, commentsCount: 51, permalink: "https://instagram.com", timestamp: iso(-30) }] };
    case "GET /mcp/config": return { claudeDesktopConfigSnippet: { mcpServers: { "social-mcp-studio": { command: "npx", args: ["tsx", "C:\\Users\\you\\Social_MCP\\mcp\\src\\index.ts"], env: { SOCIAL_MCP_API: "http://localhost:4300" } } } }, configPath: "%APPDATA%\\Claude\\claude_desktop_config.json" };
  }
  throw new ApiError(`Not found (mock): ${method} ${p}`, 404);
}

// Simulate render progress in mock mode.
setInterval(() => {
  for (const p of posts) {
    if (p.status === "rendering") {
      p.renderProgress = Math.min(1, (p.renderProgress ?? 0) + 0.08);
      if (p.renderProgress >= 1) { p.status = "ready"; p.renderProgress = undefined; }
    } else if (p.status === "changes_requested" && Math.random() < 0.15) { p.status = "ready"; p.revision++; }
  }
}, 1000);
