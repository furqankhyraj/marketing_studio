import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import { cx, fmtTime, STATUS_CHIP } from "../lib/format";
import type { Post } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useToast } from "../state/toast";
import { NeedBrand } from "../components/media";
import { PostDrawer } from "../components/PostDrawer";
import { Button, Card, PageHeader, Segmented, Spinner } from "../components/ui";

type View = "week" | "month";
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = (d: Date) => { const s = startOfDay(d); const dow = (s.getDay() + 6) % 7; s.setDate(s.getDate() - dow); return s; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

const LEGEND = [
  { label: "Posted", cls: STATUS_CHIP.posted },
  { label: "Approved", cls: STATUS_CHIP.approved },
  { label: "Waiting for your yes", cls: STATUS_CHIP.ready },
  { label: "Draft / rendering", cls: STATUS_CHIP.draft },
];

function Chip({ post, onOpen, compact }: { post: Post; onOpen: () => void; compact?: boolean }) {
  const draggable = post.status !== "posted" && post.status !== "publishing";
  return (
    <button
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData("text/post-id", post.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={onOpen}
      title={`${post.title} · ${fmtTime(post.scheduledAt)}`}
      className={cx(
        "flex w-full min-w-0 items-center gap-1.5 rounded-lg text-left font-medium shadow-sm transition hover:brightness-105",
        compact ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1.5 text-xs",
        STATUS_CHIP[post.status],
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      )}
    >
      <span className="shrink-0 tabular-nums opacity-80">{fmtTime(post.scheduledAt)}</span>
      <span className="truncate">{post.title}</span>
    </button>
  );
}

function CalendarInner({ brandId }: { brandId: string }) {
  const { fail, toast } = useToast();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [over, setOver] = useState<string | null>(null);
  const [open, setOpen] = useState<Post | null>(null);

  const { days, from, to } = useMemo(() => {
    if (view === "week") {
      const s = startOfWeek(anchor);
      const days = Array.from({ length: 7 }, (_, i) => addDays(s, i));
      return { days, from: s, to: new Date(+addDays(s, 7) - 1) };
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const s = startOfWeek(first);
    const days = Array.from({ length: 42 }, (_, i) => addDays(s, i));
    return { days, from: s, to: new Date(+addDays(s, 42) - 1) };
  }, [view, anchor]);

  const q = useApi(() => api.calendar({ brandId, from: from.toISOString(), to: to.toISOString() }), [brandId, +from, +to]);
  const posts = q.data ?? [];
  const byDay = useMemo(() => {
    const m: Record<string, Post[]> = {};
    for (const p of posts) {
      if (!p.scheduledAt) continue;
      const k = dayKey(new Date(p.scheduledAt));
      (m[k] ??= []).push(p);
    }
    for (const k in m) m[k].sort((a, b) => +new Date(a.scheduledAt!) - +new Date(b.scheduledAt!));
    return m;
  }, [posts]);

  const move = (n: number) => setAnchor((a) => (view === "week" ? addDays(a, 7 * n) : new Date(a.getFullYear(), a.getMonth() + n, 1)));
  const title = view === "week"
    ? `${days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
    : anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const replace = (p: Post) => q.setData((l) => (l ?? []).map((x) => (x.id === p.id ? p : x)));

  const drop = async (day: Date, id: string) => {
    setOver(null);
    const p = posts.find((x) => x.id === id);
    if (!p?.scheduledAt) return;
    const old = new Date(p.scheduledAt);
    if (sameDay(old, day)) return;
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), old.getHours(), old.getMinutes());
    if (+next < Date.now() - 60_000) return toast("error", "Can't move a post into the past");
    replace({ ...p, scheduledAt: next.toISOString() });
    try {
      replace(await api.updatePost(id, { scheduledAt: next.toISOString() }));
      toast("success", "Rescheduled", next.toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" }));
    } catch (e) { replace(p); fail(e, "Couldn't reschedule"); }
  };

  const today = new Date();
  const dropProps = (d: Date) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(dayKey(d)); },
    onDragLeave: () => setOver((o) => (o === dayKey(d) ? null : o)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); const id = e.dataTransfer.getData("text/post-id"); if (id) drop(d, id); },
  });

  return (
    <div>
      <PageHeader icon={<CalendarDays className="size-5" />} title="Calendar" subtitle="Drag a post to another day to reschedule it." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => move(-1)} aria-label="Previous"><ChevronLeft className="size-4" /></Button>
          <Button size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
          <Button size="sm" variant="ghost" onClick={() => move(1)} aria-label="Next"><ChevronRight className="size-4" /></Button>
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {q.loading && <Spinner className="size-4" />}
        <div className="flex-1" />
        <Segmented value={view} onChange={setView} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
      </div>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <span className={cx("size-2.5 rounded-full", l.cls)} />{l.label}
          </span>
        ))}
      </div>

      {view === "week" ? (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d) => {
            const list = byDay[dayKey(d)] ?? [];
            const isToday = sameDay(d, today);
            return (
              <Card
                key={dayKey(d)}
                {...dropProps(d)}
                className={cx("flex min-h-24 flex-col p-2 transition md:min-h-[26rem]", over === dayKey(d) && "border-violet-500 bg-violet-50 dark:bg-violet-950/30", +d < +startOfDay(today) && "opacity-70")}
              >
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
                  <span className={cx("flex size-7 items-center justify-center rounded-full text-sm font-semibold", isToday && "brand-gradient text-white")}>{d.getDate()}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {list.map((p) => <Chip key={p.id} post={p} onOpen={() => setOpen(p)} />)}
                  {list.length === 0 && <div className="hidden px-1 text-xs text-zinc-400 md:block">—</div>}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d, i) => {
              const list = byDay[dayKey(d)] ?? [];
              const inMonth = d.getMonth() === anchor.getMonth();
              return (
                <div
                  key={dayKey(d)}
                  {...dropProps(d)}
                  className={cx(
                    "min-h-20 border-zinc-200 p-1 transition sm:min-h-28 sm:p-1.5 dark:border-zinc-800",
                    i % 7 !== 6 && "border-r",
                    i < 35 && "border-b",
                    !inMonth && "bg-zinc-50/70 dark:bg-zinc-950/40",
                    over === dayKey(d) && "bg-violet-50 dark:bg-violet-950/30",
                  )}
                >
                  <div className={cx("mb-1 flex size-6 items-center justify-center rounded-full text-xs font-medium", sameDay(d, today) ? "brand-gradient text-white" : inMonth ? "" : "text-zinc-400")}>{d.getDate()}</div>
                  <div className="hidden flex-col gap-1 sm:flex">
                    {list.slice(0, 3).map((p) => <Chip key={p.id} post={p} compact onOpen={() => setOpen(p)} />)}
                    {list.length > 3 && <button onClick={() => { setView("week"); setAnchor(d); }} className="px-1 text-left text-[11px] font-medium text-violet-600">+{list.length - 3} more</button>}
                  </div>
                  <div className="flex flex-wrap gap-0.5 sm:hidden">
                    {list.map((p) => <button key={p.id} onClick={() => setOpen(p)} className={cx("size-2 rounded-full", STATUS_CHIP[p.status])} aria-label={p.title} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {!q.loading && posts.length === 0 && (
        <p className="mt-6 text-center text-sm text-zinc-500">Nothing scheduled in this {view}. Plan your week to fill it up.</p>
      )}
      <PostDrawer post={open} onClose={() => setOpen(null)} onChanged={replace} onDeleted={(id) => q.setData((l) => (l ?? []).filter((x) => x.id !== id))} />
    </div>
  );
}

export default function CalendarPage() {
  return <NeedBrand>{(id) => <CalendarInner key={id} brandId={id} />}</NeedBrand>;
}

