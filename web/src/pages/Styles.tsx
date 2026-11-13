import { useState } from "react";
import { useNavigate } from "react-router";
import { Code2, Film, Palette, Plus, Trash2, Type, Wand2 } from "lucide-react";
import { api, type HtmlTemplate } from "../lib/api";
import { cx, hashGradient, mediaUrl } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useBrands } from "../state/brand";
import { useToast } from "../state/toast";
import { loadStyles } from "../components/PostDrawer";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Skeleton } from "../components/ui";

const CAPTION_LOOKS: Record<string, string> = {
  "white-pill": "rounded-full bg-white px-3 py-1 text-zinc-900",
  karaoke: "text-white [text-shadow:0_2px_6px_rgb(0_0_0/.6)] [&_b]:text-yellow-300",
  "bold-outline": "font-black uppercase text-white [-webkit-text-stroke:1px_black]",
  boxed: "bg-black px-2 py-1 text-white",
  minimal: "text-white/90 font-medium",
  typewriter: "font-mono text-white",
};

type SceneDraft = { id: string; durationSec: number; headline: string; subtext: string };

function TemplateDialog({ template, onClose }: { template: HtmlTemplate | null; onClose: () => void }) {
  const { brand } = useBrands();
  const { fail, toast } = useToast();
  const nav = useNavigate();
  const [scenes, setScenes] = useState<SceneDraft[]>([
    { id: "s1", durationSec: 3, headline: "", subtext: "" },
    { id: "s2", durationSec: 4, headline: "", subtext: "" },
    { id: "s3", durationSec: 4, headline: "", subtext: "" },
  ]);
  const [cta, setCta] = useState("");
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (i: number, p: Partial<SceneDraft>) => setScenes(scenes.map((s, j) => (j === i ? { ...s, ...p } : s)));

  const create = async () => {
    if (!brand || !template) return;
    const list = scenes.filter((s) => s.headline.trim()).map((s) => ({ id: s.id, durationSec: s.durationSec, headline: s.headline.trim(), subtext: s.subtext.trim() || undefined }));
    if (!list.length) return toast("error", "Add at least one scene headline");
    setBusy(true);
    try {
      await api.htmlReelFromTemplate(brand.id, { templateId: template.id, scenes: list, cta: cta.trim() ? { text: cta.trim(), keyword: keyword.trim() || undefined } : undefined });
      toast("success", "Reel created", "It's rendering now — find it in Approve.");
      onClose();
      nav("/approve");
    } catch (e) { fail(e, "Couldn't create the reel"); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={!!template}
      onClose={onClose}
      wide
      title={`Make a reel with “${template?.name ?? ""}”`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!brand} icon={<Wand2 className="size-4" />} onClick={create}>Create reel for {brand?.name ?? "brand"}</Button>
        </>
      }
    >
      {!brand && <p className="mb-3 text-sm text-rose-600">Add a brand first.</p>}
      <div className="space-y-3">
        {scenes.map((s, i) => (
          <div key={s.id} className="grid gap-2 rounded-xl border border-zinc-200 p-3 sm:grid-cols-[1fr_1fr_5rem_auto] sm:items-end dark:border-zinc-800">
            <Field label={`Scene ${i + 1} headline`}><Input value={s.headline} onChange={(e) => set(i, { headline: e.target.value })} placeholder={i === 0 ? "Stop scrolling" : ""} /></Field>
            <Field label="Subtext"><Input value={s.subtext} onChange={(e) => set(i, { subtext: e.target.value })} /></Field>
            <Field label="Secs"><Input type="number" min={1} max={15} value={s.durationSec} onChange={(e) => set(i, { durationSec: Number(e.target.value) || 3 })} /></Field>
            <Button variant="ghost" onClick={() => setScenes(scenes.filter((_, j) => j !== i))} disabled={scenes.length <= 1} aria-label="Remove scene"><Trash2 className="size-4 text-rose-500" /></Button>
          </div>
        ))}
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setScenes([...scenes, { id: `s${Date.now().toString(36)}`, durationSec: 3, headline: "", subtext: "" }])}>Add scene</Button>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="CTA end card"><Input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Comment GUIDE for the free guide" /></Field>
          <Field label="CTA keyword"><Input value={keyword} onChange={(e) => setKeyword(e.target.value.toUpperCase())} placeholder="GUIDE" /></Field>
        </div>
      </div>
    </Modal>
  );
}

export default function StylesPage() {
  const q = useApi(loadStyles, []);
  const [tpl, setTpl] = useState<HtmlTemplate | null>(null);
  const styles = q.data?.styles ?? [];
  const captions = q.data?.captionStyles ?? [];
  const templates = q.data?.htmlTemplates ?? [];

  return (
    <div>
      <PageHeader icon={<Palette className="size-5" />} title="Styles" subtitle="Looks your reels and carousels can use. Pick one per post in the Library, or tell Claude which to use." />
      {q.loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-2xl" />)}</div>
      ) : q.error ? (
        <EmptyState icon={<Palette className="size-6" />} title="Couldn't load styles" action={<Button onClick={() => q.reload()}>Retry</Button>}>
          Start the server: <code className="font-mono">npm run dev</code> in <code className="font-mono">server/</code>.
        </EmptyState>
      ) : (
        <div className="space-y-10">
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Film className="size-5 text-violet-500" />Reel styles <Badge>{styles.length}</Badge></h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {styles.map((s) => (
                <Card key={s.id} className="overflow-hidden">
                  <div className="relative aspect-[4/5]" style={{ background: hashGradient(s.id) }}>
                    {s.previewUrl ? (
                      /\.(mp4|webm)$/i.test(s.previewUrl) ? (
                        <video src={mediaUrl(s.previewUrl)} autoPlay muted loop playsInline className="absolute inset-0 size-full object-cover" />
                      ) : (
                        <img src={mediaUrl(s.previewUrl)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
                      )
                    ) : (
                      <div className="absolute inset-0 flex flex-col justify-end p-4 text-white">
                        <div className="text-2xl font-black leading-none drop-shadow">{s.name}</div>
                      </div>
                    )}
                  </div>
                  <div className="p-3.5">
                    <div className="font-semibold">{s.name}</div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{s.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.supports?.map((x) => <Badge key={x} tone="violet">{x}</Badge>)}
                      {s.tags?.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Type className="size-5 text-violet-500" />Caption styles <Badge>{captions.length}</Badge></h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {captions.map((c) => (
                <Card key={c.id} className="overflow-hidden">
                  <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900 p-3">
                    <span className={cx("text-sm font-bold", CAPTION_LOOKS[c.id] ?? "text-white")}>
                      This is <b>how</b> it looks
                    </span>
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-semibold capitalize">{c.name}</div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{c.description}</p>
                  </div>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><Code2 className="size-5 text-violet-500" />HTML templates (HyperFrames) <Badge>{templates.length}</Badge></h2>
            <p className="mb-3 text-sm text-zinc-500">Fully custom HTML + animation compositions. Fill in your scenes and we'll brand and render it.</p>
            {templates.length === 0 ? (
              <Card className="p-6 text-center text-sm text-zinc-500">No HTML templates available yet — update and restart the server to enable them.</Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((t) => (
                  <Card key={t.id} className="flex flex-col overflow-hidden">
                    <div className="relative h-28 overflow-hidden" style={{ background: hashGradient(`html-${t.id}`) }}>
                      <pre className="absolute inset-0 p-3 font-mono text-[10px] leading-relaxed text-white/60">{`<div class="scene">\n  <h1 data-anim="rise">…</h1>\n</div>\n<script>gsap.timeline()…</script>`}</pre>
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <div className="font-semibold capitalize">{t.name}</div>
                      <p className="mt-0.5 flex-1 text-sm text-zinc-500">{t.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">{t.tags?.map((x) => <Badge key={x}>{x}</Badge>)}</div>
                      <Button variant="primary" size="sm" className="mt-3 self-start" icon={<Wand2 className="size-4" />} onClick={() => setTpl(t)}>Make a reel with this</Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      <TemplateDialog key={tpl?.id ?? "none"} template={tpl} onClose={() => setTpl(null)} />
    </div>
  );
}
