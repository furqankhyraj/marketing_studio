import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Download, Film, ImagePlus, Images, Link2, Plus, RefreshCw, Smartphone, Star, Store, Trash2, Wand2 } from "lucide-react";
import { api } from "../lib/api";
import { etsyApi } from "../lib/etsyApi";
import { cx, mediaUrl } from "../lib/format";
import type { EtsyListing, EtsyStatus, Post, PostType } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useToast } from "../state/toast";
import { Dropzone, NeedBrand, validateFiles } from "../components/media";
import { PostDrawer } from "../components/PostDrawer";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Progress, Skeleton, StatusBadge, Textarea, Toggle } from "../components/ui";

const money = (l: EtsyListing) => {
  if (l.price === undefined) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: l.currency || "USD" }).format(l.price);
  } catch {
    return `${l.price} ${l.currency ?? ""}`;
  }
};
const MODE_LABEL: Record<EtsyStatus["mode"], string> = { api: "Etsy API", rss: "RSS feed (no key)", manual: "Manual" };

function ShopCard({ brandId, status, onChanged }: { brandId: string; status: EtsyStatus; onChanged: () => void }) {
  const { toast, fail } = useToast();
  const [shop, setShop] = useState(status.shop ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setShop(status.shop ?? ""), [status.shop]);
  const job = status.job;
  const running = !!job?.running;

  const runImport = async () => {
    setBusy(true);
    try {
      await etsyApi.startImport(brandId, shop.trim() && shop.trim() !== status.shop ? { shop: shop.trim() } : {});
      onChanged();
    } catch (e) {
      fail(e, "Couldn't start the import");
    } finally {
      setBusy(false);
    }
  };
  const f = status.facts;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <Field label="Your Etsy shop" hint="Shop name or link, e.g. https://www.etsy.com/shop/YourShop" className="flex-1">
          <Input value={shop} onChange={(e) => setShop(e.target.value)} placeholder="YourShopName" onKeyDown={(e) => e.key === "Enter" && runImport()} />
        </Field>
        <Button variant="primary" icon={<Download className="size-4" />} loading={busy || running} disabled={!shop.trim()} onClick={runImport}>
          {status.listingCount ? "Re-import listings" : "Import listings"}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <Badge tone={status.keySet ? "green" : "amber"}>{MODE_LABEL[status.mode]}</Badge>
        {!status.keySet && (
          <span>
            Without a key only the 10 newest listings (first photo) are read. <Link to="/settings" className="font-medium text-violet-600 underline">Add an Etsy API key</Link>
          </span>
        )}
        {status.lastImport && <span>Last import {new Date(status.lastImport.at).toLocaleString()}</span>}
      </div>
      {running && job && (
        <div className="mt-4">
          <div className="mb-1 text-sm">{job.step}</div>
          <Progress value={job.progress} />
        </div>
      )}
      {job && !job.running && job.error && <p className="mt-3 text-sm text-rose-600">Import failed: {job.error}</p>}
      {job?.summary && !job.running && (
        <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
          Imported {job.summary.imported} new, {job.summary.updated} updated · {job.summary.images} photos · {job.summary.reviews} reviews.
          {job.summary.warnings.map((w) => <span key={w} className="block text-amber-700 dark:text-amber-400">{w}</span>)}
        </p>
      )}
      {f && (f.priceMin !== undefined || f.topReviews.length > 0) && (
        <div className="mt-4 grid gap-3 border-t border-zinc-200 pt-4 text-sm sm:grid-cols-3 dark:border-zinc-800">
          <div>
            <div className="text-xs text-zinc-500">Price range</div>
            <div className="font-semibold">{f.priceMin !== undefined ? `${f.priceMin}–${f.priceMax} ${f.currency ?? ""}` : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Reviews</div>
            <div className="font-semibold">{f.shop.reviewCount ? `${f.shop.reviewAverage?.toFixed(1)}★ · ${f.shop.reviewCount}` : "none yet"}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Added to your Brand Brain</div>
            <div className="truncate">{f.tagKeywords.slice(0, 5).map((k) => "#" + k).join(" ") || "—"}</div>
          </div>
          {f.topReviews[0] && <blockquote className="sm:col-span-3 italic text-zinc-600 dark:text-zinc-400">“{f.topReviews[0]}”</blockquote>}
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={async () => { try { await etsyApi.feedBrain(brandId); toast("success", "Brand Brain updated from your shop"); } catch (e) { fail(e); } }}>
          Update Brand Brain from shop
        </Button>
      </div>
    </Card>
  );
}

function ManualDialog({ brandId, open, onClose, onSaved }: { brandId: string; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast, fail } = useToast();
  const [f, setF] = useState({ url: "", title: "", price: "", currency: "USD", description: "", tags: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const assets = files.length ? await api.uploadAssets(brandId, files) : [];
      await etsyApi.addListing(brandId, { ...f, assetIds: assets.filter((a) => a.kind === "image").map((a) => a.id) });
      toast("success", "Listing added");
      setF({ url: "", title: "", price: "", currency: "USD", description: "", tags: "" });
      setFiles([]);
      onSaved();
      onClose();
    } catch (e) {
      fail(e, "Couldn't add the listing");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a listing by hand"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.url.trim() || !f.title.trim()} onClick={save}>Add listing</Button></>}
    >
      <div className="space-y-4">
        <Field label="Listing link"><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://www.etsy.com/listing/1234567890/…" inputMode="url" /></Field>
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Beaded daisy bracelet" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price"><Input value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="24.00" inputMode="decimal" /></Field>
          <Field label="Currency"><Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase().slice(0, 3) })} /></Field>
        </div>
        <Field label="Description" hint="Paste the listing description — bullet points become on-screen benefits."><Textarea rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Tags" hint="Comma separated (they become hashtags)"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="beaded bracelet, boho jewelry" /></Field>
        <Dropzone compact onFiles={(fs) => { const [ok, errs] = validateFiles(fs); errs.forEach((m) => toast("error", m)); setFiles((cur) => [...cur, ...ok.filter((x) => x.type.startsWith("image"))].slice(0, 10)); }}>
          {files.length > 0 && <div className="text-xs font-medium text-violet-700">{files.length} photo(s) ready</div>}
        </Dropzone>
      </div>
    </Modal>
  );
}

function ListingCard({ brandId, l, onMade, onOpenPost, onDelete }: { brandId: string; l: EtsyListing; onMade: () => void; onOpenPost: (id: string) => void; onDelete: () => void }) {
  const { toast, fail } = useToast();
  const [busy, setBusy] = useState<PostType | null>(null);
  const [dm, setDm] = useState(true);
  const thumb = l.imageAssetUrls?.[0] ?? l.imageUrls[0];
  const make = async (type: PostType) => {
    setBusy(type);
    try {
      const r = await etsyApi.createPosts(brandId, l.listingId, { types: [type], automation: dm && type !== "story" });
      toast("success", `${type[0].toUpperCase() + type.slice(1)} queued`, r.automations.length ? `Comment ${r.automations[0].keyword} → DM with the listing link is on.` : undefined);
      onMade();
    } catch (e) {
      fail(e, `Couldn't make the ${type}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative aspect-square bg-zinc-100 dark:bg-zinc-800">
        {thumb ? <img src={mediaUrl(thumb)} alt={l.title} className="size-full object-cover" loading="lazy" /> : <div className="flex size-full items-center justify-center text-zinc-400"><Images className="size-8" /></div>}
        {(l.imageAssetUrls?.length ?? 0) > 1 && <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">{l.imageAssetUrls!.length} photos</span>}
        <span className="absolute left-2 top-2"><Badge tone={l.source === "api" ? "green" : l.source === "rss" ? "sky" : "gray"}>{l.source}</Badge></span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="line-clamp-2 text-sm font-medium" title={l.title}>{l.title}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{money(l)}</span>
          {l.favorers !== undefined && <span>♥ {l.favorers}</span>}
          {l.reviews.length > 0 && <span className="inline-flex items-center gap-0.5"><Star className="size-3" /> {l.reviews.length}</span>}
          <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-violet-600"><Link2 className="size-3" /> Etsy</a>
        </div>
        {!!l.posts?.length && (
          <div className="flex flex-wrap gap-1.5">
            {l.posts.map((p) => (
              <button key={p.id} onClick={() => onOpenPost(p.id)} className="flex items-center gap-1 rounded-lg border border-zinc-200 px-1.5 py-0.5 text-[11px] capitalize hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                {p.type} <StatusBadge status={p.status} />
              </button>
            ))}
          </div>
        )}
        <div className="mt-auto grid grid-cols-3 gap-1.5 pt-1">
          <Button size="sm" variant="primary" icon={<Film className="size-3.5" />} loading={busy === "reel"} disabled={!!busy} onClick={() => make("reel")}>Reel</Button>
          <Button size="sm" icon={<Images className="size-3.5" />} loading={busy === "carousel"} disabled={!!busy} onClick={() => make("carousel")}>Carousel</Button>
          <Button size="sm" icon={<Smartphone className="size-3.5" />} loading={busy === "story"} disabled={!!busy} onClick={() => make("story")}>Story</Button>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
          <label className="flex items-center gap-2"><Toggle checked={dm} onChange={setDm} label="DM the link" /> Comment LINK → DM link</label>
          <button onClick={onDelete} className="rounded p-1 hover:text-rose-600" aria-label="Remove listing"><Trash2 className="size-3.5" /></button>
        </div>
      </div>
    </Card>
  );
}

function EtsyInner({ brandId }: { brandId: string }) {
  const { toast, fail } = useToast();
  const status = useApi(() => etsyApi.status(brandId), [brandId], { poll: (d) => (d?.job?.running ? 1500 : false) });
  const listings = useApi(() => etsyApi.listings(brandId), [brandId], {
    poll: (d) => (d?.some((l) => l.posts?.some((p) => ["rendering", "changes_requested"].includes(p.status))) ? 4000 : false),
  });
  const [manual, setManual] = useState(false);
  const [open, setOpen] = useState<Post | null>(null);
  const [planning, setPlanning] = useState(false);
  const wasRunning = status.data?.job?.running;
  useEffect(() => {
    if (wasRunning === false) listings.reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasRunning]);

  const plan = async () => {
    setPlanning(true);
    try {
      const r = await etsyApi.plan(brandId, { count: 3, types: ["reel"], automation: true });
      toast("success", `Planned ${r.posts.length} reels from your best listings`, "Comment LINK → DM automations are on. Find them on the Approve screen when rendered.");
      listings.reload(true);
    } catch (e) {
      fail(e, "Couldn't plan from the shop");
    } finally {
      setPlanning(false);
    }
  };
  const items = listings.data ?? [];
  return (
    <div>
      <PageHeader
        icon={<Store className="size-5" />}
        title="Etsy shop"
        subtitle="Import your listings and turn each product into a reel, carousel or story in one click."
        actions={
          <>
            <Button icon={<Plus className="size-4" />} onClick={() => setManual(true)}>Add listing</Button>
            <Button variant="primary" icon={<Wand2 className="size-4" />} loading={planning} disabled={!items.length} onClick={plan}>Plan 3 reels from shop</Button>
          </>
        }
      />
      {status.loading && !status.data ? <Skeleton className="h-40" /> : status.data ? <ShopCard brandId={brandId} status={status.data} onChanged={() => status.reload(true)} /> : null}

      <div className="mt-6">
        {listings.loading && !listings.data ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-2xl" />)}</div>
        ) : !items.length ? (
          <EmptyState icon={<ImagePlus className="size-6" />} title="No listings yet" action={<Button onClick={() => setManual(true)} icon={<Plus className="size-4" />}>Add a listing by hand</Button>}>
            Enter your shop name above and press Import, or add a listing with its link and photos.
          </EmptyState>
        ) : (
          <div className={cx("grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4")}>
            {items.map((l) => (
              <ListingCard
                key={l.listingId}
                brandId={brandId}
                l={l}
                onMade={() => listings.reload(true)}
                onOpenPost={async (id) => { try { setOpen(await api.post(id)); } catch (e) { fail(e); } }}
                onDelete={async () => { if (!confirm("Remove this listing from the app? (Posts and photos stay.)")) return; try { await etsyApi.deleteListing(brandId, l.listingId); listings.reload(true); } catch (e) { fail(e); } }}
              />
            ))}
          </div>
        )}
      </div>
      <p className="mt-8 text-xs text-zinc-500">The term “Etsy” is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.</p>
      <ManualDialog brandId={brandId} open={manual} onClose={() => setManual(false)} onSaved={() => { listings.reload(true); status.reload(true); }} />
      <PostDrawer post={open} onClose={() => setOpen(null)} onChanged={() => listings.reload(true)} onDeleted={() => { setOpen(null); listings.reload(true); }} />
    </div>
  );
}

export default function EtsyPage() {
  return <NeedBrand>{(id) => <EtsyInner key={id} brandId={id} />}</NeedBrand>;
}
