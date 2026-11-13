import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const VERSION = "0.1.0";
export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT_DIR = path.resolve(SERVER_DIR, "..");
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, "data"));
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const RENDERS_DIR = path.join(DATA_DIR, "renders");
export const DB_PATH = path.join(DATA_DIR, "db.sqlite");
export const PORT = Number(process.env.PORT || 4300);
export const SERVER_URL = (process.env.SERVER_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
export const WEB_URL = (process.env.WEB_URL || "http://localhost:5173").replace(/\/$/, "");
export const IG_API_VERSION = process.env.IG_API_VERSION || "v23.0";
export const IG_REDIRECT_URI = `${SERVER_URL}/api/instagram/callback`;
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_BEST_TIMES = ["Tue 18:00", "Thu 12:30", "Sat 10:00"];

for (const d of [DATA_DIR, UPLOADS_DIR, RENDERS_DIR]) fs.mkdirSync(d, { recursive: true });

/** Convert an absolute path under DATA_DIR to a public http URL under /files. */
export function fileUrlFor(absPath: string): string {
  const rel = path.relative(DATA_DIR, absPath).split(path.sep).map(encodeURIComponent).join("/");
  return `${SERVER_URL}/files/${rel}`;
}

/** Convert one of our /files URLs back to its absolute local path (or undefined if not ours). */
export function localPathForUrl(url: string): string | undefined {
  const m = url.match(/\/files\/(.+)$/);
  if (!m) return undefined;
  const rel = m[1].split("/").map(decodeURIComponent).join(path.sep);
  const abs = path.resolve(DATA_DIR, rel);
  if (!abs.startsWith(DATA_DIR)) return undefined;
  return abs;
}

/** Public (tunnel) URL for one of our /files URLs. */
export function publicUrlFor(url: string, publicBaseUrl: string): string {
  const m = url.match(/\/files\/(.+)$/);
  return m ? `${publicBaseUrl.replace(/\/$/, "")}/files/${m[1]}` : url;
}

export const nowIso = () => new Date().toISOString();
