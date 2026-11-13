import { Bot, FileJson, MessageSquareQuote, Plug, RotateCcw, Settings2 } from "lucide-react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useBrands } from "../state/brand";
import { Card, CopyButton, PageHeader, Skeleton } from "../components/ui";

export default function UseInClaude() {
  const q = useApi(() => api.mcpConfig(), []);
  const { brands } = useBrands();
  const json = q.data ? JSON.stringify(q.data.claudeDesktopConfigSnippet, null, 2) : "";
  const a = brands.find((x) => /saqqa/i.test(x.name))?.name ?? brands[0]?.name ?? "Saqqa Academy";
  const b = brands.find((x) => x.name !== a)?.name ?? "my Etsy shop";
  const prompts = [
    `Plan 3 reels for ${a} this week using the cinematic style`,
    `Audit ${b} and make the first 3 reels from the audit`,
    `Show me what's waiting for approval for ${a} and approve the best two`,
    `Write a carousel for ${b}: "5 ways to style linen at home", then render it`,
    `Create a comment automation for ${a}: keyword GUIDE replies and DMs our free guide link`,
    `Move all of ${a}'s posts next week to 6pm and make the hooks punchier`,
  ];
  const steps = [
    { icon: <Settings2 className="size-4" />, title: "Open Claude Desktop settings", text: "Claude Desktop → Settings → Developer → Edit config." },
    { icon: <FileJson className="size-4" />, title: "Paste the config", text: "Merge the JSON below into claude_desktop_config.json (keep any other servers under mcpServers)." },
    { icon: <RotateCcw className="size-4" />, title: "Restart Claude Desktop", text: "Fully quit and reopen it. You'll see the Social MCP Studio tools in the tools menu." },
    { icon: <Plug className="size-4" />, title: "Keep this app running", text: "The MCP server talks to the local API on port 4300 — start it with npm run dev." },
  ];

  return (
    <div>
      <PageHeader icon={<Bot className="size-5" />} title="Use in Claude" subtitle="Drive Social MCP Studio from Claude Desktop — plan, write, edit and approve posts by chatting." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="font-semibold">What is MCP?</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              The Model Context Protocol lets Claude use local tools. This app ships an MCP server that gives Claude tools to read your Brand Brain, run audits, plan your week, write full reel scripts, render videos, edit captions, reschedule and approve posts — all on your own computer. No Anthropic API key needed in this app when Claude does the writing.
            </p>
          </Card>
          <Card className="p-6">
            <h2 className="mb-4 font-semibold">Set it up</h2>
            <ol className="space-y-4">
              {steps.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <div className="brand-gradient flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white">{i + 1}</div>
                  <div>
                    <div className="flex items-center gap-1.5 font-medium">{s.icon}{s.title}</div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">{s.text}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <div className="min-w-0">
                <div className="font-semibold">claude_desktop_config.json</div>
                {q.data?.configPath && <div className="truncate font-mono text-xs text-zinc-500" title={q.data.configPath}>{q.data.configPath}</div>}
              </div>
              {json && <CopyButton text={json} />}
            </div>
            {q.loading ? (
              <div className="p-5"><Skeleton className="h-40" /></div>
            ) : q.error ? (
              <div className="p-5 text-sm text-zinc-500">
                Couldn't load the config. Start the server: <code className="font-mono">npm run dev</code> in <code className="font-mono">server/</code>, or run <code className="font-mono">npm run mcp:config</code> in the project root.
              </div>
            ) : (
              <pre className="max-h-96 overflow-auto bg-zinc-950 p-5 font-mono text-xs leading-relaxed text-emerald-200">{json}</pre>
            )}
          </Card>
          <Card className="p-6">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><MessageSquareQuote className="size-4 text-violet-500" />Try asking Claude</h2>
            <ul className="space-y-2">
              {prompts.map((p) => (
                <li key={p} className="flex items-center gap-2 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-800/60">
                  <span className="flex-1">“{p}”</span>
                  <CopyButton text={p} label="" />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
