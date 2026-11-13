#!/usr/bin/env node
// Social MCP Studio — MCP stdio server.
// stdout is reserved for the MCP protocol: all logging goes to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { API_BASE, log } from "./api.ts";
import { SERVER_INSTRUCTIONS } from "./guides.ts";
import { registerTools } from "./tools.ts";
import { registerPrompts } from "./prompts.ts";
import { registerResources } from "./resources.ts";
import { registerGrowthTools } from "./growthTools.ts";

// Safety net: anything that accidentally calls console.log must not corrupt the protocol stream.
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);

const server = new McpServer(
  { name: "social-mcp-studio", title: "Social MCP Studio", version: "0.1.0" },
  { instructions: SERVER_INSTRUCTIONS, capabilities: { logging: {} } },
);

registerTools(server);
registerGrowthTools(server);
(await import("./etsyTools.ts")).registerEtsyTools(server); // etsy_import, etsy_list_listings, etsy_add_listing, etsy_create_posts
(await import("./clipTools.ts")).registerClipTools(server); // clips_start_job, clips_job_status, clips_make_custom
(await import("./autopostTools.ts")).registerAutopostTools(server); // create_image_post, update_image_post, get_autopilot, set_autopilot, run_autopilot, autopilot_digest
(await import("./researchTools.ts")).registerResearchTools(server); // research_start, research_status, research_report, research_apply
(await import("./playstoreTools.ts")).registerPlayStoreTools(server); // playstore_import, playstore_get
(await import("./pinterestTools.ts")).registerPinterestTools(server); // pinterest_* (pin queue + publisher-agent loop)
registerPrompts(server);
registerResources(server);

process.on("unhandledRejection", (e) => log("unhandledRejection", e));
process.on("uncaughtException", (e) => log("uncaughtException", e));

const transport = new StdioServerTransport();
await server.connect(transport);
log(`ready (API: ${API_BASE})`);
