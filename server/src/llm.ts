// Thin wrapper around the Anthropic SDK that asks for JSON and parses it robustly.
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import os from "node:os";
import { anthropicKey, getSettings, getSetting, secrets } from "./db.ts";

/**
 * Which backend writes text:
 *  - "subscription": the Claude Code CLI (`claude -p`) authenticated with CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`
 *    → runs on the owner's Claude Pro/Max subscription, no API billing.
 *  - "api": the Anthropic API key (pay as you go).
 * Setting llmProvider: "auto" (default: subscription when a token is set, else API), "api" or "subscription".
 */
export function llmMode(): "api" | "subscription" | undefined {
  const pref = getSettings().llmProvider ?? "auto";
  const api = !!anthropicKey();
  const sub = !!secrets.claudeOauth();
  if (pref === "api") return api ? "api" : undefined;
  if (pref === "subscription") return sub ? "subscription" : undefined;
  return sub ? "subscription" : api ? "api" : undefined;
}

export function llmAvailable(): boolean {
  return !!llmMode();
}

// ---- Claude subscription via the Claude Code CLI ----
const cliPath = () => getSetting("claudeCliPath") || process.env.CLAUDE_CLI || (process.platform === "win32" ? "claude.exe" : "claude");
let running = 0;
const waiters: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => waiters.push(r)); // at most 2 CLI calls at once
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.();
  }
}

function runClaudeCli(system: string, user: string, model: string, timeoutMs = 240_000): Promise<string> {
  return slot(
    () =>
      new Promise<string>((resolve, reject) => {
        const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: secrets.claudeOauth() };
        delete env.ANTHROPIC_API_KEY; // would take precedence over the subscription token
        delete env.ANTHROPIC_AUTH_TOKEN;
        const args = ["-p", "--output-format", "json", "--system-prompt", system, "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--setting-sources", "", "--model", model];
        const child = spawn(cliPath(), args, { cwd: os.tmpdir(), env, windowsHide: true });
        let out = "";
        let err = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`claude CLI timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", (e: any) => {
          clearTimeout(timer);
          reject(new Error(e?.code === "ENOENT" ? "Claude Code CLI not found — install Claude Code or set claudeCliPath in settings" : String(e?.message ?? e)));
        });
        child.on("close", () => {
          clearTimeout(timer);
          let r: any;
          try {
            r = JSON.parse(out.trim().split("\n").pop() || "{}");
          } catch {
            return reject(new Error(`claude CLI returned no JSON: ${(err || out).slice(0, 300)}`));
          }
          if (r.is_error || r.subtype !== "success") return reject(new Error(`Claude subscription: ${String(r.result ?? r.subtype ?? "error").slice(0, 300)}`));
          resolve(String(r.result ?? ""));
        });
        child.stdin.end(user);
      }),
  );
}

let client: { key: string; c: Anthropic } | undefined;
function getClient(): Anthropic {
  const key = anthropicKey();
  if (!key) throw new Error("No Anthropic API key configured");
  if (!client || client.key !== key) client = { key, c: new Anthropic({ apiKey: key }) };
  return client.c;
}

/** Extract the first JSON object/array from a model response. */
export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("No JSON in model response");
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  // scan for the matching bracket (string-aware)
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
  }
  return JSON.parse(body.slice(start));
}

export async function askJson<T = any>(system: string, user: string, maxTokens = 8000): Promise<T> {
  const model = getSettings().anthropicModel;
  if (llmMode() === "subscription") {
    const text = await runClaudeCli(system + "\n\nRespond with a single valid JSON value only. No prose, no markdown fences.", user, model);
    return extractJson(text) as T;
  }
  const c = getClient();
  const res = await c.messages.create({
    model,
    max_tokens: maxTokens,
    system: system + "\n\nRespond with a single valid JSON value only. No prose, no markdown fences.",
    messages: [{ role: "user", content: user }],
  });
  const text = res.content
    .map((b: any) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  return extractJson(text) as T;
}
