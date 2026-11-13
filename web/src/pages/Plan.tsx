import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, CalendarDays, Clock, Film, GalleryHorizontalEnd, Image as ImageIcon, Minus, Plus, Smartphone, Wand2 } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, fromLocalInput } from "../lib/format";
import type { Post } from "../lib/types";
import { useBrands } from "../state/brand";
import { useToast } from "../state/toast";
import { NeedBrand, PostPreview } from "../components/media";
import { Button, Card, Field, Input, PageHeader, StatusBadge, Toggle } from "../components/ui";

function Counter({ icon, label, hint, value, onChange }: { icon: React.ReactNode; label: string; hint: string; value: number; onChange: (n: number) => void }) {
  return (
    <Card className="flex items-center gap-4 p-4">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{label}</div>
        <div className="text-xs text-zinc-500">{hint}</div>
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Fewer ${label}`}><Minus className="size-4" /></Button>
        <div className="w-8 text-center text-xl font-bold tabular-nums">{value}</div>
        <Button size="sm" variant="ghost" onClick={() => onChange(Math.min(14, value + 1))} aria-label={`More ${label}`}><Plus className="size-4" /></Button>
      </div>
    </Card>
  );
}

function PlanInner({ brandId }: { brandId: string }) {
  const { brand } = useBrands();
  const { fail, toast } = useToast();
  const [reels, setReels] = useState(3);
  const [carousels, setCarousels] = useState(0);
  const [stories, setStories] = useState(0);
  const [images, setImages] = useState(0);
  const [start, setStart] = useState("");
  const [render, setRender] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Post[] | null>(null);
  const total = reels + carousels + stories + images;

  const go = async () => {
    setLoading(true);
    try {
      const posts = await api.plan(brandId, { reels, carousels, stories, images, startDate: start ? fromLocalInput(`${start}T00:00`) : undefined, render });
      setResult(posts);
      toast("success", `Planned ${posts.length} post${posts.length === 1 ? "" : "s"}`, render ? "Rendering has started." : undefined);
    } catch (e) { fail(e, "Couldn't plan your week"); } finally { setLoading(false); }
  };

  return (
    <div>
      <PageHeader icon={<Wand2 className="size-5" />} title="Plan my week" subtitle={`Pick how much to post — we'll write, design and schedule it at ${brand?.name ?? "your brand"}'s best times.`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <Counter icon={<Film className="size-5" />} label="Reels" hint="9:16 videos · best for reach" value={reels} onChange={setReels} />
          <Counter icon={<GalleryHorizontalEnd className="size-5" />} label="Carousels" hint="Swipeable slides · best for saves" value={carousels} onChange={setCarousels} />
          <Counter icon={<ImageIcon className="size-5" />} label="Image posts" hint="Designed 4:5 graphics · tips, quotes, polls" value={images} onChange={setImages} />
          <Counter icon={<Smartphone className="size-5" />} label="Stories" hint="24h vertical posts" value={stories} onChange={setStories} />
        </div>
        <Card className="space-y-4 p-5">
          <Field label="Start date" hint="Leave empty to start today">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Render right away</div>
              <div className="text-xs text-zinc-500">Make the videos now so they're ready to approve</div>
            </div>
            <Toggle checked={render} onChange={setRender} label="Render right away" />
          </div>
          {brand?.brain?.bestTimes?.length ? (
            <div className="rounded-xl bg-zinc-50 p-3 text-xs dark:bg-zinc-800/60">
              <div className="mb-1.5 flex items-center gap-1.5 font-semibold"><Clock className="size-3.5" />Best times</div>
              <div className="flex flex-wrap gap-1.5">{brand.brain.bestTimes.map((t) => <span key={t} className="rounded-md bg-white px-1.5 py-0.5 dark:bg-zinc-900">{t}</span>)}</div>
            </div>
          ) : null}
          <Button variant="primary" size="lg" className="w-full" disabled={total === 0} loading={loading} icon={<Wand2 className="size-4" />} onClick={go}>
            Plan {total} post{total === 1 ? "" : "s"}
          </Button>
        </Card>
      </div>

      {result && (
        <div className="mt-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Your week</h2>
            <div className="flex gap-2">
              <Link to="/calendar"><Button size="sm" icon={<CalendarDays className="size-4" />}>Calendar</Button></Link>
              <Link to="/approve"><Button size="sm" variant="primary">Go approve <ArrowRight className="size-4" /></Button></Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {result.map((p) => (
              <div key={p.id}>
                <PostPreview post={p} />
                <div className="mt-2 space-y-1">
                  <div className="line-clamp-2 text-sm font-medium">{p.title}</div>
                  <div className="text-xs text-zinc-500">{fmtDateTime(p.scheduledAt)}</div>
                  <StatusBadge status={p.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlanPage() {
  return <NeedBrand>{(id) => <PlanInner key={id} brandId={id} />}</NeedBrand>;
}
