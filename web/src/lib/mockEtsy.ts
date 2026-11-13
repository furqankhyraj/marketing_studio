// Mock (?mock=1) handlers for the Etsy shop endpoints. Called from mock.ts for any /api/brands/:id/etsy… path.
import type { Brand, EtsyListing, EtsyStatus, Post, PostType } from "./types";
import { ApiError } from "./api";

type Ctx = { brands: Brand[]; posts: Post[]; mkPost: (b: Brand, p: Partial<Post>) => Post };

const listings = new Map<string, EtsyListing[]>();
const status = new Map<string, EtsyStatus>();
const iso = () => new Date().toISOString();
const DEMO = [
  ["Beaded Daisy Bracelet | Seed Bead Flower Bracelet", 24, 52, "daisy"],
  ["Pearl & Bead Layering Necklace", 38.5, 12, "pearl"],
  ["Rainbow Friendship Bracelet Set of 3", 18, 99, "rainbow"],
  ["Evil Eye Beaded Anklet", 16, 31, "anklet"],
  ["Turquoise Stretch Bracelet Stack", 29, 44, "turquoise"],
  ["Custom Name Bead Bracelet", 21, 87, "name"],
] as const;

function demoListings(brandId: string): EtsyListing[] {
  return DEMO.map(([title, price, fav, seed], i) => ({
    id: `el${i}`, brandId, listingId: String(1000000001 + i), title, description: "Handmade with glass seed beads.\n• Adjustable\n• Gift-wrapped",
    price, currency: "USD", url: `https://www.etsy.com/listing/${1000000001 + i}/demo`, tags: ["beaded bracelet", "boho jewelry"], materials: ["glass seed beads"],
    imageUrls: [], imageAssetIds: [`a${i}`], imageAssetUrls: [1, 2, 3].map((n) => `https://picsum.photos/seed/${seed}${n}/600/600`),
    favorers: fav, views: fav * 9, listedAt: new Date(Date.now() - i * 86400_000 * 3).toISOString(),
    reviews: i % 2 ? [] : [{ rating: 5, text: "So pretty, even better in person!" }], source: "api", postIds: [], importedAt: iso(), updatedAt: iso(), posts: [],
  }));
}

function getStatus(b: Brand): EtsyStatus {
  const s = status.get(b.id) ?? { shop: b.etsyShop, keySet: false, mode: b.etsyShop ? "rss" : "manual", listingCount: 0 };
  s.shop = b.etsyShop ?? s.shop;
  s.listingCount = listings.get(b.id)?.length ?? 0;
  status.set(b.id, s);
  return s;
}

export async function mockEtsy(method: string, path: string, body: any, ctx: Ctx): Promise<unknown> {
  const m = path.match(/^\/api\/brands\/([^/]+)\/etsy(?:\/(.*))?$/);
  const brand = ctx.brands.find((b) => b.id === m?.[1]);
  if (!m || !brand) throw new ApiError(`Not found (mock): ${method} ${path}`, 404);
  const rest = m[2] ?? "";
  const list = listings.get(brand.id) ?? [];
  const view = () => list.map((l) => ({ ...l, posts: l.postIds.map((id) => ctx.posts.find((p) => p.id === id)).filter((p): p is Post => !!p).map((p) => ({ id: p.id, type: p.type, status: p.status, title: p.title, thumbnailUrl: p.thumbnailUrl })) }));
  const makePosts = (l: EtsyListing, types: PostType[]) =>
    types.map((type) => {
      const p = ctx.mkPost(brand, { title: `${l.title.split("|")[0].trim()} — ${type}`, type, status: body?.render === false ? "draft" : "rendering", renderProgress: 0, etsyListingId: l.listingId, etsyLink: `${l.url}?utm_source=instagram&utm_medium=social&utm_campaign=mock` });
      ctx.posts.push(p);
      l.postIds.push(p.id);
      return p;
    });

  if (method === "GET" && rest === "") return structuredClone(getStatus(brand)); // fresh object so React re-renders
  if (method === "POST" && rest === "import") {
    if (body?.shop) brand.etsyShop = String(body.shop).replace(/^.*\/shop\//, "").replace(/[?#/].*$/, "");
    if (!brand.etsyShop) throw new ApiError("Set your Etsy shop first", 400);
    const s = getStatus(brand);
    s.job = { running: true, step: "Reading active listings", progress: 0.1, startedAt: iso() };
    let p = 0.1;
    const t = setInterval(() => {
      p += 0.2;
      s.job = { ...s.job!, progress: Math.min(1, p), step: p < 0.5 ? "Downloading photos" : p < 0.9 ? "Reading reviews" : "Updating your Brand Brain" };
      if (p >= 1) {
        clearInterval(t);
        if (!listings.get(brand.id)?.length) listings.set(brand.id, demoListings(brand.id));
        const summary = { at: iso(), source: "rss" as const, imported: 6, updated: 0, images: 18, reviews: 3, warnings: ["Mock data: no real Etsy call was made."] };
        s.job = { ...s.job!, running: false, step: "Done", progress: 1, summary };
        s.lastImport = summary;
        s.facts = { shop: { name: brand.etsyShop!, url: `https://www.etsy.com/shop/${brand.etsyShop}`, reviewAverage: 4.9, reviewCount: 128 }, priceMin: 16, priceMax: 38.5, currency: "USD", topReviews: ["So pretty, even better in person!"], tagKeywords: ["beadedbracelet", "bohojewelry", "seedbeads"], listingCount: 6, updatedAt: iso() };
      }
    }, 700);
    return structuredClone(s);
  }
  if (method === "POST" && rest === "brain") return brand;
  if (method === "GET" && rest === "listings") return view();
  if (method === "POST" && rest === "listings") {
    const id = String(body?.url ?? "").match(/listing\/(\d+)/)?.[1];
    if (!id) throw new ApiError("url must be an Etsy listing URL", 400);
    const l: EtsyListing = { id: `el${Date.now()}`, brandId: brand.id, listingId: id, title: body.title, description: body.description ?? "", price: Number(body.price) || undefined, currency: body.currency || "USD", url: body.url, tags: String(body.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean), materials: [], imageUrls: [], imageAssetIds: body.assetIds ?? [], imageAssetUrls: [`https://picsum.photos/seed/${id}/600/600`], reviews: [], source: "manual", postIds: [], importedAt: iso(), updatedAt: iso() };
    listings.set(brand.id, [l, ...list.filter((x) => x.listingId !== id)]);
    return l;
  }
  const del = rest.match(/^listings\/(\d+)$/);
  if (method === "DELETE" && del) {
    listings.set(brand.id, list.filter((x) => x.listingId !== del[1]));
    return { ok: true };
  }
  const mk = rest.match(/^listings\/([^/]+)\/posts$/);
  if (method === "POST" && mk) {
    const l = mk[1] === "newest" ? list[0] : list.find((x) => x.listingId === mk[1]);
    if (!l) throw new ApiError("Etsy listing not found", 404);
    const posts = makePosts(l, body?.types?.length ? body.types : ["reel"]);
    return { posts, automations: body?.automation ? posts.filter((p) => p.type !== "story").map((p) => ({ id: `au${p.id}`, brandId: brand.id, keyword: "LINK", replyText: "Sent!", dmText: "Here's the link:", link: p.etsyLink, enabled: true, postId: p.id, createdAt: iso() })) : [], listing: l };
  }
  if (method === "POST" && rest === "plan") {
    const chosen = [...list].sort((a, b) => (b.favorers ?? 0) - (a.favorers ?? 0)).slice(0, body?.count ?? 3);
    const posts = chosen.flatMap((l) => makePosts(l, body?.types?.length ? body.types : ["reel"]));
    return { posts, automations: [], listings: chosen.map((l) => l.listingId) };
  }
  throw new ApiError(`Not found (mock): ${method} ${path}`, 404);
}
