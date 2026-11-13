// Chat API client: post chat + global assistant. Streams Server-Sent Events when the server supports them
// (status / action / done / error) and falls back to plain JSON. Mock mode (?mock=1) uses lib/mockChat.ts.
import { ApiError, mockEnabled, SERVER_DOWN_MSG } from "./api";
import type { ChatAction, ChatMessage, ChatMode, ChatResponse, ChatSession, Post, PostRevision } from "./types";

export type ChatEvents = { onStatus?: (text: string) => void; onAction?: (a: ChatAction) => void };
export type ChatInfo = { mode: ChatMode; note?: string };
export type SessionData = { session: ChatSession; messages: ChatMessage[]; mode: ChatMode; post?: Post };

const MOCK = mockEnabled();

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  if (MOCK) {
    const { mockChat } = await import("./mockChat");
    return mockChat(method, path, body) as Promise<T>;
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(SERVER_DOWN_MSG, 0, true);
  }
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    if (!data?.error && res.status >= 500) throw new ApiError(SERVER_DOWN_MSG, res.status, true);
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  if (data === undefined) throw new ApiError(SERVER_DOWN_MSG, res.status, true);
  return data as T;
}

/** POST a chat turn as SSE; resolves with the final ChatResponse. */
async function stream(path: string, body: Record<string, unknown>, ev: ChatEvents = {}): Promise<ChatResponse> {
  if (MOCK) {
    const { mockChat } = await import("./mockChat");
    ev.onStatus?.("Thinking…");
    return mockChat("POST", path, body) as Promise<ChatResponse>;
  }
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ ...body, stream: true }) });
  } catch {
    throw new ApiError(SERVER_DOWN_MSG, 0, true);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/event-stream") || !res.body) {
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(SERVER_DOWN_MSG, res.status, true);
    }
    if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
    return data as ChatResponse;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let done: ChatResponse | undefined;
  for (;;) {
    const { value, done: eof } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === "status") ev.onStatus?.(parsed.text);
      else if (event === "action") ev.onAction?.(parsed.action);
      else if (event === "done") done = parsed;
      else if (event === "error") throw new ApiError(parsed.error ?? "Chat failed", parsed.status ?? 500);
    }
    if (eof) break;
  }
  if (!done) throw new ApiError("The chat stream ended unexpectedly", 500);
  return done;
}

export const chatApi = {
  info: () => call<ChatInfo>("GET", "/api/chat/info"),
  sessions: () => call<ChatSession[]>("GET", "/api/chat/sessions"),
  session: (id: string) => call<SessionData>("GET", `/api/chat/sessions/${id}`),
  deleteSession: (id: string) => call<{ ok: true }>("DELETE", `/api/chat/sessions/${id}`),
  send: (b: { sessionId?: string; message: string; brandId?: string }, ev?: ChatEvents) => stream("/api/chat", b, ev),
  confirm: (sessionId: string, actionId: string, confirm: boolean) => call<ChatResponse>("POST", "/api/chat/confirm", { sessionId, actionId, confirm }),
  postChat: (postId: string) => call<SessionData>("GET", `/api/posts/${postId}/chat`),
  sendPost: (postId: string, message: string, ev?: ChatEvents) => stream(`/api/posts/${postId}/chat`, { message }, ev),
  revisions: (postId: string) => call<PostRevision[]>("GET", `/api/posts/${postId}/revisions`),
};

/** Replace messages by id, appending new ones. */
export function mergeMessages(list: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const out = [...list];
  for (const m of incoming) {
    const i = out.findIndex((x) => x.id === m.id);
    if (i >= 0) out[i] = m;
    else out.push(m);
  }
  return out;
}
