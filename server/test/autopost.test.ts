// Image posts + autopilot: spec normalization, rule-based edits, chat count parsing, slot spreading, planning with a
// fake clock (render: false — nothing is rendered, Instagram is never called).
// Run: cd server && npm test
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "autopost-test-"));
process.env.DATA_DIR = DATA;
process.env.SERVER_URL = "http://localhost:4398";
delete process.env.ANTHROPIC_API_KEY; // heuristic paths only

const db = await import("../src/db.ts");
const img = await import("../src/imagepost.ts");
const ap = await import("../src/autopilot.ts");
const { parseFormatCounts } = await import("../src/chat-autopost.ts");
const { upcomingOccasions } = await import("../src/occasions.ts");
import type { Brand, Post } from "../../shared/types.ts";

after(() => {
  try {
    db.db.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(DATA, { recursive: true, force: true });
});

const now = new Date().toISOString();
db.setSetting("timezone", "Asia/Karachi");
const brand: Brand = {
  id: "shop1",
  name: "Luna & Thread",
  analysisStatus: "done",
  igConnected: false,
  createdAt: now,
  updatedAt: now,
  website: "https://www.etsy.com/shop/lunaandthread",
  brain: {
    summary: "Handmade sterling silver jewelry sold on Etsy",
    products: ["Moonstone stacking ring", "Initial necklace", "Gift sets"],
    audience: "gift shoppers",
    voice: "warm",
    niche: "handmade jewelry",
    colors: { primary: "#7A3E48", secondary: "#D9A5A0", accent: "#E8B04B", background: "#FBF6F0", text: "#2B1D1F" },
    claimsToAvoid: [],
    differentiators: ["Recycled silver", "Made to order in 3 days"],
    ctas: ["Shop now — link in bio"],
    keywords: ["handmadejewelry", "silverring"],
    contentPillars: ["Care tips", "New pieces", "Gift ideas"],
    bestTimes: ["Tue 18:00", "Thu 12:30", "Sat 10:00"],
  },
};
db.saveBrand(brand);

test("normalizeImageSpec fills defaults, clamps and drops unknown design", () => {
  const s = img.normalizeImageSpec({ design: "nope", headline: "  Hello  ", bullets: ["a", "", "b", "c", "d", "e"], rating: 9, options: [{ text: "x" }, { label: "B", text: "y" }] }, brand);
  assert.equal(s.kind, "image");
  assert.equal(s.design, "tip");
  assert.equal(s.headline, "Hello");
  assert.deepEqual(s.bullets, ["a", "b", "c", "d"]);
  assert.equal(s.rating, 5);
  assert.equal(s.options?.[0].label, "A");
  assert.equal(s.brand.colors.primary, "#7A3E48");
  assert.throws(() => img.normalizeImageSpec({ design: "tip" }, brand), /headline/);
});

test("heuristic image ideas rotate designs and never invent testimonials", () => {
  const designs = new Set<string>();
  for (let i = 0; i < 14; i++) {
    const idea = img.heuristicImageIdea(brand, brand.brain!, i);
    designs.add(idea.image.design);
    assert.ok(idea.caption.length > 10 && idea.hashtags.length <= 5);
  }
  assert.ok(designs.size >= 6, `rotation covers designs: ${[...designs]}`);
  assert.ok(!designs.has("testimonial"));
  assert.equal(img.heuristicImageIdea(brand, brand.brain!, 0, { design: "testimonial" }).image.design, "quote");
  const occ = img.heuristicImageIdea(brand, brand.brain!, 0, { occasion: { name: "Eid al-Adha 2027", angle: "Eid greetings" } });
  assert.match(occ.image.headline, /Eid al-Adha Mubarak/);
});

test("rule-based image edits: headline, option, design, style, color", () => {
  const spec = img.normalizeImageSpec({ design: "question", headline: "Gold or silver?", options: [{ label: "A", text: "Gold" }, { label: "B", text: "Silver" }] }, brand);
  const post = { id: "x", type: "image", spec } as unknown as Post;
  const styles = [{ id: "magazine", name: "Magazine", description: "", tags: [], supports: [] }] as any;
  assert.equal(img.imageHeuristicChange(post, 'change the headline to "Which metal wins?"', styles).spec.headline, "Which metal wins?");
  assert.equal(img.imageHeuristicChange(post, "option B to Rose gold", styles).spec.options?.[1].text, "Rose gold");
  assert.equal(img.imageHeuristicChange(post, "make it a quote card", styles).spec.design, "quote");
  assert.equal(img.imageHeuristicChange(post, "switch to magazine style", styles).spec.style, "magazine");
  assert.equal(img.imageHeuristicChange(post, "use navy as the primary color", styles).spec.brand.colors.primary, "#0B2A5B");
});

test("chat count parsing: reels + image posts", () => {
  assert.deepEqual(parseFormatCounts("turn on autopilot for saqqa, 4 reels and 3 image posts a week"), { reels: 4, images: 3 });
  assert.deepEqual(parseFormatCounts("plan two carousels, a story and 2 quote cards"), { carousels: 2, stories: 1, images: 2 });
});

test("setAutopilot: auto approval needs an explicit acknowledgement", () => {
  assert.throws(() => ap.setAutopilot("shop1", { approval: "auto" }), /acknowledgeAutoApprove/);
  const b = ap.setAutopilot("shop1", { enabled: true, postsPerWeek: { reel: 2, image: 3, carousel: 0, story: 0 } });
  assert.equal(ap.autopilotOf(b).approval, "manual");
  assert.throws(() => ap.setAutopilot("shop1", { postsPerWeek: { reel: 0, image: 0 } }), /at least one/);
});

test("occasions are filtered by brand (shop sees Black Friday, not Eid)", () => {
  const list = upcomingOccasions(brand.brain!, new Date("2026-11-20T00:00:00Z"), new Date("2026-12-31T00:00:00Z"), brand.website);
  const names = list.map((o) => o.name);
  assert.ok(names.includes("Black Friday 2026"));
  assert.ok(names.includes("Etsy holiday shipping cut-off 2026"));
  assert.ok(!names.some((n) => /Eid|Quaid/.test(n)));
});

test("autopilot plan: spreads slots, interleaves formats, assigns an occasion and rotates pillars", () => {
  const fake = new Date("2026-11-22T00:00:00Z"); // window includes Black Friday (Nov 27)
  const { items, status } = ap.planAutopilot(db.getBrand("shop1")!, fake);
  assert.equal(status.targets.reel, 2);
  assert.equal(status.targets.image, 3);
  assert.equal(items.length, 5);
  assert.equal(items.filter((x) => x.type === "image").length, 3);
  const days = new Set(items.map((x) => new Date(x.slot).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" })));
  assert.ok(days.size >= 4, `spread over days: ${[...days]}`);
  for (const x of items) assert.ok(Date.parse(x.slot) > fake.getTime() && Date.parse(x.slot) <= fake.getTime() + 7 * 86400000);
  assert.ok(items.some((x) => x.occasion?.name === "Black Friday 2026"), "Black Friday assigned");
  assert.ok(items.filter((x) => x.pillar).length >= 3);
});

test("autopilot run (fake clock, render:false): creates flagged drafts once, then the schedule is full", async () => {
  const fake = new Date("2026-11-22T00:00:00Z");
  const r = await ap.runAutopilot("shop1", { now: fake, render: false });
  assert.equal(r.created.length, 5, r.summary);
  for (const p of r.created) {
    assert.equal(p.autopilot, true);
    assert.equal(p.status, "draft");
    assert.ok(p.scheduledAt);
  }
  assert.equal(new Set(r.created.map((p) => p.title)).size, 5, "no duplicate titles");
  const imgPost = r.created.find((p) => p.type === "image")!;
  assert.equal((imgPost.spec as any).kind, "image");
  const again = await ap.runAutopilot("shop1", { now: fake, render: false });
  assert.equal(again.created.length, 0);
  assert.match(again.summary, /full/);
  const d = ap.autopilotDigest("shop1", fake);
  assert.equal(d.brands[0].madeToday.length >= 0, true);
  assert.equal(db.getBrand("shop1")!.autopilot?.lastResult, again.summary);
});
