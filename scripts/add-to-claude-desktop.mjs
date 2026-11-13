// Adds Social MCP Studio to Claude Desktop's config (%APPDATA%\Claude\claude_desktop_config.json).
// Run it while Claude is FULLY quit (tray icon → Quit): the running app rewrites this file from memory
// and would drop the entry. Keeps every other setting, and saves a backup next to the file first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfgPath = path.join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json");

const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
if (fs.existsSync(cfgPath)) fs.copyFileSync(cfgPath, cfgPath.replace(/\.json$/, `.backup-${Date.now()}.json`));

cfg.mcpServers ??= {};
cfg.mcpServers["social-mcp-studio"] = {
  command: process.execPath,
  args: [path.join(root, "mcp", "node_modules", "tsx", "dist", "cli.mjs"), path.join(root, "mcp", "src", "index.ts")],
  env: { SOCIAL_MCP_API: "http://localhost:4300" },
};
fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log(`Added "social-mcp-studio" to ${cfgPath}. Start Claude Desktop again, and keep "npm start" running.`);
