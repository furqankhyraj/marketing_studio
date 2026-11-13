import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, ChevronLeft, ChevronRight, Film, ImagePlus, Images, Loader2, Search, UploadCloud, Wand2 } from "lucide-react";
import { api, type StockResult } from "../lib/api";
import { cx, hashGradient, isReelType, mediaUrl } from "../lib/format";
import type { Asset, CarouselSpec, HtmlReelSpec, Post, ReelSpec } from "../lib/types";
import { useBrands } from "../state/brand";
import { useToast } from "../state/toast";
import { Button, EmptyState, Input, Modal, Progress, Segmented, Spinner } from "./ui";

export const isHtmlSpec = (s: Post["spec"]): s is HtmlReelSpec => (s as HtmlReelSpec)?.engine === "hyperframes";
export const isCarouselSpec = (p: Post): p is Post & { spec: CarouselSpec } => p.type === "carousel";

/** Fallback poster built from the spec text + brand colors. */
function SpecPoster({ post }: { post: Post }) {
  const spec = post.spec as Partial<ReelSpec & CarouselSpec>;
  const colors = spec.brand?.colors;
  const headline = isHtmlSpec(post.spec) ? post.title : (spec.scenes?.[0]?.headline ?? spec.slides?.[0]?.headline ?? (post.spec as { headline?: string }).headline ?? post.title);
  return (
    <div
      className="absolute inset-0 flex flex-col justify-end p-4 text-white"
      style={{ background: colors ? `linear-gradient(160deg, ${colors.primary}, ${colors.secondary ?? colors.accent})` : hashGradient(post.id) }}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/0 to-black/0" />
      <div className="relative">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest opacity-80">{post.type}</div>
        <div className="line-clamp-4 text-lg font-extrabold leading-tight drop-shadow">{headline}</div>
      </div>
    </div>
  );
}

/** 9:16 (reel/story) or 4:5 (carousel) preview of a post with rendering progress. */
export function PostPreview({ post, autoPlay = true, controls = false, className, rounded = "rounded-2xl", fit = "cover" }: { post: Post; autoPlay?: boolean; controls?: boolean; className?: string; rounded?: string; fit?: "cover" | "contain" }) {
  const [slide, setSlide] = useState(0);
  const carousel = post.type === "carousel" || post.type === "image"; // 4:5 stills (image = one slide)
  const urls = post.mediaUrls ?? [];
  const busy = post.status === "rendering" || post.status === "changes_requested";
  const video = !carousel && urls.find((u) => /\.(mp4|webm|mov)(\?|$)/i.test(u));
  const slides = carousel ? urls : [];
  return (
    <div className={cx("relative w-full overflow-hidden bg-zinc-900", carousel ? "aspect-[4/5]" : "aspect-[9/16]", rounded, className)}>
      {video ? (
        <video
          key={video}
          src={mediaUrl(video)}
          poster={mediaUrl(post.thumbnailUrl)}
          className="absolute inset-0 size-full object-cover"
          autoPlay={autoPlay}
          muted
          loop
          playsInline
          controls={controls}
        />
      ) : slides.length ? (
        <>
          <img src={mediaUrl(slides[slide])} alt={`Slide ${slide + 1}`} className={cx("absolute inset-0 size-full", fit === "contain" ? "object-contain" : "object-cover")} draggable={false} />
          {slides.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setSlide((s) => (s - 1 + slides.length) % slides.length); }}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white backdrop-blur hover:bg-black/60"
                aria-label="Previous slide"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setSlide((s) => (s + 1) % slides.length); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white backdrop-blur hover:bg-black/60"
                aria-label="Next slide"
              >
                <ChevronRight className="size-4" />
              </button>
              <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1">
                {slides.map((_, i) => (
                  <span key={i} className={cx("h-1.5 rounded-full transition-all", i === slide ? "w-4 bg-white" : "w-1.5 bg-white/50")} />
                ))}
              </div>
            </>
          )}
        </>
      ) : post.thumbnailUrl ? (
        <img src={mediaUrl(post.thumbnailUrl)} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
      ) : (
        <SpecPoster post={post} />
      )}

      {busy && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 p-6 text-center text-white backdrop-blur-[2px]">
          <Loader2 className="size-8 animate-spin" />
          <div className="text-sm font-semibold">{post.status === "rendering" ? (post.type === "image" ? "Designing your image…" : post.type === "carousel" ? "Rendering your slides…" : "Rendering your video…") : "Remaking with your changes…"}</div>
          {post.renderProgress !== undefined && post.status === "rendering" && (
            <div className="w-full max-w-[12rem]">
              <Progress value={post.renderProgress} />
              <div className="mt-1 text-xs opacity-80">{Math.round(post.renderProgress * 100)}%</div>
            </div>
          )}
        </div>
      )}
      {post.status === "failed" && (
        <div className="absolute inset-x-2 top-2 flex items-start gap-1.5 rounded-lg bg-rose-600/90 px-2 py-1.5 text-xs text-white">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="line-clamp-3">{post.error ?? "Render failed"}</span>
        </div>
      )}
      {post.status === "draft" && !video && !slides.length && (
        <div className="absolute right-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">Not rendered</div>
      )}
    </div>
  );
}

const ACCEPT = "image/*,video/mp4,video/quicktime,video/webm,.mov,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,.m4a";
const MB = 1024 * 1024;

/** Validate files against contract limits. Returns [ok, errors]. */
export function validateFiles(files: File[], max = 10): [File[], string[]] {
  const ok: File[] = [];
  const errs: string[] = [];
  for (const f of files) {
    const isImg = f.type.startsWith("image/");
    const isVid = /^video\/(mp4|quicktime|webm)$/.test(f.type) || /\.(mp4|mov|webm)$/i.test(f.name);
    const isAud = f.type.startsWith("audio/") || /\.(mp3|wav|m4a)$/i.test(f.name);
    if (!isImg && !isVid && !isAud) errs.push(`${f.name}: unsupported file type`);
    else if (isImg && f.size > 25 * MB) errs.push(`${f.name}: images must be 25MB or less`);
    else if (isVid && f.size > 500 * MB) errs.push(`${f.name}: videos must be 500MB or less`);
    else ok.push(f);
  }
  if (ok.length > max) {
    errs.push(`Only ${max} files at a time — kept the first ${max}`);
    ok.length = max;
  }
  return [ok, errs];
}

export function Dropzone({ onFiles, compact, disabled, children }: { onFiles: (files: File[]) => void; compact?: boolean; disabled?: boolean; children?: ReactNode }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onFiles(Array.from(e.dataTransfer.files));
      }}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      role="button"
      tabIndex={0}
      className={cx(
        "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition",
        compact ? "gap-1 px-4 py-5" : "gap-2 px-6 py-9",
        over ? "border-violet-500 bg-violet-50 dark:bg-violet-950/40" : "border-zinc-300 bg-zinc-50/60 hover:border-violet-400 hover:bg-violet-50/50 dark:border-zinc-700 dark:bg-zinc-900/40 dark:hover:bg-violet-950/20",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <div className="flex size-11 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm dark:bg-zinc-800 dark:text-violet-300">
        <UploadCloud className="size-5" />
      </div>
      <div className="text-sm font-semibold">{over ? "Drop to add" : "Drag & drop photos or videos"}</div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">or click to browse · up to 10 files · images ≤ 25MB · mp4/mov/webm ≤ 500MB</div>
      {children}
    </div>
  );
}

export function AssetThumb({ asset, className }: { asset: Asset; className?: string }) {
  const src = mediaUrl(asset.url);
  if (asset.kind === "video") return <video src={src} muted playsInline preload="metadata" className={cx("size-full object-cover", className)} />;
  if (asset.kind === "audio")
    return (
      <div className={cx("flex size-full items-center justify-center bg-zinc-100 text-xs text-zinc-500 dark:bg-zinc-800", className)}>
        Audio
      </div>
    );
  return <img src={src} alt={asset.originalName} loading="lazy" className={cx("size-full object-cover", className)} />;
}

/** "Add stock media" search dialog (Pexels / Pixabay via server). */
export function StockDialog({ open, onClose, brandId, onAdded }: { open: boolean; onClose: () => void; brandId: string; onAdded: (a: Asset) => void }) {
  const { fail, toast } = useToast();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"video" | "image">("video");
  const [results, setResults] = useState<StockResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const search = async (k = kind) => {
    if (!query.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      setResults(await api.stock(query.trim(), k));
    } catch (e) {
      setResults(null);
      const msg = e instanceof Error ? e.message : String(e);
      setErr(/not found/i.test(msg) ? "Stock search isn't available on your server yet — update server/ and restart it." : msg);
    } finally {
      setLoading(false);
    }
  };
  const pick = async (r: StockResult) => {
    setAdding(r.id);
    try {
      const a = await api.assetFromStock(brandId, r.url, r.kind);
      onAdded(a);
      toast("success", "Added to brand assets", r.credit);
    } catch (e) {
      fail(e, "Couldn't add stock media");
    } finally {
      setAdding(null);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add stock media" wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. students studying, linen fabric, coffee shop" className="pl-9" />
        </div>
        <Segmented
          value={kind}
          onChange={(k) => {
            setKind(k);
            if (results) search(k);
          }}
          options={[
            { value: "video", label: <span className="flex items-center gap-1.5"><Film className="size-4" />Video</span> },
            { value: "image", label: <span className="flex items-center gap-1.5"><Images className="size-4" />Photo</span> },
          ]}
        />
        <Button type="submit" variant="primary" loading={loading}>
          Search
        </Button>
      </form>
      <p className="mt-2 text-xs text-zinc-500">Free portrait stock from Pexels / Pixabay. Add your API keys in Settings.</p>
      <div className="mt-4">
        {err ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{err}</div>
        ) : loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : results === null ? (
          <div className="py-10 text-center text-sm text-zinc-500">Search for b-roll to use in your reels.</div>
        ) : results.length === 0 ? (
          <div className="py-10 text-center text-sm text-zinc-500">No results. Try a broader search.</div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {results.map((r) => (
              <button key={r.id} onClick={() => pick(r)} disabled={!!adding} className="group relative aspect-[9/16] overflow-hidden rounded-xl bg-zinc-100 text-left dark:bg-zinc-800">
                <img src={r.previewUrl} alt="" loading="lazy" className="size-full object-cover transition group-hover:scale-105" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 text-[10px] text-white">
                  <div className="truncate">{r.credit}</div>
                  <div className="uppercase opacity-70">{r.source}</div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center bg-violet-600/0 text-sm font-semibold text-white opacity-0 transition group-hover:bg-violet-600/40 group-hover:opacity-100">
                  {adding === r.id ? <Loader2 className="size-5 animate-spin" /> : <span className="flex items-center gap-1"><ImagePlus className="size-4" />Add</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Wraps brand-scoped pages: shows loading / no-brand / API-down states. */
export function NeedBrand({ children }: { children: (brandId: string) => ReactNode }) {
  const { brand, loading, error } = useBrands();
  if (loading) return <div className="flex justify-center py-24"><Spinner className="size-7" /></div>;
  if (!brand)
    return error ? (
      <EmptyState icon={<AlertTriangle className="size-6" />} title="Can't reach the API server">
        Start the server: <code className="font-mono">npm run dev</code> in <code className="font-mono">server/</code>. This page will load automatically once it's running.
      </EmptyState>
    ) : (
      <EmptyState icon={<Wand2 className="size-6" />} title="Add your first brand" action={<Link to="/new"><Button variant="primary">Add a brand</Button></Link>}>
        Tell us about your business and we'll build its Brand Brain, audit your account and plan your first reels.
      </EmptyState>
    );
  return <>{children(brand.id)}</>;
}

export { isReelType };
