import { Link } from "react-router";
import { ArrowRight, CalendarCheck, Heart, Rocket, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, relTime } from "../lib/format";
import { useApi } from "../lib/useApi";
import { Badge, Button, Card } from "./ui";

/** Daily digest: what autopilot made today, what's waiting for approval, what's scheduled (Home + Autopilot page). */
export function AutopilotDigestCard({ brandId, compact }: { brandId?: string; compact?: boolean }) {
  const d = useApi(() => api.autopilotDigest(brandId), [brandId], { poll: () => 60_000 });
  const brands = d.data?.brands ?? [];
  if (!brands.length) return null;
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold"><Rocket className="size-4 text-violet-500" />Today's digest</div>
        {!compact && <Link to="/autopilot"><Button size="sm" variant="ghost">Autopilot <ArrowRight className="size-4" /></Button></Link>}
      </div>
      <div className={compact ? "space-y-4" : "grid gap-4 md:grid-cols-2"}>
        {brands.map((b) => (
          <div key={b.brandId} className="space-y-2.5 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
            {!compact && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{b.brandName}</span>
                <Badge tone={b.enabled ? "green" : "gray"}>Autopilot {b.enabled ? "on" : "off"}</Badge>
                {b.enabled && b.approval === "auto" && <Badge tone="amber">auto-approve</Badge>}
              </div>
            )}
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-500" />
              <div className="min-w-0">
                <div className="font-medium">Made today: {b.madeToday.length}</div>
                {b.madeToday.slice(0, 3).map((p) => <div key={p.id} className="truncate text-xs text-zinc-500">{p.title} · {p.type}</div>)}
                {b.lastRunAt && <div className="text-xs text-zinc-400">Last run {relTime(b.lastRunAt)}{b.lastResult ? ` — ${b.lastResult}` : ""}</div>}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Heart className="mt-0.5 size-4 shrink-0 text-rose-500" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">Waiting for your yes: {b.waiting.length}</div>
                {b.waiting.slice(0, 3).map((p) => <div key={p.id} className="truncate text-xs text-zinc-500">{p.title} · {p.type}</div>)}
                {b.waiting.length > 0 && <Link to="/approve" className="text-xs font-semibold text-violet-600 dark:text-violet-300">Review now →</Link>}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CalendarCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              <div className="min-w-0">
                <div className="font-medium">Scheduled: {b.scheduled.length} · next 7 days {b.scheduledNext7}{b.enabled ? `/${b.target}` : ""}</div>
                {b.scheduled.slice(0, 3).map((p) => <div key={p.id} className="truncate text-xs text-zinc-500">{fmtDateTime(p.scheduledAt)} · {p.title}</div>)}
              </div>
            </div>
            {b.upcomingOccasions.length > 0 && (
              <div className="text-xs text-zinc-500">Coming up: {b.upcomingOccasions.slice(0, 3).map((o) => `${o.name} (${o.date})`).join(", ")}</div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
