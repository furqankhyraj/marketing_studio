// Chat: a conversation per post (post detail drawer) and a global assistant that can drive the whole app.
// With an Anthropic key: Claude tool-use agent loop (chat-agent.ts) over the internal tools (chat-tools.ts).
// Without a key: rule-based router (chat-rules.ts). Sensitive tools always need a Confirm click.
import type { Express, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { nanoid } from "nanoid";
import type { ChatAction, ChatMessage, ChatMode, ChatResponse, ChatSession, Post } from "../../shared/types.ts";
import * as db from "./db.ts";
import { nowIso } from "./config.ts";
import { runAgentLoop, toLlmHistory, type AgentEvent, type LlmLike } from "./chat-agent.ts";
import { buildTools, ChatError, fmtWhen, postDetail, postRevisions, postOrThrow } from "./chat-tools.ts";
import { actionFrom, KEY_NOTE, rulesGlobalTurn, rulesPostTurn } from "./chat-rules.ts";

// ---------- storage ----------
db.db.exec(`
CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, post_id TEXT, brand_id TEXT, data TEXT NOT NULL, created_at TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_post ON chat_sessions(post_id);
CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
`);
type Row = Record<string, any>;

function saveSession(s: ChatSession): ChatSession {
  db.db
    .prepare(
      "INSERT INTO chat_sessions(id, kind, post_id, brand_id, data, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, brand_id = excluded.brand_id, updated_at = excluded.updated_at",
    )
    .run(s.id, s.kind, s.postId ?? null, s.brandId ?? null, JSON.stringify(s), s.createdAt, s.updatedAt);
  return s;
}
export function getSession(id: string): ChatSession | undefined {
  const r = db.db.prepare("SELECT data FROM chat_sessions WHERE id = ?").get(id) as Row | undefined;
  return r ? (JSON.parse(r.data) as ChatSession) : undefined;
}
export function listSessions(kind: "global" | "post" = "global", limit = 50): ChatSession[] {
  return (db.db.prepare("SELECT data FROM chat_sessions WHERE kind = ? ORDER BY updated_at DESC LIMIT ?").all(kind, limit) as Row[]).map((r) => JSON.parse(r.data));
}
function postSession(post: Post, create: boolean): ChatSession | undefined {
  const r = db.db.prepare("SELECT data FROM chat_sessions WHERE kind = 'post' AND post_id = ? ORDER BY created_at LIMIT 1").get(post.id) as Row | undefined;
  if (r) return JSON.parse(r.data);
  if (!create) return undefined;
  const now = nowIso();
  return saveSession({ id: nanoid(12), kind: "post", postId: post.id, brandId: post.brandId, title: post.title, createdAt: now, updatedAt: now });
}
export function listMessages(sessionId: string): ChatMessage[] {
  return (db.db.prepare("SELECT data FROM chat_messages WHERE session_id = ? ORDER BY rowid").all(sessionId) as Row[]).map((r) => JSON.parse(r.data));
}
function addMessage(m: Omit<ChatMessage, "id" | "createdAt">): ChatMessage {
  const msg: ChatMessage = { id: nanoid(12), createdAt: nowIso(), ...m };
  db.db.prepare("INSERT INTO chat_messages(id, session_id, data, created_at) VALUES(?, ?, ?, ?)").run(msg.id, msg.sessionId, JSON.stringify(msg), msg.createdAt);
  return msg;
}
function updateMessage(m: ChatMessage) {
  db.db.prepare("UPDATE chat_messages SET data = ? WHERE id = ?").run(JSON.stringify(m), m.id);
}
function deleteSession(id: string) {
  db.db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(id);
  db.db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
}

// ---------- LLM ----------
let testClient: LlmLike | undefined;
/** Tests: inject a stub Anthropic client (also forces the LLM path). */
export function setChatClientForTests(c: LlmLike | undefined) {
  testClient = c;
}
let cached: { key: string; c: Anthropic } | undefined;
function llmClient(): LlmLike | undefined {
  if (testClient) return testClient;
  const key = db.anthropicKey();
  if (!key) return undefined;
  if (!cached || cached.key !== key) cached = { key, c: new Anthropic({ apiKey: key }) };
  return cached.c as unknown as LlmLike;
}

function baseContext(): string {
  const s = db.getSettings();
  const brands = db.listBrands();
  const now = new Date();
  return [
    `Now: ${now.toISOString()} (${fmtWhen(now.toISOString())} in ${s.timezone}). Interpret times the user gives in ${s.timezone} and pass ISO 8601 with offset.`,
    `Brands: ${brands.map((b) => `${b.name} (id ${b.id}${b.igConnected ? ", Instagram connected" : ""})`).join("; ") || "none yet"}.`,
    `Auto-publish of approved posts: ${s.autoPublish ? "on" : "off"}.`,
  ].join("\n");
}

const RULES = `Rules:
- Be concise and friendly. Plain text, short paragraphs or bullets. After acting, say what you did and what happens next.
- approve_post, approve_posts, publish_now, delete_post and delete_automation are NOT executed when you call them: the app shows the user a Confirm/Cancel card. Call the tool once, then tell the user to press Confirm. Never claim it's done.
- Renders run one at a time on the CPU (a reel takes ~3–4 minutes). Don't wait for them; tell the user the result will appear when ready.
- Respect each brand's voice and claimsToAvoid. Never ask for passwords or tokens.`;

function globalSystem(brandId?: string): string {
  const b = brandId ? db.getBrand(brandId) : undefined;
  return `You are the built-in assistant of Social MCP Studio, a local app that plans, renders, approves and publishes Instagram reels, carousels, stories and single-image posts (create_image_post) for the user's brands, and can run a weekly autopilot (get_autopilot / set_autopilot; auto-approval only via set_autopilot_auto_approve, which the user confirms). You can do anything the app can through your tools: create/analyze brands, run audits, plan or write posts, edit posts, list/approve/schedule/publish, automations, calendar, styles, music, voices and Instagram status.
${baseContext()}
${b ? `The user currently has "${b.name}" (id ${b.id}) selected in the dashboard; assume that brand unless they name another.` : ""}
${RULES}`;
}

function postSystem(post: Post): string {
  return `You are the editing assistant for one Instagram ${post.type} in Social MCP Studio. The user is looking at it and chatting to change it, like asking a designer.
${baseContext()}
Current post (id ${post.id}):
${postDetail(post)}

How to edit:
- Precise edits (hook, scene/slide text, style, caption style, length via targetDurationSec, voice, end card, caption, hashtags, schedule) → update_post with postId "${post.id}". Combine all requested edits into ONE call.
- Creative rewrites or anything update_post can't express (translations, tone, rewriting the script, new scenes) → request_change with a clear, complete instruction.
- Music → list_music then set_post_music. Voices → list_voices.
- Questions about the post ("what does it say?") → answer from the details above; no tool needed.
- After a change, explain briefly what you changed and that it is re-rendering as a new revision (the panel shows progress and the new video).
${RULES}`;
}

// ---------- turns ----------
type Emit = (e: AgentEvent) => void;

function touchSession(s: ChatSession, patch: Partial<ChatSession>, firstText?: string): ChatSession {
  const next: ChatSession = { ...s, ...patch, updatedAt: nowIso() };
  if (firstText && (!s.title || s.title === "New chat")) next.title = firstText.replace(/\s+/g, " ").slice(0, 60);
  return saveSession(next);
}

async function llmTurn(client: LlmLike, system: string, history: ChatMessage[], ctx: { sessionId: string; brandId?: string; postId?: string }, emit?: Emit) {
  return runAgentLoop({
    client,
    model: db.getSettings().anthropicModel,
    system,
    messages: toLlmHistory(history),
    tools: buildTools(),
    ctx,
    maxSteps: 8,
    onEvent: emit,
  });
}

export async function globalTurn(input: { sessionId?: string; message: string; brandId?: string }, emit?: Emit): Promise<ChatResponse> {
  const text = input.message.trim();
  if (!text) throw new ChatError(400, "message is required");
  let session = input.sessionId ? getSession(input.sessionId) : undefined;
  if (input.sessionId && !session) throw new ChatError(404, "Chat session not found");
  if (session && session.kind !== "global") throw new ChatError(400, "Use POST /api/posts/:id/chat for post chats");
  if (!session) {
    const now = nowIso();
    session = saveSession({ id: nanoid(12), kind: "global", brandId: input.brandId, title: "New chat", createdAt: now, updatedAt: now });
  }
  const brandId = input.brandId ?? session.brandId;
  const prior = listMessages(session.id);
  const userMsg = addMessage({ sessionId: session.id, role: "user", text });
  const client = llmClient();
  let mode: ChatMode = "rules";
  let reply: { text: string; actions: ChatAction[]; lastPostIds?: string[]; brandId?: string };
  if (client) {
    try {
      const r = await llmTurn(client, globalSystem(brandId), [...prior, userMsg], { sessionId: session.id, brandId }, emit);
      reply = { text: r.text, actions: r.actions, lastPostIds: r.actions.flatMap((a) => a.postIds ?? []).slice(0, 20) };
      mode = "llm";
    } catch (e: any) {
      console.warn("[chat] LLM failed, using rules:", e?.message ?? e);
      const r = await rulesGlobalTurn(text, { brandId, session, hasPending: hasPending(prior) });
      reply = { ...r, text: `(Claude couldn't be reached: ${e?.message ?? e}. Answering in simple mode.)\n\n${r.text}` };
    }
  } else {
    emit?.({ type: "status", text: "Working on it…" });
    reply = await rulesGlobalTurn(text, { brandId, session, hasPending: hasPending(prior) });
  }
  for (const a of reply.actions) emit?.({ type: "action", action: a });
  const asst = addMessage({ sessionId: session.id, role: "assistant", text: reply.text, actions: reply.actions.length ? reply.actions : undefined, mode });
  session = touchSession(
    session,
    { brandId: brandId ?? reply.brandId, context: { ...session.context, ...(reply.lastPostIds?.length ? { lastPostIds: reply.lastPostIds } : {}), ...(reply.brandId ? { brandId: reply.brandId } : {}) } },
    prior.length ? undefined : text,
  );
  return { session, messages: [userMsg, asst], mode };
}

export async function postTurn(postId: string, message: string, emit?: Emit): Promise<ChatResponse> {
  const text = message.trim();
  if (!text) throw new ChatError(400, "message is required");
  const post = postOrThrow(postId);
  let session = postSession(post, true)!;
  const prior = listMessages(session.id);
  const userMsg = addMessage({ sessionId: session.id, role: "user", text });
  const client = llmClient();
  let mode: ChatMode = "rules";
  let reply: { text: string; actions: ChatAction[]; revision?: number };
  if (client) {
    try {
      const r = await llmTurn(client, postSystem(post), [...prior, userMsg], { sessionId: session.id, brandId: post.brandId, postId: post.id }, emit);
      const revs = r.actions.map((a) => a.revision).filter((x): x is number => typeof x === "number");
      reply = { text: r.text, actions: r.actions, revision: revs.length ? Math.max(...revs) : undefined };
      mode = "llm";
    } catch (e: any) {
      console.warn("[chat] LLM failed, using rules:", e?.message ?? e);
      const r = await rulesPostTurn(post, text);
      reply = { ...r, text: `(Claude couldn't be reached: ${e?.message ?? e}. Answering in simple mode.)\n\n${r.text}` };
    }
  } else {
    emit?.({ type: "status", text: "Working on it…" });
    reply = await rulesPostTurn(post, text);
  }
  for (const a of reply.actions) emit?.({ type: "action", action: a });
  const asst = addMessage({ sessionId: session.id, role: "assistant", text: reply.text, actions: reply.actions.length ? reply.actions : undefined, mode, revision: reply.revision });
  const after = db.getPost(post.id);
  session = touchSession(session, { title: after?.title ?? session.title });
  return { session, messages: [userMsg, asst], post: after, mode };
}

function hasPending(msgs: ChatMessage[]) {
  return msgs.some((m) => m.actions?.some((a) => a.status === "pending_confirmation"));
}

/** Confirm or cancel a pending sensitive action. Only this executes approve/publish/delete. */
export async function confirmAction(sessionId: string, actionId: string, confirm: boolean): Promise<ChatResponse> {
  const session = getSession(sessionId);
  if (!session) throw new ChatError(404, "Chat session not found");
  const msgs = listMessages(sessionId);
  const msg = msgs.find((m) => m.actions?.some((a) => a.id === actionId));
  const action = msg?.actions?.find((a) => a.id === actionId);
  if (!msg || !action) throw new ChatError(404, "Action not found");
  if (action.status !== "pending_confirmation") throw new ChatError(409, `This action was already ${action.status.replace("_", " ")}.`);
  const tool = buildTools().find((t) => t.name === action.tool);
  if (!tool?.sensitive) throw new ChatError(400, "This action doesn't need confirmation");

  let reply: ChatMessage;
  if (!confirm) {
    action.status = "cancelled";
    updateMessage(msg);
    reply = addMessage({ sessionId, role: "assistant", text: `Okay, cancelled — nothing was changed (${action.label}).`, mode: "rules" });
  } else {
    action.status = "confirmed";
    updateMessage(msg);
    let r;
    try {
      r = await tool.run({ ...(action.input ?? {}), userConfirmed: true }, { sessionId, brandId: session.brandId, postId: session.postId });
    } catch (e: any) {
      r = { ok: false, label: `${action.label} failed`, text: e?.message ?? String(e) };
    }
    const done = actionFrom(tool.name, r);
    reply = addMessage({ sessionId, role: "assistant", text: r.ok ? `Done: ${r.text}` : `That didn't work: ${r.text}`, actions: [done], mode: "rules" });
  }
  const s = touchSession(session, {});
  const post = session.postId ? db.getPost(session.postId) : undefined;
  return { session: s, messages: [msg, reply], post, mode: "rules" };
}

// ---------- HTTP ----------
function wantsStream(req: Request) {
  return req.body?.stream === true || String(req.headers.accept ?? "").includes("text/event-stream");
}

/** Run a turn either as plain JSON or as Server-Sent Events (status / action / done / error). */
async function respond(req: Request, res: Response, fn: (emit?: Emit) => Promise<ChatResponse>) {
  if (!wantsStream(req)) {
    res.json(await fn());
    return;
  }
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const ping = setInterval(() => !res.writableEnded && res.write(": ping\n\n"), 15000);
  try {
    const out = await fn((e) => send(e.type, e.type === "status" ? { text: e.text } : { action: e.action }));
    send("done", out);
  } catch (e: any) {
    send("error", { error: String(e?.message ?? e), status: e?.status ?? 500 });
  } finally {
    clearInterval(ping);
    res.end();
  }
}

export function registerChatRoutes(app: Express) {
  app.post("/api/chat", (req, res) =>
    respond(req, res, (emit) =>
      globalTurn({ sessionId: typeof req.body?.sessionId === "string" ? req.body.sessionId : undefined, message: String(req.body?.message ?? ""), brandId: typeof req.body?.brandId === "string" ? req.body.brandId : undefined }, emit),
    ),
  );
  app.get("/api/chat/sessions", (_req, res) => res.json(listSessions("global")));
  app.get("/api/chat/sessions/:id", (req, res) => {
    const s = getSession(String(req.params.id));
    if (!s) throw new ChatError(404, "Chat session not found");
    res.json({ session: s, messages: listMessages(s.id), mode: llmClient() ? "llm" : "rules" });
  });
  app.delete("/api/chat/sessions/:id", (req, res) => {
    deleteSession(String(req.params.id));
    res.json({ ok: true });
  });
  app.post("/api/chat/confirm", async (req, res) => {
    const b = req.body ?? {};
    if (typeof b.sessionId !== "string" || typeof b.actionId !== "string") throw new ChatError(400, "sessionId and actionId are required");
    res.json(await confirmAction(b.sessionId, b.actionId, b.confirm !== false));
  });
  app.get("/api/chat/info", (_req, res) => res.json({ mode: llmClient() ? "llm" : "rules", note: llmClient() ? undefined : KEY_NOTE }));

  app.get("/api/posts/:id/chat", (req, res) => {
    const post = postOrThrow(String(req.params.id));
    const s = postSession(post, false);
    const now = nowIso();
    res.json({
      session: s ?? { id: "", kind: "post", postId: post.id, brandId: post.brandId, title: post.title, createdAt: now, updatedAt: now },
      messages: s ? listMessages(s.id) : [],
      post,
      mode: llmClient() ? "llm" : "rules",
    } satisfies ChatResponse);
  });
  app.post("/api/posts/:id/chat", (req, res) => respond(req, res, (emit) => postTurn(String(req.params.id), String(req.body?.message ?? ""), emit)));
  app.get("/api/posts/:id/revisions", (req, res) => res.json(postRevisions(postOrThrow(String(req.params.id)))));
}


