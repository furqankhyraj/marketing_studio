import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Film, Pin, Play, Plus, RefreshCw, SkipForward, Trash2, X } from "lucide-react";
import type { PinStatus, PinterestBoard, PinterestPin, PinterestSettings } from "../lib/types";
import { pinterestApi, type PinPatch } from "../lib/pinterestApi";
import { fmtDateTime, mediaUrl, relTime } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useBrands } from "../state/brand";
import { useToast } from "../state/toast";
import { NeedBrand } from "../components/media";
import { Badge, Button, Card, CopyButton, Drawer, Field, FilterChip, Input, PageHeader, Skeleton, Textarea, Toggle } from "../components/ui";

const TONE: Record<PinStatus, "gray" | "blue" | "amber" | "green" | "red" | "violet"> = {
  rendering: "blue",
  ready: "amber",
  queued: "violet",
  claimed: "blue",
  published: "green",
  failed: "red",
  skipped: "gray",
};
const LABEL: Record<PinStatus, string> = {
  rendering: "Rendering",
  ready: "Waiting for your yes",
  queued: "Queued",
  claimed: "Publishing",
  published: "Published",
  failed: "Failed",
  skipped: "Skipped",
};
const FILTERS: { key: string; label: string; match: PinStatus[] }[] = [
  { key: "open", label: "Upcoming", match: ["rendering", "ready", "queued", "claimed"] },
  { key: "ready", label: "Needs approval", match: ["ready"] },
  { key: "published", label: "Published", match: ["published"] },
  { key: "problems", label: "Failed / skipped", match: ["failed", "skipped"] },
];

const PUBLISHER_PROMPT = (brandId: string) =>
  `Use the Social MCP Studio "pinterest_publisher" prompt for brand ${brandId}: claim each due pin with pinterest_claim_next, publish it on pinterest.com in Claude in Chrome, and report the URL with pinterest_mark_published. Stop when nothing is due.`;

function BoardsEditor({ value, onChange }: { value: PinterestBoard[]; onChange: (v: PinterestBoard[]) => void }) {
  return (
    <div className="space-y-2">
      {value.map((b, i) => (
        <div key={i} className="flex gap-2">
          <Input className="w-2/5" value={b.name} placeholder="Board name" onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <Input
            className="flex-1"
            value={b.keywords.join(", ")}
            placeholder="keywords, comma separated"
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) } : x)))}
          />
          <Button variant="ghost" size="sm" aria-label="Remove board" onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="size-4" /></Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => onChange([...value, { name: "", keywords: [] }])}>Add board</Button>
    </div>
  );
}

function PinEditor({ pin, onClose, onSaved }: { pin: PinterestPin | null; onClose: () => void; onSaved: (p: PinterestPin) => void }) {
  const { fail, toast } = useToast();
  const [d, setD] = useState<PinPatch>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setD(pin ? { title: pin.title, description: pin.description, link: pin.link ?? "", board: pin.board, altText: pin.altText } : {}), [pin]);
  if (!pin) return null;
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await pinterestApi.update(pin.id, d));
      toast("success", "Pin saved");
      onClose();
    } catch (e) {
      fail(e, "Couldn't save the pin");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open={!!pin} onClose={onClose} title="Edit pin" footer={<Button variant="primary" loading={busy} onClick={save}>Save</Button>}>
      <div className="space-y-4">
        {pin.thumbnailUrl || pin.mediaUrl ? (
          pin.kind === "video" && pin.mediaUrl ? (
            <video src={mediaUrl(pin.mediaUrl)} poster={mediaUrl(pin.thumbnailUrl)} controls className="mx-auto max-h-80 rounded-xl" />
          ) : (
            <img src={mediaUrl(pin.mediaUrl ?? pin.thumbnailUrl)} alt={pin.altText} className="mx-auto max-h-80 rounded-xl" />
          )
        ) : null}
        <Field label="Title" hint={`${(d.title ?? "").length}/100`}><Input maxLength={100} value={d.title ?? ""} onChange={(e) => setD({ ...d, title: e.target.value })} /></Field>
        <Field label="Description" hint={`${(d.description ?? "").length}/500 · keywords people search for, no hashtags needed`}>
          <Textarea rows={6} maxLength={500} value={d.description ?? ""} onChange={(e) => setD({ ...d, description: e.target.value })} />
        </Field>
        <Field label="Link"><Input value={d.link ?? ""} onChange={(e) => setD({ ...d, link: e.target.value })} /></Field>
        <Field label="Board"><Input value={d.board ?? ""} onChange={(e) => setD({ ...d, board: e.target.value })} /></Field>
        <Field label="Alt text"><Textarea rows={3} maxLength={500} value={d.altText ?? ""} onChange={(e) => setD({ ...d, altText: e.target.value })} /></Field>
        <p className="text-xs text-zinc-500">File for the publisher: <code className="break-all">{pin.mediaPath ?? "rendering…"}</code></p>
      </div>
    </Drawer>
  );
}

function PinCard({ pin, onChange, onEdit }: { pin: PinterestPin; onChange: () => void; onEdit: () => void }) {
  const { fail } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (k: string, fn: () => Promise<unknown>) => {
    setBusy(k);
    try {
      await fn();
      onChange();
    } catch (e) {
      fail(e, "Action failed");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="flex flex-col overflow-hidden">
      <button type="button" onClick={onEdit} className="relative block aspect-[2/3] w-full bg-zinc-100 dark:bg-zinc-900">
        {pin.thumbnailUrl || (pin.kind === "image" && pin.mediaUrl) ? (
          <img src={mediaUrl(pin.thumbnailUrl ?? pin.mediaUrl)} alt={pin.altText} className="size-full object-cover" loading="lazy" />
        ) : (
          <div className="flex size-full items-center justify-center text-zinc-400">{pin.kind === "video" ? <Film className="size-8" /> : <Pin className="size-8" />}</div>
        )}
        {pin.kind === "video" && <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">Video</span>}
      </button>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={TONE[pin.status]}>{LABEL[pin.status]}</Badge>
          <span className="truncate text-xs text-zinc-500">{pin.board}</span>
        </div>
        <div className="line-clamp-2 text-sm font-semibold">{pin.title}</div>
        <div className="text-xs text-zinc-500">
          {pin.status === "published" && pin.publishedAt ? `Published ${relTime(pin.publishedAt)}` : pin.status === "claimed" ? `Claimed by ${pin.claimedBy ?? "agent"}` : fmtDateTime(pin.scheduledAt)}
        </div>
        {pin.error && pin.status !== "published" && <div className="line-clamp-2 text-xs text-rose-600">{pin.error}</div>}
        <div className="mt-auto flex flex-wrap gap-1">
          {(pin.status === "ready" || pin.status === "failed" || pin.status === "skipped") && (
            <Button size="sm" variant="primary" icon={<Check className="size-4" />} loading={busy === "ok"} onClick={() => act("ok", () => pinterestApi.approve(pin.id))}>
              {pin.status === "ready" ? "Approve" : "Requeue"}
            </Button>
          )}
          {pin.status === "published" && pin.pinUrl && (
            <a href={pin.pinUrl} target="_blank" rel="noreferrer"><Button size="sm" icon={<ExternalLink className="size-4" />}>Open</Button></a>
          )}
          {pin.status !== "published" && pin.status !== "skipped" && pin.status !== "claimed" && (
            <Button size="sm" variant="ghost" aria-label="Skip" icon={<SkipForward className="size-4" />} loading={busy === "skip"} onClick={() => act("skip", () => pinterestApi.skip(pin.id))} />
          )}
          {pin.spec && pin.status !== "published" && (
            <Button size="sm" variant="ghost" aria-label="Re-render" icon={<RefreshCw className="size-4" />} loading={busy === "re"} onClick={() => act("re", () => pinterestApi.rerender(pin.id))} />
          )}
          <Button size="sm" variant="ghost" aria-label="Delete" icon={<Trash2 className="size-4" />} loading={busy === "del"} onClick={() => act("del", () => pinterestApi.remove(pin.id))} />
        </div>
      </div>
    </Card>
  );
}

function PinterestInner({ brandId }: { brandId: string }) {
  const { brand } = useBrands();
  const { toast, fail } = useToast();
  const status = useApi(() => pinterestApi.status(brandId), [brandId]);
  const pins = useApi(() => pinterestApi.pins(brandId), [brandId], { poll: (d) => (d?.some((p) => p.status === "rendering" || p.status === "claimed") ? 4000 : 20000) });
  const [s, setS] = useState<PinterestSettings | null>(null);
  const [filter, setFilter] = useState("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<PinterestPin | null>(null);
  useEffect(() => {
    if (status.data) setS(structuredClone(status.data.settings));
  }, [status.data]);

  const list = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const all = (pins.data ?? []).filter((p) => f.match.includes(p.status));
    return filter === "published" ? [...all].sort((a, b) => Date.parse(b.publishedAt ?? b.updatedAt) - Date.parse(a.publishedAt ?? a.updatedAt)) : all;
  }, [pins.data, filter]);

  if (!s || !status.data) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  const cur = status.data.settings;
  const dirty = JSON.stringify(s) !== JSON.stringify(cur);
  const c = status.data.counts;
  const reload = () => {
    pins.reload(true);
    status.reload(true);
  };
  const save = async (patch: Partial<PinterestSettings>, msg = "Pinterest settings saved") => {
    setBusy("save");
    try {
      status.setData(await pinterestApi.save(brandId, { ...patch, boards: (patch.boards ?? s.boards).filter((b) => b.name.trim()) }));
      toast("success", msg);
    } catch (e) {
      fail(e, "Couldn't save");
    } finally {
      setBusy(null);
    }
  };
  const run = async () => {
    setBusy("run");
    try {
      const r = await pinterestApi.run(brandId);
      toast(r.created.length ? "success" : "info", r.summary);
      reload();
    } catch (e) {
      fail(e, "Couldn't generate pins");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        icon={<Pin className="size-5" />}
        title="Pinterest"
        subtitle={`Makes Pinterest pins for ${brand?.name ?? "your brand"} from your Etsy listings and approved reels, and queues them at ${cur.pinsPerDay} a day. A publisher agent (Claude in Chrome) picks up each due pin and posts it.`}
        actions={
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{cur.enabled ? "On" : "Off"}</span>
            <Toggle checked={cur.enabled} disabled={busy !== null} onChange={(v) => save({ ...s, enabled: v }, v ? "Pinterest is on" : "Pinterest is off")} label="Pinterest on" />
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <FilterChip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)} count={(pins.data ?? []).filter((p) => f.match.includes(p.status)).length}>
                {f.label}
              </FilterChip>
            ))}
            <div className="ml-auto"><Button size="sm" icon={<Play className="size-4" />} loading={busy === "run"} onClick={run}>Make pins now</Button></div>
          </div>
          {pins.data === undefined ? (
            <Skeleton className="h-64" />
          ) : list.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {list.map((p) => <PinCard key={p.id} pin={p} onChange={reload} onEdit={() => setEditing(p)} />)}
            </div>
          ) : (
            <Card className="p-8 text-center text-sm text-zinc-500">
              No pins here yet. Press <b>Make pins now</b>: pins come from your Etsy listings (import them on the Etsy page) and from approved reels and image posts.
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="space-y-2 p-4 text-sm">
            <div className="font-semibold">Queue</div>
            <div className="grid grid-cols-2 gap-y-1">
              <span className="text-zinc-500">Due now</span><span className="text-right font-semibold">{status.data.due}</span>
              <span className="text-zinc-500">Queued</span><span className="text-right">{c.queued}</span>
              <span className="text-zinc-500">Needs approval</span><span className="text-right">{c.ready}</span>
              <span className="text-zinc-500">Published (24h)</span><span className="text-right">{status.data.publishedToday}</span>
              <span className="text-zinc-500">Failed</span><span className="text-right">{c.failed}</span>
            </div>
            {status.data.nextDueAt && <p className="text-xs text-zinc-500">Next pin due {fmtDateTime(status.data.nextDueAt)}</p>}
            {cur.lastRunAt && <p className="text-xs text-zinc-500">Last run {relTime(cur.lastRunAt)}: {cur.lastResult}</p>}
          </Card>

          <Card className="space-y-3 p-4">
            <div className="font-semibold">Publisher agent</div>
            <p className="text-sm text-zinc-500">
              Give this to a Claude session that has Social MCP Studio and Claude in Chrome. It claims each due pin, uploads it on pinterest.com and reports the link back here. You can also run it on a schedule.
            </p>
            <pre className="whitespace-pre-wrap rounded-lg bg-zinc-100 p-2 text-xs dark:bg-zinc-900">{PUBLISHER_PROMPT(brandId)}</pre>
            <CopyButton text={PUBLISHER_PROMPT(brandId)} label="Copy prompt" />
          </Card>

          <Card className="space-y-4 p-4">
            <div className="font-semibold">Settings</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pins per day"><Input type="number" min={1} max={25} value={s.pinsPerDay} onChange={(e) => setS({ ...s, pinsPerDay: Number(e.target.value) || 5 })} /></Field>
              <Field label="Days queued"><Input type="number" min={1} max={14} value={s.leadDays} onChange={(e) => setS({ ...s, leadDays: Number(e.target.value) || 3 })} /></Field>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-sm font-medium">Ask me first</div><div className="text-xs text-zinc-500">Off = pins go straight to the queue</div></div>
              <Toggle checked={s.approval === "manual"} onChange={(v) => setS({ ...s, approval: v ? "manual" : "auto" })} label="Manual approval" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-sm font-medium">From Etsy listings</div><div className="text-xs text-zinc-500">Fresh 2:3 designs, rotating</div></div>
              <Toggle checked={s.fromEtsy} onChange={(v) => setS({ ...s, fromEtsy: v })} label="From Etsy" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-sm font-medium">From approved posts</div><div className="text-xs text-zinc-500">Reels become video pins</div></div>
              <Toggle checked={s.fromPosts} onChange={(v) => setS({ ...s, fromPosts: v })} label="From posts" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-sm font-medium">Persian art design</div><div className="text-xs text-zinc-500">Carpet, tile, manuscript and arch cards</div></div>
              <Toggle checked={s.design === "persian"} onChange={(v) => setS({ ...s, design: v ? "persian" : "classic" })} label="Persian design" />
            </div>
            <Field label="Boards" hint="Exact board names. Pins go to the board whose keywords match.">
              <BoardsEditor value={s.boards} onChange={(boards) => setS({ ...s, boards })} />
            </Field>
            <Field label="Default board"><Input value={s.defaultBoard ?? ""} placeholder="e.g. Printable Party Games" onChange={(e) => setS({ ...s, defaultBoard: e.target.value || undefined })} /></Field>
            <Field label="Pinterest account"><Input value={s.account ?? ""} placeholder="e.g. mindorabyfurqan" onChange={(e) => setS({ ...s, account: e.target.value || undefined })} /></Field>
            <Field label="Chrome profile signed in to it"><Input value={s.chromeProfile ?? ""} placeholder="e.g. furqan" onChange={(e) => setS({ ...s, chromeProfile: e.target.value || undefined })} /></Field>
            <div className="flex gap-2">
              <Button variant="primary" loading={busy === "save"} disabled={!dirty} onClick={() => save(s)}>Save</Button>
              {dirty && <Button variant="ghost" onClick={() => setS(structuredClone(cur))}>Discard</Button>}
            </div>
          </Card>
        </div>
      </div>
      <PinEditor pin={editing} onClose={() => setEditing(null)} onSaved={() => reload()} />
    </div>
  );
}

export default function PinterestPage() {
  return <NeedBrand>{(id) => <PinterestInner key={id} brandId={id} />}</NeedBrand>;
}
