// Unit tests for Instagram growth features: hashtag cap, captions, container param builders and the full
// publishPost request sequence with a stubbed fetch (never calls the real Instagram API).
// Run: cd server && npm test   (uses a throwaway DATA_DIR in the OS temp folder)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "growth-test-"));
process.env.DATA_DIR = DATA;
process.env.SERVER_URL = "http://localhost:4399";
delete process.env.IG_DISABLE_PARAMS;

const hashtags = await import("../src/hashtags.ts");
const igp = await import("../src/igparams.ts");
const db = await import("../src/db.ts");
const ig = await import("../src/instagram.ts");
const { heuristicAltText } = await import("../src/alttext.ts");
const { scoreHookHeuristic } = await import("../src/growth.ts");
import type { Brand, Post } from "../../shared/types.ts";

// ---------- fetch stub ----------
type Call = { url: string; method: string; body: any; headers: Record<string, string> };
let calls: Call[] = [];
let failFirstMediaWith: string | undefined;
const realFetch = globalThis.fetch;
let n = 0;
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}
before(() => {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    let body: any = init.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* form */
      }
    } else if (body && !(typeof body === "string")) body = "<binary>";
    calls.push({ url, method, body, headers: init.headers ?? {} });
    if (!url.startsWith("https://graph.instagram.com/") && !url.startsWith("https://rupload.facebook.com/")) throw new Error(`unexpected host ${url}`);
    if (url.startsWith("https://rupload.facebook.com/")) return json({ success: true });
    if (method === "POST" && /\/media$/.test(url)) {
      if (failFirstMediaWith) {
        const m = failFirstMediaWith;
        failFirstMediaWith = undefined;
        return json({ error: { message: m, code: 100 } }, 400);
      }
      const id = `c${++n}`;
      return json({ id, uri: `https://rupload.facebook.com/ig-api-upload/v23.0/${id}` });
    }
    if (method === "POST" && /\/media_publish$/.test(url)) return json({ id: "m-published" });
    if (method === "GET" && url.includes("fields=status_code")) return json({ status_code: "FINISHED" });
    if (method === "GET" && url.includes("fields=permalink")) return json({ permalink: "https://instagram.com/p/x" });
    return json({ error: { message: "unhandled stub route" } }, 500);
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  try {
    db.db.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(DATA, { recursive: true, force: true });
});

// ---------- fixtures ----------
const now = new Date().toISOString();
const brand: Brand = {
  id: "b1",
  name: "Saqqa Academy",
  analysisStatus: "done",
  igConnected: true,
  igUserId: "1789",
  createdAt: now,
  updatedAt: now,
  brain: {
    summary: "AI video courses",
    products: ["AI Video Pro course: Rs 3999 launch price (Rs 5999 regular)"],
    audience: "creators",
    voice: "friendly",
    niche: "AI video & creative skills education",
    colors: { primary: "#111111", secondary: "#222222", accent: "#ff0066", background: "#000000", text: "#ffffff" },
    claimsToAvoid: [],
    differentiators: [],
    ctas: [],
    keywords: ["AIVideo", "AIVideoCourse", "LearnAI", "GoogleFlow", "sold", "hand"],
    contentPillars: [],
  },
};
db.saveBrand(brand);
db.setIgCreds("b1", { token: "TEST_TOKEN_not_real_123456", expires: new Date(Date.now() + 30 * 86400000).toISOString(), username: "saqqa" });

const videoDir = path.join(DATA, "renders", "p", "r1");
fs.mkdirSync(videoDir, { recursive: true });
fs.writeFileSync(path.join(videoDir, "reel.mp4"), Buffer.alloc(64));
const fileUrl = (rel: string) => `http://localhost:4399/files/${rel}`;

function mkPost(o: Partial<Post>): Post {
  return db.savePost({
    id: o.id ?? `p${Math.random().toString(36).slice(2, 8)}`,
    brandId: "b1",
    type: "reel",
    status: "approved",
    title: "AI video course",
    hook: "Nobody tells you this about AI video",
    caption: "AI video course: nobody tells you this\n\nComment LEARN",
    hashtags: ["aivideo", "learnai", "aivideocourse", "googleflow", "klingai", "extra6", "extra7"],
    spec: { width: 1080, height: 1920, fps: 30, style: "cinematic", brand: { name: "Saqqa Academy", colors: brand.brain!.colors }, scenes: [{ id: "s1", durationSec: 2, headline: "Hook" }] },
    mediaUrls: [fileUrl("renders/p/r1/reel.mp4")],
    revision: 1,
    changeRequests: [],
    createdAt: now,
    updatedAt: now,
    ...o,
  } as Post);
}
const mediaCalls = () => calls.filter((c) => c.method === "POST" && /\/media$/.test(c.url));

// ---------- pure helpers ----------
test("capHashtags trims to 5, strips # and dedupes", () => {
  assert.deepEqual(hashtags.capHashtags(["#AI", "ai", "b c", "#dd!", "x", "ee", "ff", "gg"]), ["ai", "bc", "dd", "ee", "ff"]);
});

test("savePost enforces the 5-hashtag cap", () => {
  const p = mkPost({ id: "cap" });
  assert.equal(db.getPost(p.id)!.hashtags.length, 5);
});

test("composeCaption counts inline hashtags toward the cap", () => {
  const c = hashtags.composeCaption("Learn #ai #video #course today", ["one", "two", "three", "four"]);
  assert.equal(hashtags.countHashtags(c), 5);
  assert.match(c, /#ai #video #course/);
  const many = hashtags.composeCaption("#a #b #c #d #e #f #g", ["h"]);
  assert.equal(hashtags.countHashtags(many), 5);
});

test("heuristic hashtags: specific niche tags, no generic words, max 5", () => {
  const tags = hashtags.heuristicHashtags(brand.brain!, "ai video pro course");
  assert.ok(tags.length > 0 && tags.length <= 5, String(tags));
  for (const bad of ["sold", "hand", "video", "course"]) assert.ok(!tags.includes(bad), `generic tag ${bad} in ${tags}`);
  assert.ok(tags.includes("aivideocourse"), String(tags));
  const etsy = hashtags.heuristicHashtags(
    { ...brand.brain!, niche: "handmade & gifts", summary: "Handmade jewelry on Etsy", products: ["Custom orders"], keywords: ["sold", "hand", "necklace"] },
    "birthstone necklace",
  );
  assert.ok(!etsy.includes("sold") && !etsy.includes("hand"), String(etsy));
  assert.ok(etsy.includes("handmadegifts") || etsy.includes("etsyfinds"), String(etsy));
});

test("keyword-first caption puts the keyword in line 1", () => {
  const c = hashtags.keywordFirstCaption({ hook: "Why people choose us", keyword: "ai video course", body: "Body", cta: "Comment LEARN" });
  assert.equal(c.split("\n")[0], "Ai video course: Why people choose us");
  assert.ok(c.trim().endsWith("Comment LEARN"));
});

test("hook heuristic scoring rewards short specific curiosity hooks", () => {
  const good = scoreHookHeuristic("3 AI video mistakes nobody tells you", "ai video");
  const bad = scoreHookHeuristic("Here are some amazing things that you might want to know about our stuff today", "ai video");
  assert.ok(good.score > bad.score, `${good.score} vs ${bad.score}`);
});

test("reel extras: cover_url only with publicBaseUrl, else thumb_offset; trial + collaborators + audio_name", () => {
  const base = { type: "reel" as const, coverUrl: fileUrl("renders/p/r1/cover.jpg?v=1") };
  const withPub = igp.reelContainerExtras(
    { ...base, trial: { enabled: true, graduation: "SS_PERFORMANCE" }, collaborators: ["@Some.User", "two", "three", "four"] },
    { publicBaseUrl: "https://tunnel.example.com/", brandName: "Saqqa" },
  );
  assert.equal(withPub.cover_url, "https://tunnel.example.com/files/renders/p/r1/cover.jpg?v=1");
  assert.equal(withPub.thumb_offset, undefined);
  assert.deepEqual(withPub.trial_params, { graduation_strategy: "SS_PERFORMANCE" });
  assert.deepEqual(withPub.collaborators, ["some.user", "two", "three"]);
  assert.equal(withPub.audio_name, "Saqqa original audio");
  const noPub = igp.reelContainerExtras({ ...base, audioName: "" }, { brandName: "Saqqa" });
  assert.equal(noPub.cover_url, undefined);
  assert.equal(noPub.thumb_offset, 1000);
  assert.equal(noPub.audio_name, undefined);
  assert.deepEqual(igp.reelContainerExtras({ type: "story", trial: { enabled: true, graduation: "MANUAL" } }, {}), {});
  const disabled = igp.reelContainerExtras({ type: "reel", audioName: "X", collaborators: ["a"] }, { disabled: igp.disabledFromEnv("audio_name, collaborators") });
  assert.equal(disabled.audio_name, undefined);
  assert.equal(disabled.collaborators, undefined);
});

test("heuristic alt text describes each slide", () => {
  const alt = heuristicAltText(
    { type: "carousel", mediaUrls: ["a", "b"], spec: { width: 1080, height: 1350, style: "x", brand: { name: "B", colors: brand.brain!.colors }, slides: [{ headline: "Hello" }, { headline: "World", body: "More" }] } },
    "Saqqa",
  );
  assert.equal(alt.length, 2);
  assert.match(alt[0], /Slide 1 of 2: .*"Hello"/);
  assert.match(alt[1], /"World" and the text "More"/);
});

// ---------- full publish flow with stubbed fetch ----------
test("publish reel: resumable container carries trial_params, collaborators, audio_name, cover_url; ≤5 hashtags", async () => {
  calls = [];
  db.setSetting("publicBaseUrl", "https://tunnel.example.com");
  const p = mkPost({
    id: "reel1",
    trial: { enabled: true, graduation: "MANUAL" },
    collaborators: ["friend.one"],
    coverUrl: fileUrl("renders/p/r1/cover.jpg"),
  });
  const out = await ig.publishPost(p.id);
  assert.equal(out.status, "posted");
  const [c] = mediaCalls();
  assert.equal(c.url, "https://graph.instagram.com/" + (process.env.IG_API_VERSION || "v23.0") + "/1789/media");
  assert.equal(c.body.media_type, "REELS");
  assert.equal(c.body.upload_type, "resumable");
  assert.deepEqual(c.body.trial_params, { graduation_strategy: "MANUAL" });
  assert.deepEqual(c.body.collaborators, ["friend.one"]);
  assert.equal(c.body.audio_name, "Saqqa Academy original audio");
  assert.equal(c.body.cover_url, "https://tunnel.example.com/files/renders/p/r1/cover.jpg");
  assert.equal(c.body.thumb_offset, undefined);
  assert.equal(c.body.share_to_feed, undefined, "trial reels omit share_to_feed");
  assert.equal(c.body.alt_text, undefined, "reels never get alt_text");
  assert.ok(hashtags.countHashtags(c.body.caption) <= 5);
  assert.ok(calls.some((x) => x.url.startsWith("https://rupload.facebook.com/")));
  assert.ok(calls.some((x) => /media_publish$/.test(x.url)));
});

test("publish reel without publicBaseUrl: thumb_offset instead of cover_url, share_to_feed kept", async () => {
  calls = [];
  db.setSetting("publicBaseUrl", null);
  const p = mkPost({ id: "reel2", coverUrl: fileUrl("renders/p/r1/cover.jpg"), audioName: "", coverThumbOffsetMs: 1500 });
  await ig.publishPost(p.id);
  const [c] = mediaCalls();
  assert.equal(c.body.cover_url, undefined);
  assert.equal(c.body.thumb_offset, 1500);
  assert.equal(c.body.share_to_feed, true);
  assert.equal(c.body.audio_name, undefined);
  assert.equal(c.body.trial_params, undefined);
});

test("publish carousel: alt_text on each child, collaborators on parent only", async () => {
  calls = [];
  db.setSetting("publicBaseUrl", "https://tunnel.example.com");
  const p = mkPost({
    id: "car1",
    type: "carousel",
    collaborators: ["@Partner"],
    altText: ["First slide alt", "", ""],
    mediaUrls: [fileUrl("renders/car1/r1/slide-01.png"), fileUrl("renders/car1/r1/slide-02.png")],
    spec: { width: 1080, height: 1350, style: "bold-pop", brand: { name: "Saqqa Academy", colors: brand.brain!.colors }, slides: [{ headline: "A" }, { headline: "B" }] },
  });
  await ig.publishPost(p.id);
  const m = mediaCalls();
  assert.equal(m.length, 3);
  assert.equal(m[0].body.is_carousel_item, true);
  assert.equal(m[0].body.alt_text, "First slide alt");
  assert.equal(m[1].body.alt_text, undefined, "stored alt text wins; blank entries are skipped");
  assert.equal(m[0].body.collaborators, undefined);
  assert.equal(m[2].body.media_type, "CAROUSEL");
  assert.deepEqual(m[2].body.collaborators, ["partner"]);
  assert.equal(m[2].body.alt_text, undefined);
});

test("publish carousel without stored alt text uses heuristic alt text", async () => {
  calls = [];
  const p = mkPost({
    id: "car2",
    type: "carousel",
    mediaUrls: [fileUrl("renders/car2/r1/slide-01.png"), fileUrl("renders/car2/r1/slide-02.png")],
    spec: { width: 1080, height: 1350, style: "bold-pop", brand: { name: "Saqqa Academy", colors: brand.brain!.colors }, slides: [{ headline: "A" }, { headline: "B" }] },
  });
  await ig.publishPost(p.id);
  const m = mediaCalls();
  assert.match(String(m[0].body.alt_text), /"A"/);
  assert.match(String(m[1].body.alt_text), /"B"/);
});

test("publish story: no growth params", async () => {
  calls = [];
  const p = mkPost({ id: "story1", type: "story", collaborators: ["x"], trial: { enabled: true, graduation: "MANUAL" } });
  await ig.publishPost(p.id);
  const [c] = mediaCalls();
  assert.equal(c.body.media_type, "STORIES");
  for (const k of igp.OPTIONAL_IG_PARAMS) assert.equal(c.body[k], undefined, k);
  assert.equal(c.body.caption, undefined);
});

test("rejected optional param → retried once without growth params, warning recorded", async () => {
  calls = [];
  failFirstMediaWith = "Invalid parameter: collaborators";
  const p = mkPost({ id: "reel3", collaborators: ["friend.one"], trial: { enabled: true, graduation: "MANUAL" } });
  const out = await ig.publishPost(p.id);
  const m = mediaCalls();
  assert.equal(m.length, 2);
  assert.deepEqual(m[0].body.collaborators, ["friend.one"]);
  for (const k of igp.OPTIONAL_IG_PARAMS) assert.equal(m[1].body[k], undefined, k);
  assert.equal(out.status, "posted");
  assert.match(out.publishWarnings?.[0] ?? "", /collaborators/);
});

// ---------- single-image feed posts (type "image") ----------
const imageSpec = (o: Record<string, unknown> = {}) => ({
  kind: "image" as const, width: 1080, height: 1350, design: "tip" as const, style: "clarity",
  brand: { name: "Saqqa Academy", colors: brand.brain!.colors }, headline: "3 ways to read faster", bullets: ["Pause at waqf", "Stretch madd"], ...o,
});

test("image container builder: image_url + caption + alt_text + collaborators, no media_type", () => {
  const body = igp.imageContainerBody({ altText: ["Tip card alt"], collaborators: ["@Friend.One", "bad name!"] }, "https://t.example/files/x.jpg", "Caption");
  assert.deepEqual(body, { image_url: "https://t.example/files/x.jpg", caption: "Caption", alt_text: "Tip card alt", collaborators: ["friend.one"] });
  assert.equal("media_type" in body, false);
  const off = igp.imageContainerBody({ altText: ["x"], collaborators: ["a"] }, "u", "c", { disabled: ["alt_text", "collaborators"] });
  assert.deepEqual(off, { image_url: "u", caption: "c" });
});

test("heuristic alt text for an image post describes design + text", () => {
  const [alt] = heuristicAltText({ type: "image", spec: imageSpec() as any, mediaUrls: ["x"] }, "Saqqa Academy");
  assert.match(alt, /Saqqa Academy tip card/);
  assert.match(alt, /"3 ways to read faster"/);
  assert.match(alt, /Pause at waqf/);
});

test("publish image post: one public JPEG container with caption + heuristic alt_text, then media_publish", async () => {
  calls = [];
  db.setSetting("publicBaseUrl", "https://tunnel.example.com");
  const p = mkPost({ id: "img1", type: "image", collaborators: ["partner"], spec: imageSpec() as any, mediaUrls: [fileUrl("renders/img1/r1/image.jpg")] });
  const out = await ig.publishPost(p.id);
  const m = mediaCalls();
  assert.equal(m.length, 1);
  assert.equal(m[0].body.image_url, "https://tunnel.example.com/files/renders/img1/r1/image.jpg");
  assert.equal(m[0].body.media_type, undefined);
  assert.match(String(m[0].body.caption), /AI video course/);
  assert.match(String(m[0].body.alt_text), /tip card/);
  assert.deepEqual(m[0].body.collaborators, ["partner"]);
  assert.ok(calls.some((c) => /\/media_publish$/.test(c.url) && c.body.creation_id === "c" + n));
  assert.equal(out.status, "posted");
});

test("publish image post without publicBaseUrl fails with a clear message and makes no container", async () => {
  calls = [];
  db.setSetting("publicBaseUrl", undefined);
  const p = mkPost({ id: "img2", type: "image", spec: imageSpec() as any, mediaUrls: [fileUrl("renders/img2/r1/image.jpg")] });
  await assert.rejects(() => ig.publishPost(p.id), /public URL/);
  assert.equal(mediaCalls().length, 0);
  assert.equal(db.getPost("img2")!.status, "failed");
});
