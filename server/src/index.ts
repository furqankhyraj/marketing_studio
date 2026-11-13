// Social MCP Studio API server (port 4300).
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { nanoid } from "nanoid";
import type { Asset, Automation, Brand, PostType } from "../../shared/types.ts";
import { VERSION, PORT, UPLOADS_DIR, RENDERS_DIR, DATA_DIR, ROOT_DIR, WEB_URL, fileUrlFor, nowIso } from "./config.ts";
import * as db from "./db.ts";
import { startAnalysis, brandStyleRef, normalizeBrain, heuristicBrain } from "./brain.ts";
import { runAudit } from "./audit.ts";
import { planPosts } from "./planner.ts";
import { newPost, normalizeSpec } from "./posts.ts";
import { enqueueRender, resumeRenderQueue, queueState, configureVoice } from "./render.ts";
import { requestChange } from "./change.ts";
import { nextSlotForBrand } from "./schedule.ts";
import { getStyles, loadHyperframes, loadVoice } from "./engines.ts";
import * as ig from "./instagram.ts";
import { startWorkers } from "./workers.ts";
import { registerGrowthRoutes } from "./growth.ts";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
(await import("./music.ts")).registerMusicRoutes(app); // music library, /api/music, POST /api/posts/:id/music, music settings
(await import("./etsy.ts")).registerEtsyRoutes(app); // Etsy shop → listings → posts (+ etsyApiKey setting, brand etsyShop); see CONTRACTS.md "Etsy shop"

// Static files: only uploads/ and renders/ (never the DB)
const staticOpts = { fallthrough: false, maxAge: "1h" };
app.use("/files/uploads", express.static(UPLOADS_DIR, staticOpts));
app.use("/files/renders", express.static(RENDERS_DIR, staticOpts));

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const bad = (msg: string) => new HttpError(400, msg);
const notFound = (what: string) => new HttpError(404, `${what} not found`);

function brandOr404(id: string): Brand {
  const b = db.getBrand(id);
  if (!b) throw notFound("Brand");
  return b;
}
const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
const optStr = (v: unknown) => (typeof v === "string" ? v.trim() || undefined : undefined);
const p = (req: Request, k: string) => String(req.params[k]);

// ---------- health / settings / styles ----------
app.get("/api/health", (_req, res) => res.json({ ok: true, version: VERSION, render: queueState() }));

app.get("/api/settings", (_req, res) => res.json(db.getSettings()));
app.patch("/api/settings", (req, res) => {
  const b = req.body ?? {};
  // validate first so a bad request changes nothing
  if (typeof b.timezone === "string" && b.timezone.trim()) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: b.timezone.trim() });
    } catch {
      throw bad(`Unknown timezone: ${b.timezone}`);
    }
  }
  // write-only secrets: empty string clears, undefined leaves untouched
  if (typeof b.claudeOauthToken === "string") b.claudeOauthToken = b.claudeOauthToken.replace(/\s+/g, ""); // terminals wrap the long token across lines
  if (typeof b.claudeOauthToken === "string" && b.claudeOauthToken && !/^sk-ant-oat\d*-[A-Za-z0-9_-]{20,}$/.test(b.claudeOauthToken)) throw bad("That doesn't look like a Claude Code token (it starts with sk-ant-oat01-). Run `claude setup-token` to get one.");
  if (b.llmProvider !== undefined && !["auto", "api", "subscription"].includes(b.llmProvider)) throw bad("llmProvider must be auto, api or subscription");
  for (const k of ["anthropicApiKey", "igAppSecret", "pexelsApiKey", "pixabayApiKey", "claudeOauthToken", "apifyToken"]) if (typeof b[k] === "string") db.setSetting(k, b[k].trim());
  if (typeof b.llmProvider === "string") db.setSetting("llmProvider", b.llmProvider === "auto" ? "" : b.llmProvider);
  for (const k of ["anthropicModel", "igAppId", "timezone", "voice"]) if (typeof b[k] === "string") db.setSetting(k, b[k].trim());
  if (typeof b.publicBaseUrl === "string") db.setSetting("publicBaseUrl", b.publicBaseUrl.trim().replace(/\/$/, ""));
  if (typeof b.autoPublish === "boolean") db.setSetting("autoPublish", String(b.autoPublish));
  if (typeof b.autoVoiceover === "boolean") db.setSetting("autoVoiceover", String(b.autoVoiceover));
  res.json(db.getSettings());
});

app.post("/api/settings/test-llm", async (_req, res) => {
  const { llmMode, askJson } = await import("./llm.ts");
  const mode = llmMode();
  if (!mode) return res.json({ ok: false, mode: null, message: "No Claude subscription token or API key is set." });
  const t0 = Date.now();
  try {
    const r = await askJson<{ hook?: string }>("You write short social media hooks.", 'Return JSON {"hook": string}: a 6-word hook for a tasbih counter app.', 200);
    res.json({ ok: true, mode, ms: Date.now() - t0, sample: r?.hook ?? r });
  } catch (e: any) {
    res.json({ ok: false, mode, message: String(e?.message ?? e) });
  }
});

app.get("/api/styles", async (_req, res) => res.json(await getStyles()));

app.get("/api/voices", async (_req, res) => {
  try {
    const v = await loadVoice();
    res.json(v.listVoices());
  } catch {
    res.json([]);
  }
});

app.get("/api/stock", async (req, res) => {
  const query = str(req.query.query);
  const kind = req.query.kind === "image" ? "image" : "video";
  if (!query) throw bad("query is required");
  const s = db.getSettings();
  if (!s.pexelsApiKeySet && !s.pixabayApiKeySet) throw bad("Set a Pexels or Pixabay API key in Settings first");
  let v;
  try {
    v = await loadVoice();
  } catch (e: any) {
    throw new HttpError(503, e.message);
  }
  await configureVoice(v);
  res.json(await v.searchStock(query, { kind, orientation: "portrait", perPage: 20 }));
});

// ---------- brands ----------
app.get("/api/brands", (_req, res) => res.json(db.listBrands()));
app.post("/api/brands", (req, res) => {
  const b = req.body ?? {};
  const name = str(b.name);
  if (!name) throw bad("name is required");
  const now = nowIso();
  const brand: Brand = {
    id: nanoid(10),
    name,
    website: optStr(b.website),
    instagramHandle: optStr(b.instagramHandle)?.replace(/^@/, ""),
    driveLink: optStr(b.driveLink),
    description: optStr(b.description),
    analysisStatus: "idle",
    igConnected: false,
    createdAt: now,
    updatedAt: now,
  };
  db.saveBrand(brand);
  fs.mkdirSync(path.join(UPLOADS_DIR, brand.id), { recursive: true });
  const out = brand.website || brand.description ? startAnalysis(brand.id) : brand;
  res.status(201).json(out);
});
app.get("/api/brands/:id", (req, res) => res.json(brandOr404(p(req, "id"))));
app.patch("/api/brands/:id", (req, res) => {
  const cur = brandOr404(p(req, "id"));
  const b = req.body ?? {};
  const out = db.updateBrand(cur.id, (x) => {
    if (b.name !== undefined) {
      const n = str(b.name);
      if (!n) throw bad("name cannot be empty");
      x.name = n;
    }
    for (const k of ["website", "driveLink", "description"] as const) if (b[k] !== undefined) x[k] = optStr(b[k]);
    if (b.instagramHandle !== undefined) x.instagramHandle = optStr(b.instagramHandle)?.replace(/^@/, "");
    if (b.brain !== undefined) {
      if (b.brain === null) x.brain = undefined;
      else {
        const base = x.brain ?? heuristicBrain(x);
        x.brain = normalizeBrain({ ...base, ...b.brain, colors: { ...base.colors, ...(b.brain.colors ?? {}) } }, base);
        if (x.analysisStatus === "idle") x.analysisStatus = "done";
      }
    }
  });
  res.json(out);
});
app.delete("/api/brands/:id", (req, res) => {
  const b = brandOr404(p(req, "id"));
  db.deleteBrand(b.id);
  res.json({ ok: true });
});
app.post("/api/brands/:id/analyze", (req, res) => {
  const b = brandOr404(p(req, "id"));
  res.json(startAnalysis(b.id));
});

// ---------- assets ----------
const IMAGE_MAX = 25 * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => {
      const dir = path.join(UPLOADS_DIR, String(req.params.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, f, cb) => cb(null, `${nanoid(10)}${path.extname(f.originalname).toLowerCase().slice(0, 8)}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024, files: 10 },
  fileFilter: (_req, f, cb) => {
    if (kindOf(f.mimetype, f.originalname)) cb(null, true);
    else cb(new HttpError(400, `Unsupported file type: ${f.originalname} (${f.mimetype})`));
  },
});

const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
};
function kindOf(mime: string, name: string): Asset["kind"] | undefined {
  const ext = path.extname(name).toLowerCase();
  if (/^image\/(jpeg|png|webp|gif)$/.test(mime) || [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) return "image";
  if (/^video\/(mp4|quicktime|webm)$/.test(mime) || [".mp4", ".mov", ".webm"].includes(ext)) return "video";
  if (/^audio\/(mpeg|mp3|wav|x-wav|wave|mp4|x-m4a|m4a|aac)$/.test(mime) || [".mp3", ".wav", ".m4a"].includes(ext)) return "audio";
  return undefined;
}
function assetFromFile(brandId: string, absPath: string, originalName: string, mime?: string): Asset {
  const ext = path.extname(originalName).toLowerCase();
  const m = mime && mime !== "application/octet-stream" ? mime : EXT_MIME[ext] ?? "application/octet-stream";
  const kind = kindOf(m, originalName);
  if (!kind) throw bad(`Unsupported file type: ${originalName}`);
  const size = fs.statSync(absPath).size;
  if (kind === "image" && size > IMAGE_MAX) {
    fs.rmSync(absPath, { force: true });
    throw bad(`Image too large (max 25MB): ${originalName}`);
  }
  return db.saveAsset({ id: nanoid(12), brandId, kind, url: fileUrlFor(absPath), path: absPath, originalName, mime: m, size, createdAt: nowIso() });
}

app.get("/api/brands/:id/assets", (req, res) => res.json(db.listAssets(brandOr404(p(req, "id")).id)));
app.post(
  "/api/brands/:id/assets",
  (req, _res, next) => {
    brandOr404(p(req, "id"));
    next();
  },
  upload.array("files", 10),
  (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!files.length) throw bad("No files uploaded (multipart field 'files')");
    const out: Asset[] = [];
    const errors: string[] = [];
    for (const f of files) {
      try {
        out.push(assetFromFile(p(req, "id"), f.path, f.originalname, f.mimetype));
      } catch (e: any) {
        errors.push(e.message);
      }
    }
    if (!out.length) throw bad(errors.join("; "));
    res.status(201).json(out);
  },
);
app.post("/api/brands/:id/assets/from-path", (req, res) => {
  const b = brandOr404(p(req, "id"));
  const src = str(req.body?.path);
  if (!src) throw bad("path is required");
  const abs = path.resolve(src);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw bad(`File not found: ${src}`);
  if (!kindOf("", abs)) throw bad(`Unsupported file type: ${path.basename(abs)}`);
  if (fs.statSync(abs).size > 500 * 1024 * 1024) throw bad("File too large (max 500MB)");
  const dir = path.join(UPLOADS_DIR, b.id);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${nanoid(10)}${path.extname(abs).toLowerCase()}`);
  fs.copyFileSync(abs, dest);
  res.status(201).json(assetFromFile(b.id, dest, path.basename(abs)));
});
app.post("/api/brands/:id/assets/from-stock", async (req, res) => {
  const b = brandOr404(p(req, "id"));
  const url = str(req.body?.url);
  const kind = req.body?.kind === "image" ? "image" : "video";
  if (!url || !/^https?:\/\//.test(url)) throw bad("url (http/https) is required");
  let v;
  try {
    v = await loadVoice();
  } catch (e: any) {
    throw new HttpError(503, e.message);
  }
  await configureVoice(v);
  const dir = path.join(UPLOADS_DIR, b.id);
  fs.mkdirSync(dir, { recursive: true });
  const urlExt = path.extname(new URL(url).pathname).toLowerCase();
  const ext = EXT_MIME[urlExt] ? urlExt : kind === "image" ? ".jpg" : ".mp4";
  const dest = path.join(dir, `stock-${nanoid(8)}${ext}`);
  const saved = await v.downloadStock(url, dest);
  const finalPath = saved && fs.existsSync(saved) ? saved : dest;
  res.status(201).json(assetFromFile(b.id, finalPath, path.basename(finalPath)));
});
app.delete("/api/assets/:id", (req, res) => {
  const a = db.getAsset(p(req, "id"));
  if (!a) throw notFound("Asset");
  db.deleteAssetRow(a.id);
  if (a.path.startsWith(UPLOADS_DIR)) fs.rmSync(a.path, { force: true });
  res.json({ ok: true });
});

// ---------- audit / plan ----------
app.post("/api/brands/:id/audit", async (req, res) => res.json(await runAudit(brandOr404(p(req, "id")))));
app.get("/api/brands/:id/audits", (req, res) => res.json(db.listAudits(brandOr404(p(req, "id")).id)));
app.post("/api/brands/:id/plan", async (req, res) => {
  const b = brandOr404(p(req, "id"));
  const body = req.body ?? {};
  res.json(await planPosts(b, { reels: body.reels, carousels: body.carousels, stories: body.stories, images: body.images, startDate: body.startDate, render: body.render }));
});
app.post("/api/brands/:id/html-reel-from-template", async (req, res) => {
  const b = brandOr404(p(req, "id"));
  const body = req.body ?? {};
  const templateId = str(body.templateId);
  if (!templateId) throw bad("templateId is required");
  if (!Array.isArray(body.scenes) || !body.scenes.length) throw bad("scenes[] is required");
  let h;
  try {
    h = await loadHyperframes();
  } catch (e: any) {
    throw new HttpError(503, e.message);
  }
  const scenes = body.scenes.map((s: any, i: number) => ({
    ...s,
    id: String(s.id ?? `s${i + 1}`),
    durationSec: Number(s.durationSec) || 3,
    headline: String(s.headline ?? ""),
  }));
  let spec;
  try {
    spec = h.buildFromTemplate(templateId, { brand: brandStyleRef(b), scenes, cta: body.cta, durationSec: body.durationSec });
  } catch (e: any) {
    throw bad(`Template error: ${e?.message ?? e}`);
  }
  const type: PostType = body.type === "story" ? "story" : "reel";
  const post = newPost({
    brandId: b.id,
    type,
    title: optStr(body.title),
    hook: optStr(body.hook) ?? scenes[0]?.headline,
    caption: str(body.caption) ?? "",
    hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
    spec,
    scheduledAt: validIso(body.scheduledAt),
  });
  res.status(201).json(body.render === false ? post : enqueueRender(post.id));
});

// ---------- posts ----------
function validIso(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const t = Date.parse(String(v));
  if (isNaN(t)) throw bad(`Invalid date: ${v}`);
  return new Date(t).toISOString();
}
function postOr404(id: string) {
  const x = db.getPost(id);
  if (!x) throw notFound("Post");
  return x;
}

app.get("/api/posts", (req, res) =>
  res.json(db.listPosts({ brandId: optStr(req.query.brandId), status: optStr(req.query.status), type: optStr(req.query.type) })),
);
app.post("/api/posts", (req, res) => {
  const body = req.body ?? {};
  const b = brandOr404(String(body.brandId ?? ""));
  const type = body.type as PostType;
  if (!["reel", "carousel", "story", "image"].includes(type)) throw bad("type must be reel | carousel | story | image");
  let spec;
  try {
    spec = normalizeSpec(type, body.spec, b);
  } catch (e: any) {
    throw bad(e.message);
  }
  const post = newPost({
    brandId: b.id,
    type,
    title: optStr(body.title),
    hook: optStr(body.hook),
    caption: str(body.caption) ?? "",
    hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
    spec,
    scheduledAt: validIso(body.scheduledAt),
  });
  res.status(201).json(body.render === false ? post : enqueueRender(post.id));
});
app.get("/api/posts/:id", (req, res) => res.json(postOr404(p(req, "id"))));
app.patch("/api/posts/:id", (req, res) => {
  const cur = postOr404(p(req, "id"));
  const body = req.body ?? {};
  let spec: any;
  if (body.spec !== undefined) {
    try {
      spec = normalizeSpec(cur.type, body.spec, brandOr404(cur.brandId));
    } catch (e: any) {
      throw bad(e.message);
    }
  }
  const sched = body.scheduledAt === null ? null : validIso(body.scheduledAt);
  res.json(
    db.updatePost(cur.id, (x) => {
      if (typeof body.title === "string") x.title = body.title;
      if (typeof body.hook === "string") x.hook = body.hook;
      if (typeof body.caption === "string") x.caption = body.caption;
      if (Array.isArray(body.hashtags)) x.hashtags = body.hashtags.map((h: any) => String(h).replace(/^#/, "").replace(/\s+/g, ""));
      if (spec) x.spec = spec;
      if (sched === null) x.scheduledAt = undefined;
      else if (sched) x.scheduledAt = sched;
    }),
  );
});
app.delete("/api/posts/:id", (req, res) => {
  const x = postOr404(p(req, "id"));
  db.deletePostRow(x.id);
  fs.rmSync(path.join(RENDERS_DIR, x.id), { recursive: true, force: true });
  res.json({ ok: true });
});
app.post("/api/posts/:id/render", (req, res) => {
  const x = postOr404(p(req, "id"));
  if (x.status === "publishing") throw new HttpError(409, "Post is being published");
  res.json(enqueueRender(x.id));
});
app.post("/api/posts/:id/approve", (req, res) => {
  const x = postOr404(p(req, "id"));
  if (["posted", "publishing"].includes(x.status)) throw new HttpError(409, `Post is already ${x.status}`);
  const b = brandOr404(x.brandId);
  const sched = validIso(req.body?.scheduledAt) ?? (x.scheduledAt && Date.parse(x.scheduledAt) > Date.now() ? x.scheduledAt : nextSlotForBrand(b));
  res.json(
    db.updatePost(x.id, (y) => {
      // While a (re-)render is running, remember the approval and apply it when the render finishes.
      if (y.status === "rendering" || y.status === "changes_requested") y.approvedPending = true;
      else y.status = "approved";
      y.scheduledAt = sched;
      y.error = undefined;
    }),
  );
});
app.post("/api/posts/:id/change", async (req, res) => {
  const x = postOr404(p(req, "id"));
  const text = str(req.body?.text);
  if (!text) throw bad("text is required");
  if (["posted", "publishing"].includes(x.status)) throw new HttpError(409, `Post is already ${x.status}`);
  res.json(await requestChange(x.id, text));
});
app.post("/api/posts/:id/publish", async (req, res) => {
  const x = postOr404(p(req, "id"));
  if (x.status === "publishing") throw new HttpError(409, "Already publishing");
  if (x.status === "posted") throw new HttpError(409, "Already posted");
  try {
    res.json(await ig.publishPost(x.id));
  } catch (e: any) {
    throw new HttpError(400, e.message);
  }
});
app.get("/api/calendar", (req, res) => {
  const from = req.query.from ? Date.parse(String(req.query.from)) : -Infinity;
  const to = req.query.to ? Date.parse(String(req.query.to)) : Infinity;
  res.json(
    db
      .listPosts({ brandId: optStr(req.query.brandId) })
      .filter((x) => x.scheduledAt && Date.parse(x.scheduledAt) >= from && Date.parse(x.scheduledAt) <= to)
      .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!)),
  );
});

// ---------- automations / comments ----------
app.get("/api/brands/:id/automations", (req, res) => res.json(db.listAutomations(brandOr404(p(req, "id")).id)));
app.post("/api/brands/:id/automations", (req, res) => {
  const b = brandOr404(p(req, "id"));
  const body = req.body ?? {};
  const keyword = str(body.keyword);
  if (!keyword) throw bad("keyword is required");
  const a: Automation = {
    id: nanoid(12),
    brandId: b.id,
    keyword,
    replyText: str(body.replyText) ?? "",
    dmText: str(body.dmText) ?? "",
    link: optStr(body.link),
    enabled: body.enabled !== false,
    postId: optStr(body.postId),
    createdAt: nowIso(),
  };
  if (!a.replyText && !a.dmText) throw bad("replyText or dmText is required");
  res.status(201).json(db.saveAutomation(a));
});
app.patch("/api/automations/:id", (req, res) => {
  const a = db.getAutomation(p(req, "id"));
  if (!a) throw notFound("Automation");
  const body = req.body ?? {};
  if (typeof body.keyword === "string" && body.keyword.trim()) a.keyword = body.keyword.trim();
  for (const k of ["replyText", "dmText"] as const) if (typeof body[k] === "string") a[k] = body[k];
  if (body.link !== undefined) a.link = optStr(body.link);
  if (body.postId !== undefined) a.postId = optStr(body.postId);
  if (typeof body.enabled === "boolean") a.enabled = body.enabled;
  res.json(db.saveAutomation(a));
});
app.delete("/api/automations/:id", (req, res) => {
  db.deleteAutomationRow(p(req, "id"));
  res.json({ ok: true });
});
app.get("/api/brands/:id/comments", (req, res) => res.json(db.listComments(brandOr404(p(req, "id")).id)));

// ---------- instagram ----------
app.post("/api/brands/:id/instagram/token", async (req, res) => {
  const b = brandOr404(p(req, "id"));
  const token = str(req.body?.accessToken);
  if (!token) throw bad("accessToken is required");
  try {
    res.json(await ig.connectWithToken(b.id, token, optStr(req.body?.igUserId)));
  } catch (e: any) {
    throw bad(e.message);
  }
});
app.get("/api/instagram/auth-url", (req, res) => {
  const b = brandOr404(String(req.query.brandId ?? ""));
  try {
    res.json({ url: ig.authUrl(b.id) });
  } catch (e: any) {
    throw bad(e.message);
  }
});
app.get("/api/instagram/callback", async (req, res) => {
  const brandId = String(req.query.state ?? "");
  const code = str(req.query.code);
  const errDesc = str(req.query.error_description) ?? str(req.query.error);
  const back = (q: string) => res.redirect(`${WEB_URL}/brands/${encodeURIComponent(brandId)}?${q}`);
  if (!db.getBrand(brandId)) return res.status(400).send("Unknown brand (state)");
  if (!code) return back(`ig=error&message=${encodeURIComponent(errDesc ?? "No code returned")}`);
  try {
    await ig.exchangeCode(brandId, code);
    back("ig=connected");
  } catch (e: any) {
    back(`ig=error&message=${encodeURIComponent(e.message)}`);
  }
});
app.delete("/api/brands/:id/instagram", (req, res) => res.json(ig.disconnect(brandOr404(p(req, "id")).id)));
app.get("/api/brands/:id/instagram/insights", async (req, res) => {
  const b = brandOr404(p(req, "id"));
  try {
    res.json(await ig.getInsights(b.id));
  } catch (e: any) {
    throw bad(e.message);
  }
});

registerGrowthRoutes(app); // growth: hooks, alt text, covers, trial/collab/audio options
(await import("./autopost-routes.ts")).registerAutopostRoutes(app); // image posts, autopilot, occasions

// ---------- mcp config ----------
app.get("/api/mcp/config", (_req, res) => {
  const entry = path.join(ROOT_DIR, "mcp", "src", "index.ts").replace(/\\/g, "/");
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || process.env.HOME || "", "AppData", "Roaming");
  res.json({
    claudeDesktopConfigSnippet: {
      mcpServers: {
        "social-mcp-studio": { command: "npx", args: ["tsx", entry], env: { SOCIAL_MCP_API: `http://localhost:${PORT}` } },
      },
    },
    configPath: path.join(appData, "Claude", "claude_desktop_config.json"),
  });
});

(await import("./chat.ts")).registerChatRoutes(app); // chat: post chat + global assistant (see CONTRACTS.md "Chat")
(await import("./research/index.ts")).registerResearchRoutes(app); // competitor + ad-library research → strategy; see CONTRACTS.md "Research"
(await import("./playstore.ts")).registerPlayStoreRoutes(app); // Google Play listing → brand facts + screenshots; see CONTRACTS.md "Play Store"
(await import("./pinterest.ts")).registerPinterestRoutes(app); // Pinterest pin queue + publisher-agent claim API; see CONTRACTS.md "Pinterest"
(await import("./clips.ts")).registerClipRoutes(app); // long video → short clips (jobs, transcript, clip posts); see CONTRACTS.md "Clips"

// ---------- errors ----------
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload error: ${err.message}` });
  const status = err instanceof HttpError ? err.status : err?.status && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error("[api]", err?.stack ?? err);
  res.status(status).json({ error: err?.expose === false ? "Internal error" : String(err?.message ?? err) });
});

// ---------- boot ----------
function listen(host: string) {
  const srv = http.createServer(app);
  srv.on("error", (e: any) => {
    if (host === "::1" && (e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT")) return; // no IPv6 loopback
    console.error(`[server] cannot listen on ${host}:${PORT}: ${e.message}`);
    if (host === "127.0.0.1") process.exit(1);
  });
  srv.listen(PORT, host);
  return srv;
}
const host = process.env.HOST;
if (host) listen(host);
else {
  listen("127.0.0.1");
  listen("::1");
}
console.log(`Social MCP Studio API v${VERSION} on http://localhost:${PORT}  (data: ${DATA_DIR})`);
resumeRenderQueue();
startWorkers();

process.on("unhandledRejection", (e: any) => console.error("[unhandledRejection]", e?.message ?? e));
