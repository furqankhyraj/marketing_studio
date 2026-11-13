// Prints ready-to-paste MCP client config with resolved absolute paths.
// Usage: npx tsx scripts/print-config.ts   (or: npm run config)
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const mcpDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(mcpDir, "src", "index.ts");
const tsxCli = path.join(mcpDir, "node_modules", "tsx", "dist", "cli.mjs");
const node = process.execPath;
const api = process.env.SOCIAL_MCP_API || "http://localhost:4300";

if (!fs.existsSync(tsxCli)) {
  console.error(`tsx not found at ${tsxCli} — run "npm install" in ${mcpDir} first.`);
  process.exitCode = 1;
}

const serverEntry = { command: node, args: [tsxCli, entry], env: { SOCIAL_MCP_API: api } };
const desktop = { mcpServers: { "social-mcp-studio": serverEntry } };

const configPath =
  process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");

const q = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

console.log(`# Claude Desktop — merge into ${configPath}`);
console.log(`# (If you installed Claude Desktop from the Microsoft Store, the file may live under`);
console.log(String.raw`#  %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\ instead. Settings -> Developer -> Edit Config opens the right one.)`);
console.log(JSON.stringify(desktop, null, 2));
console.log("");
console.log("# Claude Code (user scope):");
console.log(`claude mcp add social-mcp-studio --scope user -e SOCIAL_MCP_API=${api} -- ${q(node)} ${q(tsxCli)} ${q(entry)}`);
console.log("");
console.log("# Cursor — .cursor/mcp.json or ~/.cursor/mcp.json:");
console.log(JSON.stringify({ mcpServers: { "social-mcp-studio": serverEntry } }, null, 2));
