// HTTP routes for image posts + autopilot + occasions. Registered from index.ts via registerAutopostRoutes(app).
import type { Express, Request } from "express";
import type { ImageDesign } from "../../shared/types.ts";
import { getAsset, getBrand, listPosts } from "./db.ts";
import { ensureBrain } from "./brain.ts";
import { newPost } from "./posts.ts";
import { enqueueRender } from "./render.ts";
import { getStyles } from "./engines.ts";
import { nextSlotForBrand } from "./schedule.ts";
import { IMAGE_DESIGNS, IMAGE_DESIGN_INFO, brandPhotos, imageSpecFromIdea, normalizeImageSpec, planImageIdeas, imageStyleFor } from "./imagepost.ts";
import { autopilotDigest, autopilotOf, autopilotStatus, planAutopilot, runAutopilot, setAutopilot } from "./autopilot.ts";
import { OCCASIONS, upcomingOccasions } from "./occasions.ts";
import { capHashtags, heuristicHashtags, keywordFirstCaption } from "./hashtags.ts";

const httpErr = (status: number, msg: string) => Object.assign(new Error(msg), { status });
const brandOr404 = (id: string) => {
  const b = getBrand(id);
  if (!b) throw httpErr(404, "Brand not found");
  return b;
};
const iso = (v: unknown) => {
  if (v === undefined || v === null || v === "") return undefined;
  const t = Date.parse(String(v));
  if (isNaN(t)) throw httpErr(400, `Invalid date: ${v}`);
  return new Date(t).toISOString();
};

/**
 * Create one image post. Either give the text yourself (headline + optional fields → used as-is) or just a
 * design / topic and let the planner write it (LLM when a key is set, otherwise templates).
 */
export async function createImagePost(brandId: string, body: any) {
  const brand = brandOr404(brandId);
  const brain = ensureBrain(brand);
  const { styles } = await getStyles();
  const design: ImageDesign | undefined = IMAGE_DESIGNS.includes(body?.design) ? body.design : undefined;
  if (body?.design && !design) throw httpErr(400, `design must be one of ${IMAGE_DESIGNS.join(", ")}`);
  const offset = listPosts({ brandId }).length;
  const scheduledAt = iso(body?.scheduledAt) ?? (body?.schedule === false ? undefined : nextSlotForBrand(brand));
  let post;
  if (typeof body?.headline === "string" && body.headline.trim()) {
    const d = design ?? "tip";
    const photo = body.media?.src ? body.media : body.mediaAssetId ? (() => { const a = getAsset(String(body.mediaAssetId)); return a && a.brandId === brandId && a.kind === "image" ? { src: a.url, kind: "image" as const } : undefined; })() : d === "product" ? brandPhotos(brandId)[offset % Math.max(1, brandPhotos(brandId).length)] : undefined;
    const spec = normalizeImageSpec({ ...body, design: d, style: body.style ?? imageStyleFor(d, brain, offset, styles), media: photo }, brand);
    const hook = String(body.hook ?? spec.headline);
    post = newPost({
      brandId,
      type: "image",
      title: body.title ? String(body.title) : `${d.replace("-", "/")}: ${spec.headline.slice(0, 50)}`,
      hook,
      caption: typeof body.caption === "string" ? body.caption : keywordFirstCaption({ hook, keyword: "", body: spec.body, cta: spec.cta }),
      hashtags: Array.isArray(body.hashtags) ? capHashtags(body.hashtags) : heuristicHashtags(brain, `${spec.headline} ${spec.body ?? ""}`),
      spec,
      scheduledAt,
    });
  } else {
    const recent = listPosts({ brandId }).slice(-60);
    const [idea] = await planImageIdeas(brand, brain, 1, offset, { design, topic: typeof body?.topic === "string" ? body.topic : undefined, existingTitles: recent.map((p) => p.title) });
    if (!idea) throw httpErr(500, "Could not write an image post");
    const own = brandPhotos(brandId);
    const spec = imageSpecFromIdea(idea, brand, brain, offset, styles, idea.usePhoto || idea.image.design === "product" ? own[offset % Math.max(1, own.length)] : undefined);
    if (typeof body?.style === "string" && styles.some((s) => s.id === body.style)) spec.style = body.style;
    post = newPost({ brandId, type: "image", title: idea.title, hook: idea.hook, caption: idea.caption, hashtags: idea.hashtags, spec, scheduledAt });
  }
  return body?.render === false ? post : enqueueRender(post.id) ?? post;
}

export function registerAutopostRoutes(app: Express) {
  const id = (req: Request) => String(req.params.id);

  // ----- image posts -----
  app.get("/api/image-designs", (_req, res) =>
    res.json(IMAGE_DESIGNS.map((d) => ({ id: d, description: IMAGE_DESIGN_INFO[d] }))),
  );
  app.post("/api/brands/:id/image-posts", async (req, res) => res.status(201).json(await createImagePost(id(req), req.body ?? {})));

  // ----- autopilot -----
  app.get("/api/brands/:id/autopilot", (req, res) => {
    const b = brandOr404(id(req));
    const preview = planAutopilot(b, new Date());
    res.json({ settings: autopilotOf(b), status: autopilotStatus(b), preview: preview.items });
  });
  app.patch("/api/brands/:id/autopilot", (req, res) => {
    const b = setAutopilot(id(req), req.body);
    res.json({ settings: autopilotOf(b), status: autopilotStatus(b) });
  });
  app.post("/api/brands/:id/autopilot/run", async (req, res) => {
    const body = req.body ?? {};
    const now = body.now ? new Date(iso(body.now)!) : undefined; // testing aid: plan as if it were this time
    const r = await runAutopilot(id(req), { now, dryRun: !!body.dryRun, render: typeof body.render === "boolean" ? body.render : undefined, leadDays: body.leadDays, force: !!body.force });
    res.json(r);
  });
  app.get("/api/autopilot/digest", (req, res) => res.json(autopilotDigest(typeof req.query.brandId === "string" ? req.query.brandId : undefined)));

  // ----- occasions -----
  app.get("/api/occasions", (req, res) => {
    const days = Math.max(1, Math.min(400, Number(req.query.days) || 60));
    const now = new Date();
    const to = new Date(now.getTime() + days * 86400000);
    if (typeof req.query.brandId === "string" && req.query.brandId) {
      const b = brandOr404(req.query.brandId);
      return res.json(upcomingOccasions(ensureBrain(b), now, to, b.website));
    }
    const a = now.toISOString().slice(0, 10);
    const z = to.toISOString().slice(0, 10);
    res.json(OCCASIONS.filter((o) => o.date >= a && o.date <= z));
  });
}
