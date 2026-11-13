// Dev-only in-memory mock of the chat endpoints (?mock=1). Delegates post/brand changes to the main mock.
import type { ChatAction, ChatMessage, ChatResponse, ChatSession, Post } from "./types";
import { ApiError } from "./api";
import { mockHandle } from "./mock";

const sessions: ChatSession[] = [];
const messages: ChatMessage[] = [];
let seq = 0;
const nid = () => `c${++seq}${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function add(sessionId: string, role: ChatMessage["role"], text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  const m: ChatMessage = { id: nid(), sessionId, role, text, createdAt: now(), ...extra };
  messages.push(m);
  return m;
}
const act = (tool: string, label: string, extra: Partial<ChatAction> = {}): ChatAction => ({ id: nid(), tool, label, status: "done", ...extra });
const getPost = (id: string) => mockHandle("GET", `/api/posts/${id}`, undefined) as Promise<Post>;

async function globalReply(text: string, brandId = "b1"): Promise<{ text: string; actions: ChatAction[] }> {
  const t = text.toLowerCase();
  if (/\bplan\b/.test(t)) {
    const n = Number(t.match(/(\d+)\s*reels?/)?.[1] ?? 3);
    const posts = (await mockHandle("POST", `/api/brands/${brandId}/plan`, { reels: n })) as Post[];
    return { text: `Planned ${n} reels — renders are queued (mock).`, actions: [act("plan_content", `Planned ${n} reels`, { postIds: posts.map((p) => p.id), links: [...posts.map((p) => ({ label: p.title, postId: p.id })), { label: "Approve screen", to: "/approve" }] })] };
  }
  if (/\bapprove\b/.test(t)) {
    const ready = ((await mockHandle("GET", `/api/posts?brandId=${brandId}&status=ready`, undefined)) as Post[]).slice(0, 3);
    if (!ready.length) return { text: "Nothing is ready to approve.", actions: [] };
    return { text: `Approve ${ready.length} post(s)? Press Confirm.`, actions: [act("approve_posts", `Approve ${ready.length} posts`, { status: "pending_confirmation", input: { postIds: ready.map((p) => p.id) }, postIds: ready.map((p) => p.id), links: ready.map((p) => ({ label: p.title, postId: p.id })) })] };
  }
  if (/ready|waiting|posts|list/.test(t)) {
    const ready = (await mockHandle("GET", `/api/posts?brandId=${brandId}&status=ready`, undefined)) as Post[];
    return { text: ready.map((p) => `- ${p.title}`).join("\n") || "No posts.", actions: [act("list_posts", `Found ${ready.length} posts (ready)`, { links: ready.map((p) => ({ label: p.title, postId: p.id })) })] };
  }
  if (/calendar|scheduled/.test(t)) return { text: "Here's what's coming up (mock).", actions: [act("get_calendar", "Calendar", { links: [{ label: "Calendar", to: "/calendar" }] })] };
  return { text: "Mock assistant: try “plan 2 reels”, “what's ready?”, “approve all ready”, “show calendar”.\n\nTip: add an Anthropic API key in Settings to unlock full natural-language chat.", actions: [] };
}

async function postReply(post: Post, text: string): Promise<{ text: string; actions: ChatAction[]; revision?: number }> {
  const t = text.toLowerCase();
  if (/\?$|^what|^describe/.test(t)) return { text: `“${post.title}” — hook: “${post.hook}”. Caption: ${post.caption}`, actions: [] };
  if (/\bapprove\b/.test(t)) return { text: "Press Confirm to approve.", actions: [act("approve_post", `Approve “${post.title}”`, { status: "pending_confirmation", input: { postId: post.id }, postIds: [post.id] })] };
  const p = (await mockHandle("POST", `/api/posts/${post.id}/change`, { text })) as Post;
  const revision = p.revision + 1;
  return { text: `Done — I'm remaking it (“${text}”). Re-rendering as revision ${revision} (mock).`, actions: [act("request_change", `Revision ${revision} requested`, { revision, postIds: [post.id] })], revision };
}

export async function mockChat(method: string, path: string, body: any): Promise<unknown> {
  await sleep(400);
  const [p] = path.split("?");
  const mode = "rules" as const;
  if (method === "GET" && p === "/api/chat/info") return { mode, note: "Mock mode" };
  if (method === "GET" && p === "/api/chat/sessions") return sessions.filter((s) => s.kind === "global").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  let m = p.match(/^\/api\/chat\/sessions\/([^/]+)$/);
  if (m) {
    const s = sessions.find((x) => x.id === m![1]);
    if (!s) throw new ApiError("Chat session not found", 404);
    if (method === "DELETE") {
      sessions.splice(sessions.indexOf(s), 1);
      return { ok: true };
    }
    return { session: s, messages: messages.filter((x) => x.sessionId === s.id), mode };
  }
  if (method === "POST" && p === "/api/chat") {
    let s = sessions.find((x) => x.id === body.sessionId);
    if (!s) {
      s = { id: nid(), kind: "global", brandId: body.brandId, title: String(body.message).slice(0, 60), createdAt: now(), updatedAt: now() };
      sessions.push(s);
    }
    const u = add(s.id, "user", body.message);
    const r = await globalReply(body.message, body.brandId);
    const a = add(s.id, "assistant", r.text, { actions: r.actions.length ? r.actions : undefined, mode });
    s.updatedAt = now();
    return { session: s, messages: [u, a], mode } satisfies ChatResponse;
  }
  if (method === "POST" && p === "/api/chat/confirm") {
    const msg = messages.find((x) => x.actions?.some((a) => a.id === body.actionId));
    const action = msg?.actions?.find((a) => a.id === body.actionId);
    const s = sessions.find((x) => x.id === body.sessionId);
    if (!msg || !action || !s) throw new ApiError("Action not found", 404);
    if (action.status !== "pending_confirmation") throw new ApiError(`Already ${action.status}`, 409);
    let reply: ChatMessage;
    if (body.confirm === false) {
      action.status = "cancelled";
      reply = add(s.id, "assistant", "Okay, cancelled — nothing was changed.", { mode });
    } else {
      action.status = "confirmed";
      const ids: string[] = (action.input?.postIds as string[]) ?? [action.input?.postId as string];
      for (const id of ids) await mockHandle("POST", `/api/posts/${id}/approve`, {});
      reply = add(s.id, "assistant", `Done: approved ${ids.length} post(s).`, { mode, actions: [act(action.tool, `Approved ${ids.length} post(s)`, { postIds: ids, links: [{ label: "Calendar", to: "/calendar" }] })] });
    }
    const post = s.postId ? await getPost(s.postId) : undefined;
    return { session: s, messages: [msg, reply], post, mode } satisfies ChatResponse;
  }
  m = p.match(/^\/api\/posts\/([^/]+)\/(chat|revisions)$/);
  if (m) {
    const post = await getPost(m[1]);
    if (m[2] === "revisions") return post.mediaUrls.length ? [{ revision: post.revision, mediaUrls: post.mediaUrls, thumbnailUrl: post.thumbnailUrl, createdAt: post.updatedAt, current: true }] : [];
    let s = sessions.find((x) => x.kind === "post" && x.postId === post.id);
    if (method === "GET") return { session: s ?? { id: "", kind: "post", postId: post.id, title: post.title, createdAt: now(), updatedAt: now() }, messages: s ? messages.filter((x) => x.sessionId === s!.id) : [], post, mode };
    if (!s) {
      s = { id: nid(), kind: "post", postId: post.id, brandId: post.brandId, title: post.title, createdAt: now(), updatedAt: now() };
      sessions.push(s);
    }
    const u = add(s.id, "user", body.message);
    const r = await postReply(post, body.message);
    const a = add(s.id, "assistant", r.text, { actions: r.actions.length ? r.actions : undefined, mode, revision: r.revision });
    return { session: s, messages: [u, a], post: await getPost(post.id), mode } satisfies ChatResponse;
  }
  throw new ApiError(`Not found (mock chat): ${method} ${p}`, 404);
}
