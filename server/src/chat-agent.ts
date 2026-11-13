// Anthropic tool-use loop for the chat assistant. Pure: no DB access, so it can be unit-tested with a stub client.
import { nanoid } from "nanoid";
import type { ChatAction, ChatLink } from "../../shared/types.ts";

export interface ToolCtx {
  sessionId: string;
  brandId?: string;
  postId?: string;
}

export interface ToolResult {
  ok: boolean;
  text: string;                 // what the model (and the action card detail) sees
  label: string;                // short card label, e.g. "Planned 3 reels"
  links?: ChatLink[];
  postIds?: string[];
  brandId?: string;
  revision?: number;
}

export interface ChatTool {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** Sensitive tools are never run by the agent: they become a pending confirmation card. */
  sensitive?: boolean;
  /** Label for a pending confirmation, e.g. "Approve “Reel title”". */
  describe?: (input: any) => string;
  run: (input: any, ctx: ToolCtx) => Promise<ToolResult>;
}

/** The subset of the Anthropic client the loop uses (lets tests pass a stub). */
export interface LlmLike {
  messages: { create(params: any): Promise<{ content: any[]; stop_reason?: string | null }> };
}

export type AgentEvent = { type: "status"; text: string } | { type: "action"; action: ChatAction };

export interface AgentResult {
  text: string;
  actions: ChatAction[];
  steps: number;
}

const MAX_RESULT_CHARS = 6000;

export async function runAgentLoop(opts: {
  client: LlmLike;
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: any }[];
  tools: ChatTool[];
  ctx: ToolCtx;
  maxSteps?: number;
  maxTokens?: number;
  onEvent?: (e: AgentEvent) => void;
}): Promise<AgentResult> {
  const { client, model, system, tools, ctx, onEvent } = opts;
  const maxSteps = opts.maxSteps ?? 8;
  const messages = [...opts.messages];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  const texts: string[] = [];
  const actions: ChatAction[] = [];
  let steps = 0;
  let exhausted = false;

  for (;;) {
    if (steps >= maxSteps) {
      exhausted = true;
      break;
    }
    steps++;
    onEvent?.({ type: "status", text: steps === 1 ? "Thinking…" : "Working on it…" });
    const res = await client.messages.create({ model, max_tokens: opts.maxTokens ?? 4096, system, tools: toolDefs, messages });
    const content = Array.isArray(res.content) ? res.content : [];
    messages.push({ role: "assistant", content });
    const text = content
      .filter((b) => b?.type === "text")
      .map((b) => String(b.text ?? ""))
      .join("")
      .trim();
    if (text) texts.push(text);
    const uses = content.filter((b) => b?.type === "tool_use");
    if (!uses.length) break;

    const results: any[] = [];
    for (const u of uses) {
      const tool = byName.get(u.name);
      const input = u.input && typeof u.input === "object" ? u.input : {};
      if (!tool) {
        results.push({ type: "tool_result", tool_use_id: u.id, content: `Unknown tool: ${u.name}`, is_error: true });
        continue;
      }
      if (tool.sensitive) {
        const { userConfirmed: _drop, ...clean } = input as Record<string, unknown>;
        const action: ChatAction = {
          id: nanoid(10),
          tool: tool.name,
          label: tool.describe?.(clean) ?? tool.name,
          status: "pending_confirmation",
          input: clean,
          postIds: typeof clean.postId === "string" ? [clean.postId] : Array.isArray(clean.postIds) ? (clean.postIds as string[]) : undefined,
          links: typeof clean.postId === "string" ? [{ label: "Open post", postId: clean.postId }] : undefined,
        };
        actions.push(action);
        onEvent?.({ type: "action", action });
        results.push({
          type: "tool_result",
          tool_use_id: u.id,
          content:
            "NOT EXECUTED YET. The app now shows the user a Confirm / Cancel card for this action. " +
            "Tell the user briefly what will happen and ask them to press Confirm. Do not call this tool again for the same item, and do not say it is done.",
        });
        continue;
      }
      onEvent?.({ type: "status", text: `Running ${tool.name.replace(/_/g, " ")}…` });
      let r: ToolResult;
      try {
        r = await tool.run(input, ctx);
      } catch (e: any) {
        r = { ok: false, text: `Error: ${e?.message ?? e}`, label: `${tool.name.replace(/_/g, " ")} failed` };
      }
      const action: ChatAction = {
        id: nanoid(10),
        tool: tool.name,
        label: r.label,
        status: r.ok ? "done" : "failed",
        detail: r.text.slice(0, 1500),
        links: r.links,
        postIds: r.postIds,
        brandId: r.brandId,
        revision: r.revision,
      };
      actions.push(action);
      onEvent?.({ type: "action", action });
      results.push({ type: "tool_result", tool_use_id: u.id, content: r.text.slice(0, MAX_RESULT_CHARS), ...(r.ok ? {} : { is_error: true }) });
    }
    messages.push({ role: "user", content: results });
  }

  let text = texts.join("\n\n").trim();
  if (exhausted) text = (text ? text + "\n\n" : "") + `(I stopped after ${maxSteps} steps — ask me to continue if there is more to do.)`;
  if (!text) text = actions.length ? "Done." : "…";
  return { text, actions, steps };
}

/**
 * Convert stored chat messages into Anthropic messages: plain text turns, action summaries folded into the
 * assistant text, consecutive same-role turns merged, and the list starting with a user turn.
 */
export function toLlmHistory(
  msgs: { role: "user" | "assistant"; text: string; actions?: ChatAction[] }[],
  limit = 24,
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of msgs.slice(-limit)) {
    let content = m.text || "";
    if (m.role === "assistant" && m.actions?.length) {
      const lines = m.actions.map((a) => {
        const st = a.status === "pending_confirmation" ? "awaiting the user's Confirm click" : a.status;
        const ids = a.postIds?.length ? ` (posts: ${a.postIds.join(", ")})` : "";
        return `- ${a.tool}: ${a.label} [${st}]${ids}`;
      });
      content += `\n\n[Actions]\n${lines.join("\n")}`;
    }
    if (!content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + content;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}
