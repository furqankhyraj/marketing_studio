// Smoke test: spawns the MCP server over stdio with the official SDK client,
// lists tools/prompts/resources and calls a few tools.
// Usage: npx tsx scripts/smoke.ts   (or: npm run smoke)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const mcpDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = path.join(mcpDir, "node_modules", "tsx", "dist", "cli.mjs");
const entry = path.join(mcpDir, "src", "index.ts");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [tsxCli, entry],
  env: { ...(process.env as Record<string, string>), SOCIAL_MCP_API: process.env.SOCIAL_MCP_API || "http://localhost:4300" },
  stderr: "inherit",
});
const client = new Client({ name: "social-mcp-smoke", version: "0.0.1" });

const text = (r: unknown) =>
  ((r as { content?: { type: string; text?: string }[] }).content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) failures++;
};

await client.connect(transport);
const info = client.getServerVersion();
check(!!info, `connected to ${info?.name} ${info?.version}`);
check(!!client.getInstructions()?.includes("explicit approval"), "server instructions present");

const { tools } = await client.listTools();
console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);
const required = [
  "list_brands", "get_brand", "create_brand", "analyze_brand", "update_brand_brain", "upload_asset", "list_assets",
  "run_audit", "get_latest_audit", "list_styles", "plan_content", "create_reel", "create_carousel", "create_story",
  "list_posts", "get_post", "wait_for_render", "request_change", "approve_post", "update_post", "publish_now", "delete_post",
  "get_calendar", "connect_instagram_url", "instagram_insights", "list_automations", "create_automation", "delete_automation",
  "get_comment_log", "list_html_templates", "create_html_reel", "create_reel_from_html_template", "list_voices", "search_stock", "add_stock_asset",
  "suggest_hooks", "apply_hook", "set_growth_options", "generate_alt_text", "render_cover", "preview_publish", "list_music", "set_post_music",
  "etsy_import", "etsy_list_listings", "etsy_add_listing", "etsy_create_posts",
];
const missing = required.filter((n) => !tools.some((t) => t.name === n));
check(missing.length === 0, `all required tools registered${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);

const { prompts } = await client.listPrompts();
console.log(`prompts: ${prompts.map((p) => p.name).join(", ")}`);
check(prompts.length >= 4, "prompts registered");
const { resources } = await client.listResources();
console.log(`resources: ${resources.map((r) => r.uri).join(", ")}`);
check(resources.length >= 3, "resources registered");
const guide = await client.readResource({ uri: "social-mcp://guides/reelspec" });
check(JSON.stringify(guide).includes("1.5 seconds"), "reelspec guide readable");
const hf = await client.readResource({ uri: "social-mcp://guides/hyperframes" });
check(JSON.stringify(hf).length > 200, "hyperframes guide readable");
const pr = await client.getPrompt({ name: "viral_reel_from_idea", arguments: { brand: "Test", idea: "3 packaging tips" } });
check(pr.messages.length > 0, "prompt renders");

// Approval guard must hold without contacting the API
const guard = await client.callTool({ name: "publish_now", arguments: { postId: "x", userConfirmed: false } });
check(!!guard.isError && text(guard).includes("Not published"), "publish_now refuses without userConfirmed");

const r = await client.callTool({ name: "list_brands", arguments: {} });
const out = text(r);
console.log("list_brands →\n" + out.slice(0, 1500));
if (r.isError) {
  check(out.includes("not running"), "list_brands returns clear not-running error (API down)");
} else {
  check(true, "list_brands succeeded against live API");
  const s = await client.callTool({ name: "list_styles", arguments: {} });
  console.log("list_styles →\n" + text(s).slice(0, 1500));
  check(!s.isError, "list_styles");
  for (const name of ["list_posts", "get_calendar"]) {
    const x = await client.callTool({ name, arguments: {} });
    console.log(`${name} →\n` + text(x).slice(0, 800));
    check(!x.isError, name);
  }
}

await client.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
