// Instagram growth controls for one post: hook A/B, trial reel, collaborators, original-audio name,
// branded reel cover, alt text, and a preview of what is sent to Instagram. Inserted into PostDrawer.
import { useEffect, useState } from "react";
import { Accessibility, Eye, Image as ImageIcon, Sparkles, TrendingUp, Users, Wand2 } from "lucide-react";
import { ApiError, SERVER_DOWN_MSG } from "../lib/api";
import { cx, mediaUrl } from "../lib/format";
import type { HookVariant, Post, TrialGraduation } from "../lib/types";
import { useToast } from "../state/toast";
import { isHtmlSpec } from "./media";
import { Badge, Button, Card, ChipInput, Field, Input, Select, Textarea, Toggle } from "./ui";

type GrowthInfo = {
  preview: { containers: Record<string, unknown>[]; caption: string; hashtagsInCaption: number; maxHashtags: number; notes: string[] };
};

async function call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(SERVER_DOWN_MSG, 0, true);
  }
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, !data && res.status >= 500);
  return data as T;
}

export const growthApi = {
  info: (id: string) => call<GrowthInfo>("GET", `/api/posts/${id}/growth`),
  update: (id: string, b: { trial?: { enabled: boolean; graduation: TrialGraduation } | null; collaborators?: string[]; audioName?: string | null; altText?: string[] }) =>
    call<Post>("PATCH", `/api/posts/${id}/growth`, b),
  hooks: (id: string, count = 3) => call<{ variants: HookVariant[]; post: Post }>("POST", `/api/posts/${id}/hooks`, { count }),
  applyHook: (id: string, b: { index?: number; text?: string }) => call<Post>("POST", `/api/posts/${id}/hooks/apply`, b),
  altText: (id: string) => call<Post>("POST", `/api/posts/${id}/alt-text`),
  cover: (id: string) => call<Post>("POST", `/api/posts/${id}/cover`),
};

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
      <span className="w-16 shrink-0">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className={cx("h-full rounded-full", value >= 7 ? "bg-emerald-500" : value >= 5 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${value * 10}%` }} />
      </div>
      <span className="w-4 text-right tabular-nums">{value}</span>
    </div>
  );
}

export function GrowthPanel({ post, onChanged, dirty }: { post: Post; onChanged: (p: Post) => void; dirty?: boolean }) {
  const { toast, fail } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [trial, setTrial] = useState(post.trial ?? { enabled: false, graduation: "MANUAL" as TrialGraduation });
  const [collabs, setCollabs] = useState<string[]>(post.collaborators ?? []);
  const [audioName, setAudioName] = useState<string>(post.audioName ?? "");
  const [alt, setAlt] = useState<string[]>(post.altText ?? []);
  const [preview, setPreview] = useState<GrowthInfo["preview"] | null>(null);
  const variants = post.hookVariants ?? [];
  const isReel = post.type === "reel";
  const isCarousel = post.type === "carousel" || post.type === "image"; // alt text: carousels + single images
  const locked = ["posted", "publishing"].includes(post.status);

  useEffect(() => {
    setTrial(post.trial ?? { enabled: false, graduation: "MANUAL" });
    setCollabs(post.collaborators ?? []);
    setAudioName(post.audioName ?? "");
    setAlt(post.altText ?? []);
    setPreview(null);
  }, [post.id, post.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const optsDirty =
    JSON.stringify([trial.enabled ? trial : null, collabs, audioName, alt]) !==
    JSON.stringify([post.trial?.enabled ? post.trial : null, post.collaborators ?? [], post.audioName ?? "", post.altText ?? []]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const saveOptions = () =>
    run("save", async () => {
      const p = await growthApi.update(post.id, {
        ...(isReel ? { trial: trial.enabled ? trial : null, audioName: audioName.trim() ? audioName.trim() : null } : {}),
        ...(post.type !== "story" ? { collaborators: collabs } : {}),
        ...(isCarousel ? { altText: alt } : {}),
      });
      onChanged(p);
      toast("success", "Growth options saved");
    });

  return (
    <div className="border-t border-zinc-200 pt-5 dark:border-zinc-800">
      <div className="mb-3 flex items-center gap-2">
        <TrendingUp className="size-4 text-violet-500" />
        <h3 className="font-semibold">Growth</h3>
      </div>
      <div className="space-y-4">
        {/* Hook A/B */}
        <Card className="p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4" />Hook A/B</div>
            <Button size="sm" icon={<Wand2 className="size-4" />} loading={busy === "hooks"} disabled={locked} onClick={() => run("hooks", async () => onChanged((await growthApi.hooks(post.id)).post))}>
              {variants.length ? "New variants" : "Suggest 3 hooks"}
            </Button>
          </div>
          {variants.length === 0 ? (
            <p className="text-xs text-zinc-500">Get 3 alternative hooks scored for curiosity, specificity and first-3-seconds clarity, then pick one.</p>
          ) : (
            <ul className="space-y-2">
              {variants.map((v, i) => (
                <li key={i} className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">“{v.text}”</div>
                      {v.why && <div className="mt-0.5 text-xs text-zinc-500">{v.why}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge tone={v.score >= 7 ? "green" : v.score >= 5 ? "amber" : "gray"}>{v.score}/10</Badge>
                      <Button
                        size="sm"
                        variant="primary"
                        loading={busy === `apply${i}`}
                        disabled={locked || v.text === post.hook}
                        onClick={() =>
                          (!dirty || confirm("You have unsaved edits that will be replaced by the remade post. Continue?")) &&
                          run(`apply${i}`, async () => {
                            onChanged(await growthApi.applyHook(post.id, { index: i }));
                            toast("info", "Applying hook", "The post is being revised and re-rendered.");
                          })
                        }
                      >
                        {v.text === post.hook ? "In use" : "Use"}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-1">
                    <ScoreBar label="Curiosity" value={v.scores.curiosity} />
                    <ScoreBar label="Specificity" value={v.scores.specificity} />
                    <ScoreBar label="Clarity (3s)" value={v.scores.clarity} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Reel cover */}
        {isReel && (
          <Card className="p-3.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold"><ImageIcon className="size-4" />Reel cover</div>
              <Button
                size="sm"
                loading={busy === "cover"}
                disabled={locked || isHtmlSpec(post.spec)}
                title={isHtmlSpec(post.spec) ? "HTML reels use a frame of the video as cover" : undefined}
                onClick={() => run("cover", async () => { onChanged(await growthApi.cover(post.id)); toast("success", "Cover rendered"); })}
              >
                {post.coverUrl ? "Re-render cover" : "Render cover"}
              </Button>
            </div>
            <div className="flex items-start gap-3">
              {post.coverUrl ? (
                <img src={mediaUrl(post.coverUrl)} alt="Reel cover" className="aspect-[9/16] w-20 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex aspect-[9/16] w-20 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-[10px] text-zinc-400 dark:bg-zinc-800">No cover</div>
              )}
              <p className="text-xs text-zinc-500">
                A branded title card with the hook, made automatically after each render. Sent as the Reels-tab cover when a public URL (publicBaseUrl) is set;
                otherwise Instagram uses the frame at 1s.
                {post.coverUrl && post.coverRevision !== post.revision && <span className="mt-1 block text-amber-600">Cover is from an older revision.</span>}
              </p>
            </div>
          </Card>
        )}

        {/* Options */}
        {post.type !== "story" && (
          <Card className="space-y-3 p-3.5">
            {isReel && (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Post as trial reel — shown to non-followers first</div>
                  <div className="text-xs text-zinc-500">Test a reel with new audiences before your followers see it.</div>
                </div>
                <Toggle checked={trial.enabled} disabled={locked} onChange={(v) => setTrial({ ...trial, enabled: v })} label="Trial reel" />
              </div>
            )}
            {isReel && trial.enabled && (
              <Field label="Graduation">
                <Select value={trial.graduation} onChange={(e) => setTrial({ ...trial, graduation: e.target.value as TrialGraduation })}>
                  <option value="MANUAL">Manual — I'll share it to followers in the Instagram app</option>
                  <option value="SS_PERFORMANCE">Automatic — share to followers if it performs well</option>
                </Select>
              </Field>
            )}
            <Field label={<span className="inline-flex items-center gap-1.5"><Users className="size-3.5" />Collaborators</span>} hint={`${collabs.length}/3 Instagram usernames · they get an invite to co-author the post`}>
              <ChipInput value={collabs} onChange={(v) => setCollabs(v.map((u) => u.replace(/^@+/, "").toLowerCase()).slice(0, 3))} placeholder="partner.account" />
            </Field>
            {isReel && (
              <Field label="Original audio name" hint="Shown on the reel's audio page instead of “Original audio”. Instagram allows renaming only once. Leave empty for “<Brand> original audio”.">
                <Input value={audioName} maxLength={100} disabled={locked} onChange={(e) => setAudioName(e.target.value)} placeholder="Brand original audio" />
              </Field>
            )}
            {isCarousel && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-sm font-medium"><Accessibility className="size-3.5" />Alt text</div>
                  <Button size="sm" variant="ghost" icon={<Wand2 className="size-4" />} loading={busy === "alt"} disabled={locked} onClick={() => run("alt", async () => onChanged(await growthApi.altText(post.id)))}>
                    Generate
                  </Button>
                </div>
                {alt.length === 0 ? (
                  <p className="text-xs text-zinc-500">Describes each slide for screen readers and search. If empty, a description is generated from the slide text when publishing.</p>
                ) : (
                  <div className="space-y-2">
                    {alt.map((a, i) => (
                      <Textarea key={i} value={a} maxLength={1000} className="min-h-14 text-xs" onChange={(e) => setAlt(alt.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Slide ${i + 1}`} />
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" disabled={!optsDirty || locked} loading={busy === "save"} onClick={saveOptions}>Save growth options</Button>
              {post.publishWarnings?.length ? <span className="text-xs text-amber-600">{post.publishWarnings.join(" ")}</span> : null}
            </div>
          </Card>
        )}

        {/* Preview */}
        <div>
          <Button
            size="sm"
            variant="ghost"
            icon={<Eye className="size-4" />}
            loading={busy === "preview"}
            onClick={() => (preview ? setPreview(null) : run("preview", async () => setPreview((await growthApi.info(post.id)).preview)))}
          >
            {preview ? "Hide" : "What Instagram receives"}
          </Button>
          {preview && (
            <div className="mt-2 space-y-1.5">
              <div className="text-xs text-zinc-500">
                Hashtags in caption: {preview.hashtagsInCaption}/{preview.maxHashtags}
                {preview.notes.map((n, i) => <span key={i} className="block text-amber-600">{n}</span>)}
              </div>
              <pre className="max-h-72 overflow-auto rounded-lg bg-zinc-950 p-2.5 text-[11px] leading-relaxed text-emerald-200">{JSON.stringify(preview.containers, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
