// Etsy import + listing → posts, with a stubbed fetch (never calls Etsy). Fixtures follow the Open API v3
// response shapes (findShops, findAllActiveListingsByShop, getListingsByListingIds + Images, getReviewsByShop)
// and the shop RSS feed format.
// Run: cd server && npm test   (throwaway DATA_DIR in the OS temp folder)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-test-"));
process.env.DATA_DIR = DATA;
process.env.SERVER_URL = "http://localhost:4398";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ETSY_API_KEY;

const client = await import("../src/etsy-client.ts");
const db = await import("../src/db.ts");
const etsy = await import("../src/etsy.ts");
import type { Brand } from "../../shared/types.ts";

// ---------- fixtures ----------
const SHOP_ID = 12345678;
const img = (listing: number, n: number) => ({
  listing_id: listing,
  listing_image_id: listing * 10 + n,
  rank: n,
  url_75x75: `https://i.etsystatic.com/${SHOP_ID}/r/il/abc/${listing}${n}/il_75x75.${listing}${n}_x.jpg`,
  url_570xN: `https://i.etsystatic.com/${SHOP_ID}/r/il/abc/${listing}${n}/il_570xN.${listing}${n}_x.jpg`,
  url_fullxfull: `https://i.etsystatic.com/${SHOP_ID}/r/il/abc/${listing}${n}/il_fullxfull.${listing}${n}_x.jpg`,
  full_height: 2000,
  full_width: 2000,
});
const listing = (id: number, title: string, amount: number, fav: number, created: number, extra: Record<string, unknown> = {}) => ({
  listing_id: id,
  shop_id: SHOP_ID,
  title,
  description:
    "Handmade with love in my little studio.\n\n• Glass seed beads and 14k gold filled clasp\n• Adjustable length: 6 to 8 inches\n• Arrives gift-wrapped\n\nSHIPPING: ships in 1-3 business days. Questions? Message me!",
  state: "active",
  created_timestamp: created,
  url: `https://www.etsy.com/listing/${id}/${title.toLowerCase().replace(/\W+/g, "-")}?utm_source=x`,
  num_favorers: fav,
  views: fav * 10,
  tags: ["beaded bracelet", "seed bead bracelet", "boho jewelry", "gift for her", "friendship bracelet"],
  materials: ["glass seed beads", "gold filled"],
  price: { amount, divisor: 100, currency_code: "USD" },
  images: [img(id, 2), img(id, 1), img(id, 3)],
  ...extra,
});
const LISTINGS = [
  listing(1001, "Beaded Daisy Bracelet | Seed Bead Flower Bracelet, Boho Gift", 2400, 52, 1790000000),
  listing(1002, "Pearl &amp; Bead Necklace • Dainty Layering Necklace", 3850, 12, 1795000000),
  listing(1003, "Rainbow Friendship Bracelet Set of 3", 1800, 99, 1780000000),
];
const REVIEWS = [
  { shop_id: SHOP_ID, listing_id: 1001, rating: 5, review: "Absolutely beautiful bracelet, even prettier in person! Fast shipping too.", created_timestamp: 1795500000 },
  { shop_id: SHOP_ID, listing_id: 1001, rating: 2, review: "Too small for me.", created_timestamp: 1795400000 },
  { shop_id: SHOP_ID, listing_id: 1003, rating: 5, review: "My daughter loves these &amp; wears them every day.", created_timestamp: 1795300000 },
];
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>Etsy Shop for BeadsByTest</title><link>https://www.etsy.com/shop/BeadsByTest?ref=rss</link>
<item>
  <title>Beaded Daisy Bracelet | Seed Bead Flower Bracelet by BeadsByTest</title>
  <description>&lt;p class=&quot;image&quot;&gt;&lt;img src=&quot;https://i.etsystatic.com/${SHOP_ID}/r/il/abc/10012/il_570xN.10012_x.jpg&quot; width=&quot;570&quot; /&gt;&lt;/p&gt;&lt;p class=&quot;price&quot;&gt;24.00 USD&lt;/p&gt;&lt;p class=&quot;description&quot;&gt;Handmade daisy bracelet.&lt;br /&gt;&lt;br /&gt;• Glass seed beads&amp;#39; finish&lt;/p&gt;</description>
  <pubDate>Wed, 11 Nov 2026 13:20:43 -0500</pubDate>
  <link>https://www.etsy.com/listing/1001/beaded-daisy-bracelet?ref=rss</link>
  <guid>https://www.etsy.com/listing/1001/beaded-daisy-bracelet1794421243</guid>
</item>
</channel></rss>`;

// ---------- fetch stub ----------
type Call = { url: string; headers: Record<string, string> };
let calls: Call[] = [];
let rejectKey = false;
const realFetch = globalThis.fetch;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
before(() => {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    calls.push({ url, headers: init.headers ?? {} });
    const u = new URL(url);
    if (u.host === "i.etsystatic.com") return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    if (u.host === "www.etsy.com" && u.pathname === "/shop/BeadsByTest/rss") return new Response(RSS, { status: 200, headers: { "Content-Type": "text/xml" } });
    if (u.host !== "openapi.etsy.com") throw new Error(`unexpected host ${url}`);
    if (rejectKey) return json({ error: "Shared secret is required in x-api-key header." }, 403);
    const p = u.pathname.replace("/v3/application", "");
    if (p === "/shops") return json({ count: 2, results: [{ shop_id: 1, shop_name: "BeadsByTestToo" }, { shop_id: SHOP_ID, shop_name: "BeadsByTest", title: "Handmade beaded jewelry", url: "https://www.etsy.com/shop/BeadsByTest?ref=api", currency_code: "USD", review_average: 4.9, review_count: 128, listing_active_count: 3 }] });
    if (p === `/shops/${SHOP_ID}/listings/active`) return json({ count: 3, results: LISTINGS.map(({ images, views, ...x }) => x) });
    if (p === "/listings/batch") {
      assert.equal(u.searchParams.get("includes"), "Images");
      const ids = u.searchParams.get("listing_ids")!.split(",").map(Number);
      return json({ count: ids.length, results: LISTINGS.filter((l) => ids.includes(l.listing_id)) });
    }
    if (p === `/shops/${SHOP_ID}/reviews`) return json({ count: REVIEWS.length, results: REVIEWS });
    return json({ error: "unhandled stub route" }, 500);
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  try {
    fs.rmSync(DATA, { recursive: true, force: true });
  } catch {
    /* Windows keeps the open SQLite file locked */
  }
});

function mkBrand(extra: Partial<Brand> = {}): Brand {
  const now = new Date().toISOString();
  return db.saveBrand({ id: `b${Math.random().toString(36).slice(2, 8)}`, name: "Beads By Test", instagramHandle: "beadsbytest", analysisStatus: "idle", igConnected: false, createdAt: now, updatedAt: now, ...extra });
}

// ---------- pure helpers ----------
test("parseShopName accepts names and URLs", () => {
  assert.equal(client.parseShopName("BeadsByTest"), "BeadsByTest");
  assert.equal(client.parseShopName("https://www.etsy.com/shop/BeadsByTest?ref=simple-shop-header-name"), "BeadsByTest");
  assert.equal(client.parseShopName("etsy.com/uk/shop/BeadsByTest"), "BeadsByTest");
  assert.equal(client.parseShopName("https://beadsbytest.etsy.com"), "beadsbytest");
  assert.equal(client.parseShopName("https://www.etsy.com/listing/1001/x"), undefined);
  assert.equal(client.parseShopName("not a shop!"), undefined);
});

test("apiListing maps price, images (rank order, fullxfull), clean URL, entities", () => {
  const l = client.apiListing(LISTINGS[1]);
  assert.equal(l.price, 38.5);
  assert.equal(l.currency, "USD");
  assert.equal(l.title, "Pearl & Bead Necklace • Dainty Layering Necklace");
  assert.equal(l.url, "https://www.etsy.com/listing/1002/pearl-amp-bead-necklace-dainty-layering-necklace");
  assert.deepEqual(l.imageUrls.map((u) => u.match(/10021|10022|10023/)?.[0]), ["10021", "10022", "10023"]);
  assert.ok(l.imageUrls.every((u) => u.includes("il_fullxfull")));
  assert.equal(l.favorers, 12);
});

test("parseShopRss reads listing id, title (shop suffix stripped), price, full-size image", () => {
  const r = client.parseShopRss(RSS, "BeadsByTest");
  assert.equal(r.listings.length, 1);
  const l = r.listings[0];
  assert.equal(l.listingId, "1001");
  assert.equal(l.title, "Beaded Daisy Bracelet | Seed Bead Flower Bracelet");
  assert.equal(l.price, 24);
  assert.equal(l.currency, "USD");
  assert.equal(l.url, "https://www.etsy.com/listing/1001/beaded-daisy-bracelet");
  assert.match(l.imageUrls[0], /il_fullxfull\.10012_x\.jpg$/);
  assert.match(l.description, /Glass seed beads' finish/);
});

test("API client sends keystring:shared_secret and explains a rejected key", async () => {
  calls = [];
  const api = new client.EtsyApi({ apiKey: "abc123:def456", minIntervalMs: 0 });
  const shop = await api.findShop("beadsbytest");
  assert.equal(shop.shopId, SHOP_ID, "exact case-insensitive match wins over the first result");
  assert.equal(shop.url, "https://www.etsy.com/shop/BeadsByTest");
  assert.equal(calls[0].headers["x-api-key"], "abc123:def456");
  assert.match(calls[0].url, /^https:\/\/openapi\.etsy\.com\/v3\/application\/shops\?shop_name=beadsbytest/);
  rejectKey = true;
  try {
    await assert.rejects(new client.EtsyApi({ apiKey: "abc123", minIntervalMs: 0 }).findShop("x"), /keystring:shared_secret/);
  } finally {
    rejectKey = false;
  }
});

// ---------- import (API) ----------
test("API import: listings + photos + reviews, re-import updates in place, brain merged", async () => {
  db.setSetting("etsyApiKey", "abc123:def456");
  const b = mkBrand({ etsyShop: "BeadsByTest" });
  calls = [];
  const r1 = await etsy.importShop(b.id, { imagesPerListing: 2 });
  assert.equal(r1.summary.source, "api");
  assert.equal(r1.summary.imported, 3);
  assert.equal(r1.summary.images, 6);
  assert.equal(r1.summary.reviews, 3);
  const daisy = etsy.getListing(b.id, "1001")!;
  assert.equal(daisy.price, 24);
  assert.equal(daisy.imageAssetIds.length, 2);
  assert.equal(daisy.reviews.length, 1, "only good reviews of this listing");
  assert.match(daisy.reviews[0].text, /Absolutely beautiful/);
  const asset = db.getAsset(daisy.imageAssetIds[0])!;
  assert.equal(asset.etsyListingId, "1001");
  assert.ok(fs.existsSync(asset.path));
  assert.match(asset.url, /^http:\/\/localhost:4398\/files\/uploads\//);

  // re-import: same rows, no new downloads
  const before2 = db.listAssets(b.id).length;
  const r2 = await etsy.importShop(b.id, { imagesPerListing: 2 });
  assert.equal(r2.summary.imported, 0);
  assert.equal(r2.summary.updated, 3);
  assert.equal(r2.summary.images, 0);
  assert.equal(db.listAssets(b.id).length, before2);
  assert.equal(etsy.listListings(b.id).length, 3);
  assert.equal(etsy.getListing(b.id, "1001")!.id, daisy.id);

  // brand brain: products/keywords/CTAs merged, facts stored
  const brand = db.getBrand(b.id)!;
  assert.ok(brand.brain!.products.includes("Rainbow Friendship Bracelet Set of 3"), JSON.stringify(brand.brain!.products));
  assert.ok(brand.brain!.products.includes("Beaded Daisy Bracelet"));
  assert.ok(!brand.brain!.products.includes("Handmade products"), "heuristic placeholder replaced");
  assert.ok(brand.brain!.keywords.includes("beadedbracelet"));
  assert.ok(brand.brain!.ctas.some((c) => /etsy/i.test(c)));
  assert.ok(brand.brain!.differentiators.some((d) => /4\.9★ by 128 Etsy buyers/.test(d)));
  assert.equal(brand.etsy!.priceMin, 18);
  assert.equal(brand.etsy!.priceMax, 38.5);
  assert.ok(brand.etsy!.topReviews.some((t) => /daughter loves/.test(t)));
});

test("brain merge keeps user edits", async () => {
  const b = mkBrand({ etsyShop: "BeadsByTest" });
  await etsy.importShop(b.id, { imagesPerListing: 1 });
  db.updateBrand(b.id, (x) => {
    x.brain!.products = ["My custom anklets", ...x.brain!.products];
    x.brain!.keywords = ["myownkeyword", ...x.brain!.keywords];
  });
  await etsy.importShop(b.id, { imagesPerListing: 1 });
  const brain = db.getBrand(b.id)!.brain!;
  assert.equal(brain.products[0], "My custom anklets");
  assert.equal(brain.keywords[0], "myownkeyword");
  assert.equal(new Set(brain.products).size, brain.products.length, "no duplicates");
});

// ---------- keyless ----------
test("keyless import uses the RSS feed", async () => {
  db.setSetting("etsyApiKey", "");
  const b = mkBrand();
  const r = await etsy.importShop(b.id, { shop: "https://www.etsy.com/shop/BeadsByTest" });
  assert.equal(r.summary.source, "rss");
  assert.equal(r.summary.imported, 1);
  assert.ok(r.summary.warnings.some((w) => /No Etsy API key/.test(w)));
  assert.equal(db.getBrand(b.id)!.etsyShop, "BeadsByTest");
  assert.equal(etsy.getListing(b.id, "1001")!.imageAssetIds.length, 1);
});

test("manual listing (pasted URL + uploaded photos) → posts with UTM link and DM automation", async () => {
  db.setSetting("etsyApiKey", "");
  const b = mkBrand();
  const photo = path.join(DATA, "uploads", b.id, "my-photo.jpg");
  fs.mkdirSync(path.dirname(photo), { recursive: true });
  fs.writeFileSync(photo, "x");
  const asset = db.saveAsset({ id: "asset1" + b.id, brandId: b.id, kind: "image", url: "http://localhost:4398/files/uploads/x.jpg", path: photo, originalName: "my-photo.jpg", mime: "image/jpeg", size: 1, createdAt: new Date().toISOString() });
  await assert.rejects(etsy.addManualListing(b.id, { url: "https://example.com/x", title: "X" }), /Etsy listing URL/);
  const l = await etsy.addManualListing(b.id, {
    url: "https://www.etsy.com/listing/2002/ocean-anklet?ref=shop_home",
    title: "Ocean Blue Beaded Anklet | Summer Jewelry",
    price: "$19.50",
    description: "• Czech glass beads\n• Stretchy, fits most ankles",
    tags: "beaded anklet, summer jewelry, beach anklet",
    assetIds: [asset.id],
    reviews: [{ rating: 5, text: "Love it, wear it every day at the beach!" }],
  });
  assert.equal(l.source, "manual");
  assert.equal(l.price, 19.5);
  assert.equal(l.url, "https://www.etsy.com/listing/2002/ocean-anklet");

  const r = await etsy.createListingPosts(b.id, "2002", { types: ["reel", "carousel", "story"], render: false, automation: true });
  assert.equal(r.posts.length, 3);
  const [reel, carousel, story] = r.posts;
  assert.equal(reel.status, "draft");
  assert.equal(reel.etsyListingId, "2002");
  assert.equal(reel.etsyLink, `https://www.etsy.com/listing/2002/ocean-anklet?utm_source=instagram&utm_medium=social&utm_campaign=${reel.id}`);
  assert.ok(reel.hashtags.length >= 3 && reel.hashtags.length <= 5);
  assert.ok(reel.hashtags.includes("beachanklet"));
  assert.match(reel.caption.split("\n")[0], /beaded anklet/i, "keyword-first caption");
  assert.match(reel.caption, /\$19\.50/);
  assert.match(reel.caption, /Comment LINK/);
  const scenes = (reel.spec as any).scenes;
  assert.ok(scenes.length >= 4);
  assert.ok(scenes.every((s: any) => s.media?.src === asset.url), "listing photos used as scene media");
  assert.ok(scenes.some((s: any) => /Love it/.test(s.headline)), "review quote scene");
  assert.ok(scenes.every((s: any) => s.voiceoverText));
  assert.equal((reel.spec as any).cta.keyword, "LINK");
  assert.ok((carousel.spec as any).slides.some((s: any) => s.headline === "$19.50"));
  assert.equal((carousel.spec as any).slides.at(-1).headline, "Want the link?");
  assert.match(story.caption, /link in bio/);
  assert.equal(r.automations.length, 2, "reel + carousel (stories have no comments)");
  assert.equal(r.automations[0].postId, reel.id);
  assert.equal(r.automations[0].link, reel.etsyLink);
  assert.equal(r.automations[0].keyword, "LINK");
  assert.deepEqual(etsy.getListing(b.id, "2002")!.postIds, r.posts.map((p) => p.id));
  const view = etsy.listingsView(b.id)[0];
  assert.equal(view.posts!.length, 3);
});

test("plan from shop prefers most favorited listings without posts", async () => {
  db.setSetting("etsyApiKey", "abc123:def456");
  const b = mkBrand({ etsyShop: "BeadsByTest" });
  await etsy.importShop(b.id, { imagesPerListing: 1 });
  const r = await etsy.planFromShop(b.id, { count: 2, render: false });
  assert.deepEqual(r.listings, ["1003", "1001"]);
  assert.equal(r.posts.length, 2);
  assert.ok(r.posts.every((p) => p.type === "reel" && p.scheduledAt));
  assert.notEqual(r.posts[0].scheduledAt, r.posts[1].scheduledAt);
  const r2 = await etsy.planFromShop(b.id, { count: 1, render: false });
  assert.deepEqual(r2.listings, ["1002"], "fresh listing first");
  assert.equal(etsy.resolveListing(b.id, "newest").listingId, "1002");
  assert.equal(etsy.resolveListing(b.id, "top").listingId, "1003");
});

test("benefit lines skip shipping/contact noise and shouty headings", () => {
  const l = { ...etsy.getListing(db.listBrands().find((x) => x.etsyShop)!.id, "1001")!, description: "H O W ∙ T O ∙ O R D E R\nTYPE THE NAME ONCE, IT FILLS EVERY PAGE\n• Glass seed beads\nShips in 1-3 business days\nMessage me with questions" };
  const out = etsy.extractBenefits(l, 3);
  assert.equal(out[0], "Type the name once, it fills every page");
  assert.ok(out.includes("Glass seed beads"));
  assert.ok(!out.some((x) => /business days|Message me|H O W/.test(x)));
});
