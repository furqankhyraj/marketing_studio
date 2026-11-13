// Long video → short clips (Opus-Clip style). Pick or upload a long lesson / process video, start a job, watch
// the stages (extract → transcribe → pick moments → render), then approve / edit / trim the resulting clip reels.
import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, Clock, FileText, Loader2, Plus, RotateCcw, Scissors, Sparkles, Trash2, Upload, Wand2, X, XCircle, Heart, Pencil } from "lucide-react";
import { api } from "../lib/api";
import { clipsApi, fmtClock, fmtEta } from "../lib/clips";
import { cx, fmtBytes, mediaUrl, relTime } from "../lib/format";
import type { ClipJob, ClipMoment, Post } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useToast } from "../state/toast";
import { NeedBrand } from "../components/media";
import { PostDrawer } from "../components/PostDrawer";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Progress, Segmented, Select, Spinner, StatusBadge, Textarea, Toggle } from "../components/ui";

const ACTIVE = ["queued", "running", "waiting"];

function StartForm({ brandId, onStarted }: { brandId: string; onStarted: (j: ClipJob) => void }) {
  const { toast, fail } = useToast();
  const videos = useApi(() => clipsApi.videos(brandId), [brandId]);
  const styles = useApi(() => api.styles(), []);
  const [mode, setMode] = useState<"library" | "upload" | "path">("library");
  const [assetId, setAssetId] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [language, setLanguage] = useState<"auto" | "en" | "ur">("auto");
  const [maxClips, setMaxClips] = useState(5);
  const [minSec, setMinSec] = useState(20);
  const [maxSec, setMaxSec] = useState(60);
  const [layout, setLayout] = useState<"auto" | "fill-blur" | "center-crop" | "split">("auto");
  const [captionStyle, setCaptionStyle] = useState("white-pill");
  const [music, setMusic] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const list = videos.data ?? [];
  const chosen = assetId || list[list.length - 1]?.id || "";

  const upload = async (f: File) => {
    if (f.size > 4 * 1024 ** 3) return toast("error", "File too large", "Maximum 4 GB. For bigger files use the local path option.");
    setUploadPct(0);
    try {
      const a = await clipsApi.upload(brandId, f, setUploadPct);
      videos.setData((l) => [...(l ?? []), a]);
      setAssetId(a.id);
      setMode("library");
      toast("success", "Video uploaded", a.originalName);
    } catch (e) {
      fail(e, "Upload failed");
    } finally {
      setUploadPct(null);
    }
  };

  const start = async () => {
    const src = mode === "path" ? { path: localPath.trim() } : { assetId: chosen };
    if (mode === "path" ? !localPath.trim() : !chosen) return toast("error", "Pick a video first");
    setBusy(true);
    try {
      const j = await clipsApi.start(brandId, {
        ...src,
        language,
        maxClips,
        targetSec: [minSec, Math.max(minSec + 5, maxSec)],
        layout,
        captionStyle: captionStyle || undefined,
        music,
        transcript: showTranscript && transcript.trim() ? transcript : undefined,
      });
      onStarted(j);
      toast("success", "Clip job started", "Transcription runs in the background; reel renders always go first.");
    } catch (e) {
      fail(e, "Could not start");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <Scissors className="size-4 text-violet-600" /> New clip job
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Segmented value={mode} onChange={setMode} options={[{ value: "library", label: "Library video" }, { value: "upload", label: "Upload" }, { value: "path", label: "Local file" }]} />
          {mode === "library" && (
            <Field label="Long video" hint={list.length ? undefined : "No videos yet: upload one or use a local file path."}>
              <Select value={chosen} onChange={(e) => setAssetId(e.target.value)} disabled={!list.length}>
                {list.length === 0 && <option value="">No videos</option>}
                {[...list].reverse().map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.originalName} · {fmtBytes(a.size)} · {relTime(a.createdAt)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {mode === "upload" && (
            <div className="rounded-2xl border border-dashed border-zinc-300 p-5 text-center dark:border-zinc-700">
              <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm,.mkv,.m4v" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              {uploadPct === null ? (
                <>
                  <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>Choose a video (up to 4 GB)</Button>
                  <p className="mt-2 text-xs text-zinc-500">Lessons of 10–60 min are fine. The file is streamed to this computer, nothing goes online.</p>
                </>
              ) : (
                <div className="space-y-2">
                  <Progress value={uploadPct} />
                  <div className="text-xs text-zinc-500">Uploading… {Math.round(uploadPct * 100)}%</div>
                </div>
              )}
            </div>
          )}
          {mode === "path" && (
            <Field label="Path on this computer" hint="Used in place, without copying (good for very large recordings).">
              <Input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="C:\Users\you\Videos\lesson-12.mp4" />
            </Field>
          )}
          <button className="flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300" onClick={() => setShowTranscript((v) => !v)}>
            <FileText className="size-3.5" /> {showTranscript ? "Hide transcript" : "I already have a transcript (SRT / VTT)"}
          </button>
          {showTranscript && <Textarea rows={5} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={"1\n00:00:01,000 --> 00:00:04,200\nWelcome back to the course…"} className="font-mono text-xs" />}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Language">
            <Select value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
              <option value="auto">Detect automatically</option>
              <option value="en">English</option>
              <option value="ur">Urdu / Urdu-English</option>
            </Select>
          </Field>
          <Field label="Clips">
            <Input type="number" min={1} max={20} value={maxClips} onChange={(e) => setMaxClips(Math.max(1, Math.min(20, Number(e.target.value) || 5)))} />
          </Field>
          <Field label="Min length (s)">
            <Input type="number" min={5} max={170} value={minSec} onChange={(e) => setMinSec(Number(e.target.value) || 20)} />
          </Field>
          <Field label="Max length (s)">
            <Input type="number" min={10} max={180} value={maxSec} onChange={(e) => setMaxSec(Number(e.target.value) || 60)} />
          </Field>
          <Field label="Layout" hint={layout === "split" ? "Top: whole frame · bottom: webcam corner (bottom-right)" : layout === "auto" ? "Blurred background for 16:9, crop for vertical" : undefined}>
            <Select value={layout} onChange={(e) => setLayout(e.target.value as typeof layout)}>
              <option value="auto">Auto</option>
              <option value="fill-blur">Fit + blurred background (screen recordings)</option>
              <option value="center-crop">Center crop (talking head)</option>
              <option value="split">Split: screen + webcam</option>
            </Select>
          </Field>
          <Field label="Captions">
            <Select value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value)}>
              <option value="">No captions</option>
              {(styles.data?.captionStyles ?? [{ id: "white-pill", name: "White Pill", description: "" }]).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <div className="col-span-2 flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/50">
            <span>Low background music <span className="text-xs text-zinc-500">(off for lessons)</span></span>
            <Toggle checked={music} onChange={setMusic} />
          </div>
          <div className="col-span-2">
            <Button variant="primary" className="w-full" loading={busy} disabled={uploadPct !== null} icon={<Sparkles className="size-4" />} onClick={start}>
              Find the best clips
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function StageIcon({ status }: { status: string }) {
  if (status === "done" || status === "skipped") return <CheckCircle2 className="size-4 text-emerald-500" />;
  if (status === "running") return <Loader2 className="size-4 animate-spin text-violet-600" />;
  if (status === "failed") return <XCircle className="size-4 text-rose-500" />;
  return <Circle className="size-4 text-zinc-300 dark:text-zinc-600" />;
}

function JobProgress({ job, onChange }: { job: ClipJob; onChange: (j: ClipJob | null) => void }) {
  const { fail } = useToast();
  const active = ACTIVE.includes(job.status);
  const act = async (fn: () => Promise<ClipJob | { ok: true }>, removed = false) => {
    try {
      const r = await fn();
      onChange(removed ? null : (r as ClipJob));
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{job.source.name}</div>
          <div className="text-xs text-zinc-500">
            {job.source.durationMs ? fmtClock(job.source.durationMs) : "…"}
            {job.language ? ` · ${job.language === "ur" ? "Urdu" : job.language === "en" ? "English" : job.language}` : ""}
            {job.model ? ` · whisper ${job.model}` : ""}
            {job.pickedBy ? ` · picked by ${job.pickedBy === "llm" ? "Claude" : "heuristics"}` : ""}
            {job.metrics?.transcribeRtf ? ` · ${job.metrics.transcribeRtf.toFixed(2)}× realtime` : ""}
          </div>
        </div>
        <Badge tone={job.status === "done" ? "green" : job.status === "failed" ? "red" : job.status === "cancelled" ? "gray" : job.status === "waiting" ? "amber" : "violet"}>
          {job.status === "waiting" ? "waiting for reel renders" : job.status}
        </Badge>
        {active && job.etaSec ? (
          <span className="flex items-center gap-1 text-xs text-zinc-500"><Clock className="size-3.5" /> ~{fmtEta(job.etaSec)} left</span>
        ) : null}
        {active && <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => act(() => clipsApi.cancel(job.id))}>Cancel</Button>}
        {(job.status === "failed" || job.status === "cancelled") && <Button size="sm" icon={<RotateCcw className="size-4" />} onClick={() => act(() => clipsApi.retry(job.id))}>Retry</Button>}
        {!active && <Button size="sm" variant="ghost" icon={<Trash2 className="size-4 text-rose-500" />} onClick={() => act(() => clipsApi.remove(job.id), true)} aria-label="Delete job" />}
      </div>
      <Progress value={job.progress} className="mt-3" />
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {job.stages.map((s) => (
          <div key={s.id} className={cx("rounded-xl border p-3", s.status === "running" ? "border-violet-300 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-950/30" : "border-zinc-200 dark:border-zinc-800")}>
            <div className="flex items-center gap-2 text-sm font-medium">
              <StageIcon status={s.status} /> {s.label}
            </div>
            {s.status === "running" && <Progress value={s.progress} className="mt-2" />}
            {s.detail && <div className="mt-1.5 line-clamp-2 text-xs text-zinc-500">{s.detail}</div>}
          </div>
        ))}
      </div>
      {job.error && <div className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{job.error}</div>}
    </Card>
  );
}

function ClipCard({ m, post, onOpen, onPost, onDeleted }: { m: ClipMoment; post?: Post; onOpen: (p: Post) => void; onPost: (p: Post) => void; onDeleted: (id: string) => void }) {
  const { toast, fail } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const video = post?.mediaUrls?.[0];
  const rendering = post ? ["rendering", "changes_requested"].includes(post.status) : m.status === "rendering" || m.status === "pending";
  const adjust = (label: string, b: Parameters<typeof clipsApi.adjust>[1]) =>
    run(label, async () => {
      if (!post) return;
      onPost(await clipsApi.adjust(post.id, b));
      toast("info", "Re-rendering clip", label);
    });
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[9/16] bg-zinc-900">
        {video && !rendering ? (
          <video src={mediaUrl(video)} poster={mediaUrl(post?.thumbnailUrl)} controls preload="none" className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-zinc-300">
            {rendering ? <Spinner className="size-6" /> : <Scissors className="size-6" />}
            <div>{rendering ? (post?.renderProgress ? `Rendering ${Math.round(post.renderProgress * 100)}%` : m.status === "pending" ? "Queued" : "Rendering…") : m.status === "failed" ? "Render failed" : "Not rendered"}</div>
          </div>
        )}
        <div className="absolute left-2 top-2 flex gap-1.5">
          {m.source !== "custom" && <span className="rounded-full bg-black/70 px-2 py-0.5 text-xs font-bold text-white">{m.score}</span>}
          <span className="rounded-full bg-black/70 px-2 py-0.5 text-xs text-white">{fmtClock(m.endMs - m.startMs)}</span>
        </div>
      </div>
      <div className="space-y-2 p-3">
        <div className="line-clamp-2 text-sm font-semibold" dir="auto">{m.title}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span>{fmtClock(m.startMs)}–{fmtClock(m.endMs)} · {m.source === "llm" ? "Claude" : m.source === "custom" ? "custom" : "heuristic"}</span>
          {post && <StatusBadge status={post.status} />}
        </div>
        {m.why && <div className="line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">{m.why}</div>}
        {(post?.error || m.error) && <div className="line-clamp-3 text-xs text-rose-600">{post?.error ?? m.error}</div>}
        {post && (
          <>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {([
                ["−5 s start", "Start 5 s earlier", { startDeltaMs: -5000 }],
                ["+5 s end", "End 5 s later", { endDeltaMs: 5000 }],
                ["Trim start", "Trim 2 s from start", { startDeltaMs: 2000 }],
                ["Trim end", "Trim 2 s from end", { endDeltaMs: -2000 }],
              ] as const).map(([label, note, body]) => (
                <button key={label} disabled={rendering || !!busy} title={note} onClick={() => adjust(note, body)}
                  className="rounded-lg border border-zinc-200 px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  {busy === note ? "…" : label}
                </button>
              ))}
            </div>
            <Button size="sm" variant="primary" className="w-full" disabled={rendering || ["approved", "posted", "publishing"].includes(post.status)} loading={busy === "approve"} icon={<Heart className="size-3.5" />}
              onClick={() => run("approve", async () => { onPost(await api.approve(post.id)); toast("success", "Approved", "Scheduled for the next best time slot"); })}>
              {["approved", "posted"].includes(post.status) ? "Approved" : "Approve"}
            </Button>
            <div className="flex gap-1.5">
              <Button size="sm" className="flex-1" icon={<Pencil className="size-3.5" />} onClick={() => onOpen(post)}>Edit</Button>
              <Button size="sm" variant="ghost" loading={busy === "delete"} icon={<Trash2 className="size-3.5 text-rose-500" />} aria-label="Delete clip"
                onClick={() => run("delete", async () => { if (!confirm("Delete this clip?")) return; await api.deletePost(post.id); onDeleted(post.id); })} />
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function TranscriptViewer({ job, onCustom }: { job: ClipJob; onCustom: (j: ClipJob) => void }) {
  const { fail, toast } = useToast();
  const t = useApi(() => clipsApi.transcript(job.id), [job.id, job.stages.find((s) => s.id === "transcribe")?.status]);
  const [sel, setSel] = useState<{ a?: number; b?: number }>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const segs = t.data?.segments ?? [];
  const range = sel.a !== undefined ? { s: segs[Math.min(sel.a, sel.b ?? sel.a)], e: segs[Math.max(sel.a, sel.b ?? sel.a)] } : undefined;
  const startMs = range?.s?.startMs;
  const endMs = range?.e?.endMs;
  const inClip = (ms: number) => job.moments.some((m) => m.status !== "deleted" && ms >= m.startMs && ms < m.endMs);
  const shown = useMemo(() => segs.map((s, i) => ({ s, i })).filter(({ s }) => !q || s.text.toLowerCase().includes(q.toLowerCase())), [segs, q]);
  if (t.loading) return null;
  if (!segs.length) return null;
  const pick = (i: number, shift: boolean) => setSel((cur) => (shift && cur.a !== undefined ? { a: cur.a, b: i } : cur.a !== undefined && cur.b === undefined && i !== cur.a ? { a: cur.a, b: i } : { a: i }));
  const make = async () => {
    if (startMs === undefined || endMs === undefined) return;
    setBusy(true);
    try {
      onCustom(await clipsApi.custom(job.id, { startMs: Math.max(0, startMs - 150), endMs: endMs + 300 }));
      setSel({});
      toast("success", "Custom clip queued");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4 text-violet-600" /> Transcript</div>
        <span className="text-xs text-zinc-500">Click a line to start, click another (or shift-click) to end, then make a clip.</span>
        <div className="flex-1" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-9 w-40" />
        <a href={`/api/clips/jobs/${job.id}/transcript?format=srt`} target="_blank" rel="noreferrer" className="text-xs font-medium text-violet-700 dark:text-violet-300">SRT</a>
      </div>
      {startMs !== undefined && endMs !== undefined && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-violet-50 p-2.5 text-sm dark:bg-violet-950/40">
          <span>Selection {fmtClock(startMs)}–{fmtClock(endMs)} ({Math.round((endMs - startMs) / 1000)} s)</span>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setSel({})}>Clear</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={endMs - startMs < 3000 || endMs - startMs > 180_000} icon={<Scissors className="size-3.5" />} onClick={make}>Make clip</Button>
        </div>
      )}
      <div className="max-h-[28rem] space-y-0.5 overflow-y-auto pr-1">
        {shown.map(({ s, i }) => {
          const selected = startMs !== undefined && endMs !== undefined && s.startMs >= startMs && s.endMs <= endMs;
          return (
            <button key={i} onClick={(e) => pick(i, e.shiftKey)} className={cx("flex w-full gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition", selected ? "bg-violet-100 dark:bg-violet-900/50" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60")}>
              <span className={cx("w-14 shrink-0 font-mono text-xs leading-5", inClip(s.startMs) ? "font-bold text-emerald-600" : "text-zinc-400")}>{fmtClock(s.startMs)}</span>
              <span dir="auto" className="flex-1">{s.text}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function ClipsInner({ brandId }: { brandId: string }) {
  const { fail } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const jobs = useApi(() => clipsApi.jobs(brandId), [brandId], { poll: (d) => (d?.some((j) => ACTIVE.includes(j.status)) ? 3000 : false) });
  const job = (jobs.data ?? []).find((j) => j.id === selectedId) ?? jobs.data?.find((j) => j.status === "running" || j.status === "waiting") ?? jobs.data?.[0];
  const posts = useApi(() => api.posts({ brandId, type: "reel" }), [brandId], {
    poll: (d) => (job && ACTIVE.includes(job.status)) || d?.some((p) => (p as Post & { clipSource?: unknown }).clipSource && ["rendering", "changes_requested"].includes(p.status)) ? 3000 : false,
  });
  const byId = useMemo(() => new Map((posts.data ?? []).map((p) => [p.id, p])), [posts.data]);
  const [open, setOpen] = useState<Post | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const setJob = (j: ClipJob | null) => {
    if (!j) {
      jobs.setData((l) => (l ?? []).filter((x) => x.id !== job?.id));
      setSelectedId(null);
      return;
    }
    jobs.setData((l) => [j, ...(l ?? []).filter((x) => x.id !== j.id)]);
    setSelectedId(j.id);
  };
  const replacePost = (p: Post) => posts.setData((l) => (l ?? []).map((x) => (x.id === p.id ? p : x)));
  const moments = (job?.moments ?? []).filter((m) => m.status !== "deleted" && (!m.postId || !posts.data || byId.has(m.postId)));

  return (
    <div className="space-y-6">
      <PageHeader icon={<Scissors className="size-5" />} title="Clips" subtitle="Turn a long lesson or process video into short reels: transcribe, find the best moments, cut, caption and reframe to 9:16." />
      <StartForm brandId={brandId} onStarted={setJob} />
      {jobs.loading ? null : !job ? (
        <EmptyState icon={<Wand2 className="size-6" />} title="No clip jobs yet">Pick a long video above. A 30-minute lesson takes a while to transcribe on this computer; you can keep working meanwhile.</EmptyState>
      ) : (
        <>
          {(jobs.data?.length ?? 0) > 1 && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
              {jobs.data!.map((j) => (
                <button key={j.id} onClick={() => setSelectedId(j.id)} className={cx("shrink-0 rounded-full border px-3 py-1 text-xs font-medium", j.id === job.id ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-200" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400")}>
                  {j.source.name.length > 28 ? j.source.name.slice(0, 26) + "…" : j.source.name} · {j.status}
                </button>
              ))}
            </div>
          )}
          <JobProgress job={job} onChange={setJob} />
          {moments.length > 0 && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="text-sm font-semibold">Clips ({moments.length})</div>
                <div className="flex-1" />
                <Button size="sm" icon={<Plus className="size-4" />} loading={moreBusy} disabled={ACTIVE.includes(job.status)}
                  onClick={async () => { setMoreBusy(true); try { setJob(await clipsApi.more(job.id, 3)); } catch (e) { fail(e); } finally { setMoreBusy(false); } }}>
                  Make more
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {[...moments].sort((a, b) => (b.score || 0) - (a.score || 0)).map((m) => (
                  <ClipCard key={m.id} m={m} post={m.postId ? byId.get(m.postId) : undefined} onOpen={setOpen} onPost={replacePost} onDeleted={(id) => { posts.setData((l) => (l ?? []).filter((x) => x.id !== id)); jobs.reload(true); }} />
                ))}
              </div>
            </div>
          )}
          <TranscriptViewer job={job} onCustom={setJob} />
        </>
      )}
      {open && <PostDrawer post={open} onClose={() => setOpen(null)} onChanged={replacePost} onDeleted={(id) => { setOpen(null); posts.setData((l) => (l ?? []).filter((x) => x.id !== id)); }} />}
    </div>
  );
}

export default function ClipsPage() {
  return <NeedBrand>{(brandId) => <ClipsInner brandId={brandId} />}</NeedBrand>;
}
