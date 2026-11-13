import { useMemo, useState } from "react";
import { Link } from "react-router";
import { LayoutGrid, Search, Wand2 } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, STATUS_META } from "../lib/format";
import type { Post, PostStatus, PostType } from "../lib/types";
import { useApi } from "../lib/useApi";
import { NeedBrand, PostPreview } from "../components/media";
import { PostDrawer } from "../components/PostDrawer";
import { Button, EmptyState, FilterChip, Input, PageHeader, Segmented, Skeleton, StatusBadge } from "../components/ui";

const STATUSES: PostStatus[] = ["ready", "rendering", "changes_requested", "approved", "posted", "draft", "failed"];

function LibraryInner({ brandId }: { brandId: string }) {
  const q = useApi(() => api.posts({ brandId }), [brandId], {
    poll: (d) => (d?.some((p) => ["rendering", "changes_requested", "publishing"].includes(p.status)) ? 3000 : false),
  });
  const [status, setStatus] = useState<PostStatus | "all">("all");
  const [type, setType] = useState<PostType | "all">("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Post | null>(null);
  const posts = q.data ?? [];

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of posts) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [posts]);
  const shown = useMemo(
    () =>
      posts
        .filter((p) => (status === "all" || p.status === status) && (type === "all" || p.type === type))
        .filter((p) => !search || `${p.title} ${p.caption} ${p.hook}`.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => +new Date(b.scheduledAt ?? b.createdAt) - +new Date(a.scheduledAt ?? a.createdAt)),
    [posts, status, type, search],
  );
  const replace = (p: Post) => q.setData((l) => (l ?? []).map((x) => (x.id === p.id ? p : x)));

  return (
    <div>
      <PageHeader
        icon={<LayoutGrid className="size-5" />}
        title="Library"
        subtitle="Every reel, carousel, image post and story — open one to edit, re-render, approve or publish."
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search posts" className="w-full pl-9 sm:w-56" />
            </div>
            <Segmented
              value={type}
              onChange={setType}
              options={[{ value: "all", label: "All" }, { value: "reel", label: "Reels" }, { value: "carousel", label: "Carousels" }, { value: "image", label: "Images" }, { value: "story", label: "Stories" }]}
            />
          </>
        }
      />
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <FilterChip active={status === "all"} onClick={() => setStatus("all")} count={posts.length}>All</FilterChip>
        {STATUSES.map((s) => (
          <FilterChip key={s} active={status === s} onClick={() => setStatus(s)} count={counts[s] ?? 0}>{STATUS_META[s].label}</FilterChip>
        ))}
      </div>

      {q.loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="aspect-[9/16] rounded-2xl" />)}</div>
      ) : posts.length === 0 ? (
        <EmptyState icon={<LayoutGrid className="size-6" />} title="No posts yet" action={<Link to="/plan"><Button variant="primary" icon={<Wand2 className="size-4" />}>Plan my week</Button></Link>}>
          Plan your week and we'll write and render your first reels.
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500">No posts match these filters.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((p) => (
            <button key={p.id} onClick={() => setOpen(p)} className="group text-left">
              <div className="transition group-hover:-translate-y-0.5 group-hover:shadow-xl">
                <PostPreview post={p} autoPlay={false} />
              </div>
              <div className="mt-2 space-y-1 px-0.5">
                <div className="line-clamp-2 text-sm font-medium">{p.title || "Untitled"}</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={p.status} />
                  <span className="text-xs capitalize text-zinc-500">{p.type}</span>
                </div>
                <div className="text-xs text-zinc-500">{p.status === "posted" ? `Posted ${fmtDateTime(p.postedAt ?? p.scheduledAt)}` : fmtDateTime(p.scheduledAt)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      <PostDrawer post={open} onClose={() => setOpen(null)} onChanged={replace} onDeleted={(id) => q.setData((l) => (l ?? []).filter((x) => x.id !== id))} />
    </div>
  );
}

export default function LibraryPage() {
  return <NeedBrand>{(id) => <LibraryInner key={id} brandId={id} />}</NeedBrand>;
}
