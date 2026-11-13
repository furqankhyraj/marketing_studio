import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Braces, Check, ExternalLink, MessageCircle, Plus, RefreshCw, Send, SlidersHorizontal, Trash2, Volume2 } from "lucide-react";
import { api, type StylesResponse } from "../lib/api";
import { cx, fmtDateTime, fromLocalInput, mediaUrl, relTime, toLocalInput } from "../lib/format";
import type { Asset, CarouselSlide, CarouselSpec, HtmlReelSpec, ImageSpec, MediaRef, Post, PostEvent, ReelSpec, Scene } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useToast } from "../state/toast";
import { AssetThumb, isHtmlSpec, PostPreview } from "./media";
import { GrowthPanel } from "./GrowthPanel";
import { Badge, Button, Card, ChipInput, Drawer, Field, Input, Segmented, Select, StatusBadge, Textarea } from "./ui";
import { PostChat } from "./chat/PostChat";
import { MusicPicker } from "./MusicPicker";
import { ImagePostEditor } from "./ImagePostEditor";

let stylesCache: Promise<StylesResponse> | null = null;
export function loadStyles() {
  if (!stylesCache) stylesCache = api.styles().catch((e) => { stylesCache = null; throw e; });
  return stylesCache;
}

function MediaPicker({ value, onChange, assets }: { value?: MediaRef; onChange: (m?: MediaRef) => void; assets: Asset[] }) {
  const visual = assets.filter((a) => a.kind !== "audio");
  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className={cx("flex size-14 shrink-0 items-center justify-center rounded-lg border-2 text-[10px] font-medium text-zinc-500", !value ? "border-violet-500" : "border-zinc-200 dark:border-zinc-700")}
        >
          None
        </button>
        {visual.map((a) => (
          <button
            key={a.id}
            type="button"
            title={a.originalName}
            onClick={() => onChange({ src: a.url, kind: a.kind as "image" | "video" })}
            className={cx("size-14 shrink-0 overflow-hidden rounded-lg border-2", value?.src === a.url ? "border-violet-500" : "border-transparent")}
          >
            <AssetThumb asset={a} />
          </button>
        ))}
        {value && !visual.some((a) => a.url === value.src) && (
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-violet-500 bg-zinc-100 text-[10px] dark:bg-zinc-800" title={value.src}>
            {value.kind === "image" ? <img src={mediaUrl(value.src)} alt="" className="size-full object-cover" /> : "Video"}
          </div>
        )}
      </div>
      {visual.length === 0 && <p className="text-xs text-zinc-500">Upload brand assets on the Brand Brain page to pick media here.</p>}
    </div>
  );
}

function SceneEditor({ spec, onChange, assets }: { spec: ReelSpec; onChange: (s: ReelSpec) => void; assets: Asset[] }) {
  const scenes = spec.scenes ?? [];
  const setScene = (i: number, patch: Partial<Scene>) => onChange({ ...spec, scenes: scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, d: number) => {
    const next = [...scenes];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange({ ...spec, scenes: next });
  };
  return (
    <div className="space-y-3">
      {scenes.map((s, i) => (
        <Card key={s.id ?? i} className="p-3.5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Scene {i + 1}</div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="size-4" /></Button>
              <Button size="sm" variant="ghost" disabled={i === scenes.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="size-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => onChange({ ...spec, scenes: scenes.filter((_, j) => j !== i) })} aria-label="Remove scene"><Trash2 className="size-4 text-rose-500" /></Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
            <Field label="Headline"><Input value={s.headline ?? ""} onChange={(e) => setScene(i, { headline: e.target.value })} /></Field>
            <Field label="Seconds">
              <Input type="number" min={0.5} max={30} step={0.5} value={s.durationSec ?? 3} onChange={(e) => setScene(i, { durationSec: Number(e.target.value) || 3 })} />
            </Field>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Subtext"><Input value={s.subtext ?? ""} onChange={(e) => setScene(i, { subtext: e.target.value || undefined })} /></Field>
            <Field label="Voiceover line"><Input value={s.voiceoverText ?? ""} onChange={(e) => setScene(i, { voiceoverText: e.target.value || undefined })} /></Field>
          </div>
          <Field label="Media" className="mt-3"><MediaPicker value={s.media} onChange={(m) => setScene(i, { media: m })} assets={assets} /></Field>
        </Card>
      ))}
      <Button
        size="sm"
        icon={<Plus className="size-4" />}
        onClick={() => onChange({ ...spec, scenes: [...scenes, { id: `s${Date.now().toString(36)}`, durationSec: 3, headline: "New scene" }] })}
      >
        Add scene
      </Button>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="End card CTA"><Input value={spec.cta?.text ?? ""} placeholder="Comment GROW for the guide" onChange={(e) => onChange({ ...spec, cta: e.target.value ? { ...spec.cta, text: e.target.value } : undefined })} /></Field>
        <Field label="CTA keyword" hint="Used by comment → DM automations">
          <Input value={spec.cta?.keyword ?? ""} placeholder="GROW" disabled={!spec.cta} onChange={(e) => spec.cta && onChange({ ...spec, cta: { ...spec.cta, keyword: e.target.value.toUpperCase() || undefined } })} />
        </Field>
      </div>
    </div>
  );
}

function SlideEditor({ spec, onChange, assets }: { spec: CarouselSpec; onChange: (s: CarouselSpec) => void; assets: Asset[] }) {
  const slides = spec.slides ?? [];
  const set = (i: number, p: Partial<CarouselSlide>) => onChange({ ...spec, slides: slides.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  return (
    <div className="space-y-3">
      {slides.map((s, i) => (
        <Card key={i} className="p-3.5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Slide {i + 1}</div>
            <Button size="sm" variant="ghost" disabled={slides.length <= 2} onClick={() => onChange({ ...spec, slides: slides.filter((_, j) => j !== i) })} aria-label="Remove slide">
              <Trash2 className="size-4 text-rose-500" />
            </Button>
          </div>
          <Field label="Headline"><Input value={s.headline} onChange={(e) => set(i, { headline: e.target.value })} /></Field>
          <Field label="Body" className="mt-3"><Textarea value={s.body ?? ""} onChange={(e) => set(i, { body: e.target.value || undefined })} className="min-h-16" /></Field>
          <Field label="Media" className="mt-3"><MediaPicker value={s.media} onChange={(m) => set(i, { media: m })} assets={assets} /></Field>
        </Card>
      ))}
      <Button size="sm" icon={<Plus className="size-4" />} disabled={slides.length >= 10} onClick={() => onChange({ ...spec, slides: [...slides, { headline: "New slide" }] })}>
        Add slide
      </Button>
    </div>
  );
}

function describeEvent(e: PostEvent): string {
  const d = (e.detail ?? {}) as Record<string, any>;
  switch (e.action) {
    case "status": return `Status ${d.from ?? "?"} → ${d.to ?? "?"}`;
    case "rescheduled": return `Rescheduled to ${d.to ? fmtDateTime(d.to) : "no time"}`;
    case "approved": return `Approved rev ${d.revision ?? "?"} for ${d.scheduledAt ? fmtDateTime(d.scheduledAt) : "next slot"}`;
    case "edited": return `Edited ${(d.fields ?? []).join(", ")}`;
    case "edited_after_approval": return `Edited ${(d.fields ?? []).join(", ")} after approval → back to review`;
    case "change_requested": return `Change requested: “${d.text ?? ""}”${d.wasApproved ? " (was approved)" : ""}`;
    case "publish_now": return "Publish now";
    case "deleted": return "Deleted";
    case "automation_created": return `Automation “${d.keyword}” created`;
    default: return e.action.replace(/_/g, " ");
  }
}

export function PostDrawer({ post, onClose, onChanged, onDeleted }: { post: Post | null; onClose: () => void; onChanged: (p: Post) => void; onDeleted?: (id: string) => void }) {
  const { toast, fail } = useToast();
  const [current, setCurrent] = useState<Post | null>(post);
  const [draft, setDraft] = useState<Post | null>(post);
  const [busy, setBusy] = useState<string | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "edit">("chat");
  const styles = useApi(loadStyles, []);
  // Action history: who did what to this post (dashboard, Claude via MCP, system), refreshed whenever the post changes.
  const events = useApi(() => (post ? api.postEvents(post.id) : Promise.resolve([] as PostEvent[])), [post?.id, current?.updatedAt]);
  const assets = useApi(() => (post ? api.assets(post.brandId) : Promise.resolve([])), [post?.brandId]);

  useEffect(() => {
    setCurrent(post);
    setDraft(post ? structuredClone(post) : null);
    setRaw(null);
  }, [post?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => {
    if (!draft || !current) return false;
    const pick = (p: Post) => JSON.stringify([p.title, p.hook, p.caption, p.hashtags, p.spec, p.scheduledAt ?? null]);
    return pick(draft) !== pick(current);
  }, [draft, current]);

  // Poll while rendering / remaking.
  const live = current && ["rendering", "changes_requested", "publishing"].includes(current.status);
  useEffect(() => {
    if (!live || !current) return;
    const t = setInterval(async () => {
      try {
        const p = await api.post(current.id);
        setCurrent(p);
        onChanged(p);
        if (!dirty) setDraft(structuredClone(p));
      } catch { /* ignore transient */ }
    }, 2500);
    return () => clearInterval(t);
  }, [live, current?.id, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!post || !draft || !current) return <Drawer open={false} onClose={onClose} title="">{null}</Drawer>;

  const apply = (p: Post) => {
    setCurrent(p);
    setDraft(structuredClone(p));
    onChanged(p);
  };
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const save = async () => {
    const p = await api.updatePost(current.id, {
      title: draft.title, hook: draft.hook, caption: draft.caption, hashtags: draft.hashtags, spec: draft.spec, scheduledAt: draft.scheduledAt,
    });
    apply(p);
    return p;
  };

  const spec = draft.spec;
  const html = isHtmlSpec(spec);
  const setSpec = (s: Post["spec"]) => setDraft({ ...draft, spec: s });
  const allStyles = styles.data?.styles ?? [];
  const styleOptions = draft.type === "image" ? allStyles : allStyles.filter((s) => !s.supports?.length || s.supports.includes(draft.type as "reel" | "carousel" | "story"));
  const voiceover = !html ? (spec as ReelSpec).voiceover?.src : undefined;
  const canPublish = current.status !== "posted" && current.mediaUrls?.length > 0;

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate">{current.title || "Untitled post"}</span>
          <StatusBadge status={current.status} />
        </div>
      }
      footer={
        <>
          <Button variant="primary" loading={busy === "save"} disabled={!dirty} onClick={() => run("save", async () => { await save(); toast("success", "Saved"); })}>
            Save
          </Button>
          <Button
            icon={<RefreshCw className="size-4" />}
            loading={busy === "render"}
            onClick={() => run("render", async () => { if (dirty) await save(); apply(await api.render(current.id)); toast("info", "Re-render queued"); })}
          >
            {dirty ? "Save & re-render" : "Re-render"}
          </Button>
          <Button
            variant="success"
            icon={<Check className="size-4" />}
            loading={busy === "approve"}
            disabled={current.status === "approved" || current.status === "posted"}
            onClick={() => run("approve", async () => { if (dirty) await save(); apply(await api.approve(current.id, draft.scheduledAt)); toast("success", "Approved", "It will post at its scheduled time."); })}
          >
            Approve
          </Button>
          <Button
            icon={<Send className="size-4" />}
            loading={busy === "publish"}
            disabled={!canPublish}
            title={canPublish ? "Publish to Instagram now" : "Render the post first"}
            onClick={() => confirm("Publish this post to Instagram right now?") && run("publish", async () => { apply(await api.publish(current.id)); toast("success", "Publishing to Instagram…"); })}
          >
            Publish now
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            icon={<Trash2 className="size-4 text-rose-500" />}
            loading={busy === "delete"}
            onClick={() => confirm("Delete this post? This can't be undone.") && run("delete", async () => { await api.deletePost(current.id); onDeleted?.(current.id); toast("success", "Post deleted"); onClose(); })}
          >
            Delete
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,15rem)_1fr]">
        <div className="space-y-3">
          <div className="mx-auto w-full max-w-[15rem]">
            <PostPreview post={current} controls />
          </div>
          {voiceover && (
            <Card className="p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300"><Volume2 className="size-3.5" />Voiceover</div>
              <audio src={mediaUrl(voiceover)} controls className="h-9 w-full" />
            </Card>
          )}
          <MusicPicker post={current} onChanged={(p) => { setCurrent(p); onChanged(p); if (!dirty) setDraft(structuredClone(p)); }} />
          <div className="space-y-1 text-xs text-zinc-500">
            <div>Type: <span className="font-medium capitalize text-zinc-700 dark:text-zinc-300">{current.type}</span>{html && <Badge tone="pink" className="ml-1.5">HTML engine</Badge>}</div>
            <div>Revision {current.revision} · updated {relTime(current.updatedAt)}</div>
            {current.postedAt && <div>Posted {fmtDateTime(current.postedAt)}</div>}
            {current.igPermalink && (
              <a href={current.igPermalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-violet-600 dark:text-violet-300">
                View on Instagram <ExternalLink className="size-3" />
              </a>
            )}
            {current.error && <div className="rounded-lg bg-rose-50 p-2 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{current.error}</div>}
          </div>
          {(events.data?.length ?? 0) > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300">History</div>
              <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {events.data!.map((e) => (
                  <li key={e.id} className="flex items-start gap-2 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs dark:bg-zinc-800">
                    <span className={cx("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", e.actor === "claude-mcp" ? "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200" : e.actor === "system" ? "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200")}>{e.actor}</span>
                    <span className="min-w-0 flex-1">{describeEvent(e)}</span>
                    <span className="shrink-0 text-zinc-500" title={fmtDateTime(e.at)}>{relTime(e.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {current.changeRequests?.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300">Change requests</div>
              <ul className="space-y-1.5">
                {current.changeRequests.map((c, i) => (
                  <li key={i} className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs dark:bg-zinc-800">
                    “{c.text}” <span className="text-zinc-500">· {relTime(c.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "chat", label: <span className="flex items-center gap-1.5"><MessageCircle className="size-4" />Chat</span> },
              { value: "edit", label: <span className="flex items-center gap-1.5"><SlidersHorizontal className="size-4" />Edit</span> },
            ]}
          />
          {tab === "chat" ? (
            <PostChat
              post={current}
              poll={false}
              className="h-[min(72vh,44rem)]"
              onPost={(p) => {
                setCurrent(p);
                onChanged(p);
                if (!dirty) setDraft(structuredClone(p));
              }}
            />
          ) : (
          <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title"><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
            <Field label="Scheduled for">
              <Input type="datetime-local" value={toLocalInput(draft.scheduledAt)} onChange={(e) => setDraft({ ...draft, scheduledAt: fromLocalInput(e.target.value) })} />
            </Field>
          </div>
          <Field label="Hook"><Input value={draft.hook} onChange={(e) => setDraft({ ...draft, hook: e.target.value })} /></Field>
          <Field label="Caption" right={<span className="text-xs font-normal text-zinc-400">{draft.caption.length}/2200</span>}>
            <Textarea value={draft.caption} maxLength={2200} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} className="min-h-28" />
          </Field>
          <Field label="Hashtags" hint={`${draft.hashtags.length}/5 · Instagram allows max 5 · use specific niche keywords`}>
            <ChipInput hashtag value={draft.hashtags} onChange={(h) => setDraft({ ...draft, hashtags: h.slice(0, 5) })} placeholder="handmadejewelry, etsyfinds" />
          </Field>
          <GrowthPanel post={current} onChanged={apply} dirty={dirty} />

          <div className="border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="font-semibold">{html ? "HTML composition" : draft.type === "image" ? "Design" : draft.type === "carousel" ? "Slides" : "Scenes"}</h3>
              <Button size="sm" variant="ghost" icon={<Braces className="size-4" />} onClick={() => setRaw(raw === null ? JSON.stringify(spec, null, 2) : null)}>
                {raw === null ? "Raw JSON" : "Form view"}
              </Button>
            </div>

            {raw !== null ? (
              <div className="space-y-2">
                <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} className="min-h-96 font-mono text-xs" />
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    try { setSpec(JSON.parse(raw)); setRaw(null); } catch (e) { fail(e, "Invalid JSON"); }
                  }}
                >
                  Apply JSON
                </Button>
              </div>
            ) : draft.type === "image" ? (
              <ImagePostEditor spec={spec as ImageSpec} onChange={setSpec} styles={styleOptions} assets={assets.data ?? []} MediaPicker={MediaPicker} />
            ) : html ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Duration (s)">
                    <Input type="number" min={1} max={90} value={(spec as HtmlReelSpec).durationSec} onChange={(e) => setSpec({ ...(spec as HtmlReelSpec), durationSec: Number(e.target.value) || 10 })} />
                  </Field>
                  <Field label="Size"><Input disabled value={`${spec.width}×${spec.height}`} /></Field>
                  <Field label="Template"><Input disabled value={(spec as HtmlReelSpec).template ?? "custom"} /></Field>
                </div>
                <Field label="index.html" hint="HyperFrames composition (HTML + GSAP). Save & re-render to see changes.">
                  <Textarea
                    value={(spec as HtmlReelSpec).html}
                    onChange={(e) => setSpec({ ...(spec as HtmlReelSpec), html: e.target.value })}
                    spellCheck={false}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") {
                        e.preventDefault();
                        const t = e.currentTarget;
                        const { selectionStart: a, selectionEnd: b, value } = t;
                        const v = value.slice(0, a) + "  " + value.slice(b);
                        setSpec({ ...(spec as HtmlReelSpec), html: v });
                        requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = a + 2; });
                      }
                    }}
                    className="min-h-[28rem] whitespace-pre bg-zinc-950 font-mono text-xs leading-relaxed text-emerald-200 dark:bg-black"
                  />
                </Field>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Reel style">
                    <Select value={(spec as ReelSpec).style} onChange={(e) => setSpec({ ...(spec as ReelSpec), style: e.target.value } as Post["spec"])}>
                      {!styleOptions.some((s) => s.id === (spec as ReelSpec).style) && <option value={(spec as ReelSpec).style}>{(spec as ReelSpec).style}</option>}
                      {styleOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </Field>
                  {draft.type !== "carousel" && (
                    <Field label="Caption style">
                      <Select value={(spec as ReelSpec).captionStyle ?? ""} onChange={(e) => setSpec({ ...(spec as ReelSpec), captionStyle: e.target.value || undefined })}>
                        <option value="">No captions</option>
                        {(styles.data?.captionStyles ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        {(spec as ReelSpec).captionStyle && !(styles.data?.captionStyles ?? []).some((c) => c.id === (spec as ReelSpec).captionStyle) && (
                          <option value={(spec as ReelSpec).captionStyle}>{(spec as ReelSpec).captionStyle}</option>
                        )}
                      </Select>
                    </Field>
                  )}
                </div>
                {draft.type === "carousel" ? (
                  <SlideEditor spec={spec as CarouselSpec} onChange={setSpec} assets={assets.data ?? []} />
                ) : (
                  <SceneEditor spec={spec as ReelSpec} onChange={setSpec} assets={assets.data ?? []} />
                )}
              </div>
            )}
          </div>
          </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
