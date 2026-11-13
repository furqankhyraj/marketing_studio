// Thin HTTP client for the Social MCP Studio API.
// Never writes to stdout (stdout is reserved for the MCP protocol).

export const API_BASE = (process.env.SOCIAL_MCP_API || "http://localhost:4300").replace(/\/+$/, "");

export const NOT_RUNNING_MESSAGE =
  "Social MCP Studio server is not running — start it with `npm run dev` in server/ (or the root start script).";

export class ApiDownError extends Error {
  constructor(cause?: unknown) {
    super(NOT_RUNNING_MESSAGE);
    this.name = "ApiDownError";
    (this as { cause?: unknown }).cause = cause;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function log(...args: unknown[]): void {
  // stderr only
  console.error("[social-mcp]", ...args);
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const p = path.startsWith("/api") ? path : `/api${path.startsWith("/") ? "" : "/"}${path}`;
  const url = new URL(API_BASE + p);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function api<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts: { body?: unknown; query?: Query; timeoutMs?: number } = {},
): Promise<T> {
  const url = buildUrl(path, opts.query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "x-actor": "claude-mcp", ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error)?.name === "AbortError") {
      throw new ApiError(504, `Request to ${method} ${path} timed out.`);
    }
    // ECONNREFUSED / DNS / network failure → server is not running
    throw new ApiDownError(err);
  }
  clearTimeout(timer);
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "error" in data && String((data as { error: unknown }).error)) ||
      (typeof data === "string" && data.slice(0, 500)) ||
      res.statusText;
    throw new ApiError(res.status, `API ${method} ${path} failed (${res.status}): ${msg}`);
  }
  return data as T;
}

export const get = <T>(path: string, query?: Query) => api<T>("GET", path, { query });
export const post = <T>(path: string, body?: unknown, timeoutMs?: number) =>
  api<T>("POST", path, { body: body ?? {}, timeoutMs });
export const patch = <T>(path: string, body: unknown) => api<T>("PATCH", path, { body });
export const del = <T>(path: string) => api<T>("DELETE", path);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
