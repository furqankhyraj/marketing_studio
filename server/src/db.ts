// SQLite storage (Node 24 built-in node:sqlite). Each entity is stored as a JSON document (TEXT)
// plus a few indexed columns used for filtering. Secrets (tokens, API keys) live in separate columns
// / keys and are never part of the returned documents.
import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { DB_PATH, DEFAULT_MODEL } from "./config.ts";
import { capHashtags } from "./hashtags.ts";
import type { Brand, Asset, Audit, Post, Automation, CommentLog, Settings, PostEvent } from "../../shared/types.ts";

export const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS brands (id TEXT PRIMARY KEY, data TEXT NOT NULL, ig_token TEXT, ig_token_expires TEXT, ig_username TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS audits (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, status TEXT, type TEXT, scheduled_at TEXT, data TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS comment_log (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, ig_comment_id TEXT UNIQUE, data TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS post_events (id TEXT PRIMARY KEY, post_id TEXT, brand_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT);
CREATE INDEX IF NOT EXISTS idx_events_post ON post_events(post_id);
CREATE INDEX IF NOT EXISTS idx_events_brand ON post_events(brand_id, at);
CREATE INDEX IF NOT EXISTS idx_assets_brand ON assets(brand_id);
CREATE INDEX IF NOT EXISTS idx_posts_brand ON posts(brand_id);
CREATE INDEX IF NOT EXISTS idx_posts_sched ON posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_comments_brand ON comment_log(brand_id);
`);

type Row = Record<string, any>;
const parse = <T>(r: Row | undefined): T | undefined => (r ? (JSON.parse(r.data) as T) : undefined);
const parseAll = <T>(rows: Row[]): T[] => rows.map((r) => JSON.parse(r.data) as T);

// ---------- settings ----------
/** Settings plus server-side extras (voice / stock). Secrets are only exposed as *Set booleans. */
export interface ServerSettings extends Settings {
  voice: string;
  autoVoiceover: boolean;
  pexelsApiKeySet: boolean;
  pixabayApiKeySet: boolean;
}

export function getSetting(key: string): string | undefined {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
  return r?.value ?? undefined;
}
export function setSetting(key: string, value: string | undefined | null) {
  if (value === undefined || value === null || value === "") db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  else
    db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
export function anthropicKey(): string | undefined {
  return getSetting("anthropicApiKey") || process.env.ANTHROPIC_API_KEY || undefined;
}
export const secrets = {
  igAppSecret: () => getSetting("igAppSecret") || process.env.IG_APP_SECRET || undefined,
  pexels: () => getSetting("pexelsApiKey") || process.env.PEXELS_API_KEY || undefined,
  pixabay: () => getSetting("pixabayApiKey") || process.env.PIXABAY_API_KEY || undefined,
  etsy: () => getSetting("etsyApiKey") || process.env.ETSY_API_KEY || undefined,
  apify: () => getSetting("apifyToken") || process.env.APIFY_TOKEN || undefined,
  claudeOauth: () => getSetting("claudeOauthToken") || process.env.CLAUDE_CODE_OAUTH_TOKEN || undefined, // `claude setup-token` (Claude Pro/Max subscription)
};
export function getSettings(): ServerSettings {
  return {
    anthropicApiKeySet: !!anthropicKey(),
    claudeSubscriptionSet: !!secrets.claudeOauth(),
    apifyTokenSet: !!secrets.apify(),
    llmProvider: (["api", "subscription"].includes(getSetting("llmProvider") ?? "") ? getSetting("llmProvider") : "auto") as "auto" | "api" | "subscription",
    anthropicModel: getSetting("anthropicModel") || DEFAULT_MODEL,
    igAppId: getSetting("igAppId") || process.env.IG_APP_ID || undefined,
    igAppSecretSet: !!secrets.igAppSecret(),
    publicBaseUrl: getSetting("publicBaseUrl") || undefined,
    timezone: getSetting("timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    autoPublish: getSetting("autoPublish") !== "false",
    voice: getSetting("voice") || "af_heart",
    autoVoiceover: getSetting("autoVoiceover") !== "false",
    autoMusic: getSetting("autoMusic") !== "false",
    musicVolume: (() => {
      const v = Number(getSetting("musicVolume"));
      return getSetting("musicVolume") !== undefined && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.3;
    })(),
    defaultMusicMood: getSetting("defaultMusicMood") || undefined,
    pexelsApiKeySet: !!secrets.pexels(),
    pixabayApiKeySet: !!secrets.pixabay(),
    etsyApiKeySet: !!secrets.etsy(),
  };
}

// ---------- brands ----------
export function listBrands(): Brand[] {
  return parseAll<Brand>(db.prepare("SELECT data FROM brands ORDER BY created_at").all() as Row[]);
}
export function getBrand(id: string): Brand | undefined {
  return parse<Brand>(db.prepare("SELECT data FROM brands WHERE id = ?").get(id) as Row | undefined);
}
export function saveBrand(b: Brand): Brand {
  db.prepare("INSERT INTO brands(id, data, created_at) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(
    b.id,
    JSON.stringify(b),
    b.createdAt,
  );
  return b;
}
export function updateBrand(id: string, fn: (b: Brand) => void): Brand | undefined {
  const b = getBrand(id);
  if (!b) return undefined;
  fn(b);
  b.updatedAt = new Date().toISOString();
  return saveBrand(b);
}
export function deleteBrand(id: string) {
  for (const t of ["assets", "audits", "posts", "automations", "comment_log"]) db.prepare(`DELETE FROM ${t} WHERE brand_id = ?`).run(id);
  for (const t of ["pins", "etsy_listings"]) try { db.prepare(`DELETE FROM ${t} WHERE brand_id = ?`).run(id); } catch { /* table not created yet */ }
  db.prepare("DELETE FROM brands WHERE id = ?").run(id);
}
export interface IgCreds {
  token: string;
  expires?: string;
  username?: string;
}
export function getIgCreds(brandId: string): IgCreds | undefined {
  const r = db.prepare("SELECT ig_token, ig_token_expires, ig_username FROM brands WHERE id = ?").get(brandId) as Row | undefined;
  if (!r?.ig_token) return undefined;
  return { token: r.ig_token, expires: r.ig_token_expires ?? undefined, username: r.ig_username ?? undefined };
}
export function setIgCreds(brandId: string, c: IgCreds | null) {
  db.prepare("UPDATE brands SET ig_token = ?, ig_token_expires = ?, ig_username = ? WHERE id = ?").run(
    c?.token ?? null,
    c?.expires ?? null,
    c?.username ?? null,
    brandId,
  );
}

// ---------- assets ----------
export function listAssets(brandId: string): Asset[] {
  return parseAll<Asset>(db.prepare("SELECT data FROM assets WHERE brand_id = ? ORDER BY created_at").all(brandId) as Row[]);
}
export function getAsset(id: string): Asset | undefined {
  return parse<Asset>(db.prepare("SELECT data FROM assets WHERE id = ?").get(id) as Row | undefined);
}
export function saveAsset(a: Asset): Asset {
  db.prepare("INSERT OR REPLACE INTO assets(id, brand_id, data, created_at) VALUES(?, ?, ?, ?)").run(a.id, a.brandId, JSON.stringify(a), a.createdAt);
  return a;
}
export function deleteAssetRow(id: string) {
  db.prepare("DELETE FROM assets WHERE id = ?").run(id);
}

// ---------- audits ----------
export function listAudits(brandId: string): Audit[] {
  return parseAll<Audit>(db.prepare("SELECT data FROM audits WHERE brand_id = ? ORDER BY created_at DESC").all(brandId) as Row[]);
}
export function saveAudit(a: Audit): Audit {
  db.prepare("INSERT OR REPLACE INTO audits(id, brand_id, data, created_at) VALUES(?, ?, ?, ?)").run(a.id, a.brandId, JSON.stringify(a), a.createdAt);
  return a;
}

// ---------- posts ----------
export function listPosts(f: { brandId?: string; status?: string; type?: string } = {}): Post[] {
  const where: string[] = [];
  const args: string[] = [];
  if (f.brandId) {
    where.push("brand_id = ?");
    args.push(f.brandId);
  }
  if (f.status) {
    where.push("status = ?");
    args.push(f.status);
  }
  if (f.type) {
    where.push("type = ?");
    args.push(f.type);
  }
  const sql = `SELECT data FROM posts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(scheduled_at, created_at)`;
  return parseAll<Post>(db.prepare(sql).all(...args) as Row[]);
}
export function getPost(id: string): Post | undefined {
  return parse<Post>(db.prepare("SELECT data FROM posts WHERE id = ?").get(id) as Row | undefined);
}
export function savePost(p: Post): Post {
  if (Array.isArray(p.hashtags)) p.hashtags = capHashtags(p.hashtags); // Instagram: max 5 hashtags
  db.prepare("INSERT OR REPLACE INTO posts(id, brand_id, status, type, scheduled_at, data, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)").run(
    p.id,
    p.brandId,
    p.status,
    p.type,
    p.scheduledAt ?? null,
    JSON.stringify(p),
    p.createdAt,
  );
  return p;
}
/** Read-modify-write a post (always starts from the latest DB state). Status / schedule changes are written to the action history. */
export function updatePost(id: string, fn: (p: any) => void): Post | undefined {
  const p = getPost(id);
  if (!p) return undefined;
  const before = { status: p.status, scheduledAt: p.scheduledAt };
  fn(p);
  p.updatedAt = new Date().toISOString();
  const saved = savePost(p);
  if (before.status !== p.status) logEvent({ postId: p.id, brandId: p.brandId, action: "status", detail: { from: before.status, to: p.status } });
  if (before.scheduledAt !== p.scheduledAt && p.status !== "rendering") logEvent({ postId: p.id, brandId: p.brandId, action: "rescheduled", detail: { from: before.scheduledAt ?? null, to: p.scheduledAt ?? null } });
  return saved;
}
export function deletePostRow(id: string) {
  db.prepare("DELETE FROM posts WHERE id = ?").run(id);
}

// ---------- action history ----------
// The actor is set per HTTP request (x-actor header, see index.ts); background workers run as "system".
export const actorStore = new AsyncLocalStorage<string>();
export const currentActor = () => actorStore.getStore() ?? "system";
export function logEvent(e: { postId?: string; brandId: string; action: string; detail?: Record<string, unknown>; actor?: string }): PostEvent {
  const ev: PostEvent = { id: randomBytes(8).toString("base64url"), postId: e.postId, brandId: e.brandId, at: new Date().toISOString(), actor: e.actor ?? currentActor(), action: e.action, detail: e.detail };
  db.prepare("INSERT INTO post_events(id, post_id, brand_id, at, actor, action, detail) VALUES(?, ?, ?, ?, ?, ?, ?)").run(ev.id, ev.postId ?? null, ev.brandId, ev.at, ev.actor, ev.action, ev.detail ? JSON.stringify(ev.detail) : null);
  return ev;
}
const rowToEvent = (r: Row): PostEvent => ({ id: r.id, postId: r.post_id ?? undefined, brandId: r.brand_id, at: r.at, actor: r.actor, action: r.action, detail: r.detail ? JSON.parse(r.detail) : undefined });
export function listPostEvents(postId: string): PostEvent[] {
  return (db.prepare("SELECT * FROM post_events WHERE post_id = ? ORDER BY at DESC LIMIT 200").all(postId) as Row[]).map(rowToEvent);
}
export function listBrandEvents(brandId: string, limit = 100): PostEvent[] {
  return (db.prepare("SELECT * FROM post_events WHERE brand_id = ? ORDER BY at DESC LIMIT ?").all(brandId, limit) as Row[]).map(rowToEvent);
}

// ---------- automations ----------
export function listAutomations(brandId?: string): Automation[] {
  const rows = brandId
    ? db.prepare("SELECT data FROM automations WHERE brand_id = ? ORDER BY created_at").all(brandId)
    : db.prepare("SELECT data FROM automations ORDER BY created_at").all();
  return parseAll<Automation>(rows as Row[]);
}
export function getAutomation(id: string): Automation | undefined {
  return parse<Automation>(db.prepare("SELECT data FROM automations WHERE id = ?").get(id) as Row | undefined);
}
export function saveAutomation(a: Automation): Automation {
  db.prepare("INSERT OR REPLACE INTO automations(id, brand_id, data, created_at) VALUES(?, ?, ?, ?)").run(a.id, a.brandId, JSON.stringify(a), a.createdAt);
  return a;
}
export function deleteAutomationRow(id: string) {
  db.prepare("DELETE FROM automations WHERE id = ?").run(id);
}

// ---------- comment log ----------
export function listComments(brandId: string): CommentLog[] {
  return parseAll<CommentLog>(
    db.prepare("SELECT data FROM comment_log WHERE brand_id = ? ORDER BY created_at DESC LIMIT 500").all(brandId) as Row[],
  );
}
export function hasComment(igCommentId: string): boolean {
  return !!db.prepare("SELECT 1 FROM comment_log WHERE ig_comment_id = ?").get(igCommentId);
}
export function saveComment(c: CommentLog): CommentLog {
  db.prepare("INSERT OR REPLACE INTO comment_log(id, brand_id, ig_comment_id, data, created_at) VALUES(?, ?, ?, ?, ?)").run(
    c.id,
    c.brandId,
    c.igCommentId,
    JSON.stringify(c),
    c.createdAt,
  );
  return c;
}
