import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get, NOT_RUNNING_MESSAGE, ApiDownError } from "./api.ts";
import { HYPERFRAMES_FALLBACK_GUIDE, REELSPEC_GUIDE } from "./guides.ts";
import type { StylesResponse } from "./specs.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const HYPERFRAMES_README = path.resolve(here, "../../hyperframes/README.md");

export function registerResources(server: McpServer) {
  server.registerResource(
    "reelspec-guide",
    "social-mcp://guides/reelspec",
    {
      title: "How to write great reels (ReelSpec guide)",
      description: "Hook in the first 1.5s, 5–7 scenes, voiceoverText on every scene, captionStyle, CTA keyword + automation, carousel and story tips.",
      mimeType: "text/markdown",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: REELSPEC_GUIDE }] }),
  );

  server.registerResource(
    "styles",
    "social-mcp://styles",
    {
      title: "Available styles",
      description: "Live list of reel/carousel/story styles, caption styles and HyperFrames HTML templates from the Studio server.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      let text: string;
      try {
        const s = await get<StylesResponse>("/styles");
        text = [
          "# Styles",
          ...s.styles.map((x) => `- \`${x.id}\` **${x.name}** — ${x.description} _(supports: ${x.supports.join(", ")})_`),
          "",
          "# Caption styles",
          ...s.captionStyles.map((c) => `- \`${c.id}\` **${c.name}** — ${c.description}`),
          ...(s.htmlTemplates?.length ? ["", "# HTML templates (HyperFrames)", ...s.htmlTemplates.map((t) => `- \`${t.id}\` **${t.name}** — ${t.description}`)] : []),
        ].join("\n");
      } catch (err) {
        text = err instanceof ApiDownError ? NOT_RUNNING_MESSAGE : `Could not load styles: ${(err as Error).message}`;
      }
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  server.registerResource(
    "hyperframes-authoring-guide",
    "social-mcp://guides/hyperframes",
    {
      title: "HyperFrames authoring guide",
      description: "How to write HTML + GSAP compositions for create_html_reel (root attributes, clip timing, paused timelines, assets, safe zones).",
      mimeType: "text/markdown",
    },
    async (uri) => {
      let text = HYPERFRAMES_FALLBACK_GUIDE;
      try {
        if (fs.existsSync(HYPERFRAMES_README)) text = fs.readFileSync(HYPERFRAMES_README, "utf8");
      } catch {
        /* fall back */
      }
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );
}
