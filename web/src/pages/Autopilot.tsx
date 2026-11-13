import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, CalendarDays, Film, GalleryHorizontalEnd, Image as ImageIcon, Minus, Play, Plus, Rocket, Smartphone, Sparkles } from "lucide-react";
import { api, type AutopilotInfo } from "../lib/api";
import { fmtDateTime, relTime } from "../lib/format";
import type { AutopilotSettings } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useBrands } from "../state/brand";
import { useToast } from "../state/toast";
import { NeedBrand } from "../components/media";
import { Badge, Button, Card, ChipInput, Field, Input, PageHeader, Skeleton, Toggle } from "../components/ui";
import { AutopilotDigestCard } from "../components/AutopilotDigestCard";

const FORMATS: { key: keyof AutopilotSettings["postsPerWeek"]; label: string; hint: string; icon: React.ReactNode }[] = [
  { key: "reel", label: "Reels", hint: "9:16 videos · best for reach", icon: <Film className="size-5" /> },
  { key: "image", label: "Image posts", hint: "Designed 4:5 graphics · renders in seconds", icon: <ImageIcon className="size-5" /> },
  { key: "carousel", label: "Carousels", hint: "Swipeable slides · best for saves", icon: <GalleryHorizontalEnd className="size-5" /> },
  { key: "story", label: "Stories", hint: "24h vertical posts", icon: <Smartphone className="size-5" /> },
];

function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Fewer ${label}`}><Minus className="size-4" /></Button>
      <div className="w-8 text-center text-xl font-bold tabular-nums">{value}</div>
      <Button size="sm" variant="ghost" onClick={() => onChange(Math.min(14, value + 1))} aria-label={`More ${label}`}><Plus className="size-4" /></Button>
    </div>
  );
}

function AutopilotInner({ brandId }: { brandId: string }) {
  const { brand } = useBrands();
  const { toast, fail } = useToast();
  const info = useApi(() => api.autopilot(brandId), [brandId]);
  const [s, setS] = useState<AutopilotSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  useEffect(() => {
    if (info.data) setS(structuredClone(info.data.settings));
  }, [info.data]);

  if (info.error && !info.data) return <Card className="p-6 text-sm text-rose-600">Couldn't load autopilot: {String((info.error as Error)?.message ?? info.error)}</Card>;
  if (!s || !info.data) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  const cur = info.data.settings;
  const dirty = JSON.stringify(s) !== JSON.stringify(cur);
  const total = Object.values(s.postsPerWeek).reduce((a, b) => a + b, 0);
  const st = info.data.status;
  const pillarsDefault = brand?.brain?.contentPillars ?? [];

  const save = async (patch: Partial<AutopilotSettings> & { acknowledgeAutoApprove?: boolean }, msg = "Autopilot saved") => {
    setBusy("save");
    try {
      const r = await api.setAutopilot(brandId, patch);
      info.setData({ ...(info.data as AutopilotInfo), ...r });
      toast("success", msg);
      info.reload();
    } catch (e) {
      fail(e, "Couldn't save autopilot");
    } finally {
      setBusy(null);
    }
  };
  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? "dry" : "run");
    try {
      const r = await api.runAutopilot(brandId, { dryRun });
      toast(r.created.length || dryRun ? "success" : "info", r.summary);
      info.reload();
    } catch (e) {
      fail(e, "Autopilot run failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        icon={<Rocket className="size-5" />}
        title="Autopilot"
        subtitle={`Keeps ${brand?.name ?? "your brand"}'s next ${s.leadDays} days filled with fresh posts at your best times — rotating formats, pillars and timely occasions.`}
        actions={
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{cur.enabled ? "On" : "Off"}</span>
            <Toggle checked={cur.enabled} disabled={busy !== null || (!cur.enabled && total === 0)} onChange={(v) => save({ ...s, enabled: v, approval: cur.approval }, v ? "Autopilot is on" : "Autopilot is off")} label="Autopilot on" />
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Posts per week</h2>
            {FORMATS.map((f) => (
              <Card key={f.key} className="flex items-center gap-4 p-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300">{f.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{f.label}</div>
                  <div className="text-xs text-zinc-500">{f.hint} · next {cur.leadDays} days: {st.scheduled[f.key] ?? 0}/{st.targets[f.key] ?? 0}</div>
                </div>
                <Stepper label={f.label} value={s.postsPerWeek[f.key]} onChange={(n) => setS({ ...s, postsPerWeek: { ...s.postsPerWeek, [f.key]: n } })} />
              </Card>
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Approval</h2>
            <Card className="space-y-3 p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="radio" name="approval" className="mt-1" checked={s.approval === "manual"} onChange={() => { setS({ ...s, approval: "manual" }); setAck(false); }} />
                <div>
                  <div className="font-medium">Ask me first <Badge tone="green" className="ml-1">Recommended</Badge></div>
                  <div className="text-sm text-zinc-500">New posts land in “Waiting for your yes”. Nothing is published until you approve it.</div>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="radio" name="approval" className="mt-1" checked={s.approval === "auto"} onChange={() => setS({ ...s, approval: "auto" })} />
                <div>
                  <div className="font-medium">Approve automatically</div>
                  <div className="text-sm text-zinc-500">Posts are approved as soon as they're rendered and publish at their time.</div>
                </div>
              </label>
              {s.approval === "auto" && cur.approval !== "auto" && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                  <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" />Posts will publish without your review</div>
                  <p className="mt-1">Autopilot writes and designs every post itself. With automatic approval they go live on Instagram at their scheduled time (when auto-publish is on in Settings) — nobody checks them first.</p>
                  <label className="mt-2 flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand — publish without asking me
                  </label>
                </div>
              )}
              {cur.approval === "auto" && (
                <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-2.5 text-sm font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                  <AlertTriangle className="size-4 shrink-0" />Automatic approval is ON — autopilot posts publish without review.
                </div>
              )}
            </Card>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Content</h2>
            <Card className="space-y-4 p-4">
              <Field label="Content pillars to rotate" hint={pillarsDefault.length ? `Empty = use the Brand Brain's: ${pillarsDefault.join(", ")}` : "Topics autopilot cycles through"}>
                <ChipInput value={s.pillars ?? []} onChange={(v) => setS({ ...s, pillars: v.length ? v : undefined })} placeholder="Add a pillar and press Enter" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Days ahead to keep filled" hint="1–21 (default 7)">
                  <Input type="number" min={1} max={21} value={s.leadDays} onChange={(e) => setS({ ...s, leadDays: Math.max(1, Math.min(21, Number(e.target.value) || 7)) })} />
                </Field>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Occasions</div>
                      <div className="text-xs text-zinc-500">Eid, Black Friday, Mother's Day…</div>
                    </div>
                    <Toggle checked={s.occasions !== false} onChange={(v) => setS({ ...s, occasions: v })} label="Occasions" />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Render right away</div>
                      <div className="text-xs text-zinc-500">One at a time, in the background</div>
                    </div>
                    <Toggle checked={s.render !== false} onChange={(v) => setS({ ...s, render: v })} label="Render" />
                  </div>
                </div>
              </div>
            </Card>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              loading={busy === "save"}
              disabled={!dirty || (s.approval === "auto" && cur.approval !== "auto" && !ack)}
              onClick={() => save({ ...s, ...(s.approval === "auto" && cur.approval !== "auto" ? { acknowledgeAutoApprove: ack } : {}) })}
            >
              Save
            </Button>
            {dirty && <Button variant="ghost" onClick={() => { setS(structuredClone(cur)); setAck(false); }}>Discard</Button>}
          </div>
        </div>

        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-violet-500" />Next run</div>
            {info.data.preview.length ? (
              <ul className="space-y-1.5 text-sm">
                {info.data.preview.slice(0, 10).map((x, i) => (
                  <li key={i} className="flex items-start justify-between gap-2">
                    <span className="capitalize">{x.type}{x.occasion ? <span className="text-violet-600 dark:text-violet-300"> · {x.occasion.name}</span> : x.pillar ? <span className="text-zinc-500"> · {x.pillar}</span> : null}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{fmtDateTime(x.slot)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">The next {cur.leadDays} days already meet your weekly target.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Play className="size-4" />} loading={busy === "run"} disabled={!cur.enabled || !info.data.preview.length} onClick={() => run(false)}>Run now</Button>
              <Link to="/calendar"><Button size="sm" variant="ghost" icon={<CalendarDays className="size-4" />}>Calendar</Button></Link>
            </div>
            {cur.lastRunAt && <p className="text-xs text-zinc-500">Last run {relTime(cur.lastRunAt)}: {cur.lastResult}</p>}
            {!cur.enabled && <p className="text-xs text-zinc-500">Turn autopilot on to let it fill the schedule every 10 minutes.</p>}
          </Card>
          {st.occasions.length > 0 && (
            <Card className="p-4">
              <div className="mb-2 font-semibold">Occasions in the next {cur.leadDays} days</div>
              <ul className="space-y-1 text-sm">{st.occasions.map((o) => <li key={o.id}>{o.name} <span className="text-xs text-zinc-500">· {o.date}{o.approx ? " (approx.)" : ""}</span></li>)}</ul>
            </Card>
          )}
          <AutopilotDigestCard brandId={brandId} compact />
        </div>
      </div>
    </div>
  );
}

export default function AutopilotPage() {
  return <NeedBrand>{(id) => <AutopilotInner key={id} brandId={id} />}</NeedBrand>;
}
