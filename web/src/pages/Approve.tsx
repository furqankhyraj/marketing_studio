import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { animate, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { ArrowLeft, ArrowRight, CalendarClock, Check, Heart, MessageCircle, MessageSquareText, PartyPopper, Pencil, RefreshCw, Wand2, X } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, fmtTime } from "../lib/format";
import type { Post } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useToast } from "../state/toast";
import { NeedBrand, PostPreview } from "../components/media";
import { PostDrawer } from "../components/PostDrawer";
import { PostChat } from "../components/chat/PostChat";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Skeleton, StatusBadge, Textarea } from "../components/ui";

const QUEUE = ["ready", "rendering", "changes_requested", "draft", "failed"];
const ORDER: Record<string, number> = { ready: 0, rendering: 1, changes_requested: 2, draft: 3, failed: 4 };
const THRESHOLD = 110;

function SwipeCard({ post, onDecide, onOpen, top }: { post: Post; onDecide: (dir: "left" | "right") => void; onOpen: () => void; top: boolean }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-14, 14]);
  const yesOpacity = useTransform(x, [20, THRESHOLD], [0, 1]);
  const noOpacity = useTransform(x, [-THRESHOLD, -20], [1, 0]);

  const fly = useCallback(
    (dir: "left" | "right") => {
      if (dir === "right") animate(x, 600, { duration: 0.25 }).then(() => onDecide("right"));
      else animate(x, 0, { type: "spring", stiffness: 400, damping: 30 }).then(() => onDecide("left"));
    },
    [x, onDecide],
  );

  // Expose fly() for buttons / keyboard through a DOM event.
  useEffect(() => {
    if (!top) return;
    const h = (e: Event) => fly((e as CustomEvent).detail);
    window.addEventListener("sms-swipe", h);
    return () => window.removeEventListener("sms-swipe", h);
  }, [top, fly]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > THRESHOLD || info.velocity.x > 700) fly("right");
    else if (info.offset.x < -THRESHOLD || info.velocity.x < -700) fly("left");
    else animate(x, 0, { type: "spring", stiffness: 500, damping: 30 });
  };

  return (
    <motion.div
      className="absolute inset-0 touch-pan-y select-none"
      style={{ x, rotate, zIndex: top ? 10 : 1 }}
      drag={top ? "x" : false}
      dragElastic={0.9}
      dragMomentum={false}
      onDragEnd={onDragEnd}
      initial={{ scale: top ? 1 : 0.95, y: top ? 0 : 14, opacity: top ? 1 : 0.7 }}
      animate={{ scale: top ? 1 : 0.95, y: top ? 0 : 14, opacity: top ? 1 : 0.7 }}
      whileDrag={{ cursor: "grabbing" }}
    >
      <div className="relative h-full cursor-grab overflow-hidden rounded-3xl bg-zinc-900 shadow-2xl shadow-zinc-900/20 ring-1 ring-black/5 dark:ring-white/10">
        <PostPreview post={post} rounded="rounded-none" className="!aspect-auto h-full" fit="contain" />
        <motion.div style={{ opacity: yesOpacity }} className="pointer-events-none absolute left-5 top-6 -rotate-12 rounded-xl border-4 border-emerald-400 px-3 py-1 text-2xl font-black uppercase tracking-wider text-emerald-400">
          Approve
        </motion.div>
        <motion.div style={{ opacity: noOpacity }} className="pointer-events-none absolute right-5 top-6 rotate-12 rounded-xl border-4 border-rose-400 px-3 py-1 text-2xl font-black uppercase tracking-wider text-rose-400">
          Change
        </motion.div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 pt-16 text-white">
          <div className="mb-1.5 flex items-center gap-2">
            <Badge tone="gray" className="!bg-white/15 !text-white !ring-white/20 capitalize">{post.type}</Badge>
            {post.scheduledAt && <span className="flex items-center gap-1 text-xs opacity-90"><CalendarClock className="size-3.5" />{fmtDateTime(post.scheduledAt)}</span>}
          </div>
          <div className="text-base font-bold leading-snug">{post.title}</div>
        </div>
        <button
          onClick={onOpen}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute right-3 top-3 rounded-full bg-black/45 p-2 text-white backdrop-blur hover:bg-black/70"
          aria-label="Edit post"
        >
          <Pencil className="size-4" />
        </button>
      </div>
    </motion.div>
  );
}

function ApproveInner({ brandId }: { brandId: string }) {
  const { toast, fail } = useToast();
  const q = useApi(() => api.posts({ brandId }), [brandId], {
    poll: (d) => (d?.some((p) => ["rendering", "changes_requested", "publishing"].includes(p.status)) ? 3000 : 20000),
  });
  const [changeFor, setChangeFor] = useState<Post | null>(null);
  const [changeText, setChangeText] = useState("");
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState<Post | null>(null);
  const [chatFor, setChatFor] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const busyRef = useRef(false);

  const posts = q.data ?? [];
  const queue = useMemo(
    () =>
      posts
        .filter((p) => QUEUE.includes(p.status))
        .sort((a, b) => ORDER[a.status] - ORDER[b.status] || +new Date(a.scheduledAt ?? a.createdAt) - +new Date(b.scheduledAt ?? b.createdAt))
        .sort((a, b) => Number(skipped.includes(a.id)) - Number(skipped.includes(b.id))),
    [posts, skipped],
  );
  const top = queue[0];
  const week = useMemo(() => {
    const now = Date.now();
    const end = now + 7 * 86400_000;
    return posts
      .filter((p) => p.scheduledAt && +new Date(p.scheduledAt) >= now - 86400_000 && +new Date(p.scheduledAt) <= end && p.status !== "failed")
      .sort((a, b) => +new Date(a.scheduledAt!) - +new Date(b.scheduledAt!));
  }, [posts]);

  const replace = (p: Post) => q.setData((list) => (list ?? []).map((x) => (x.id === p.id ? p : x)));

  const decide = useCallback(
    async (post: Post, dir: "left" | "right") => {
      if (dir === "left") {
        setChangeFor(post);
        setChangeText("");
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;
      // Optimistic: mark approved so it leaves the stack.
      replace({ ...post, status: "approved" });
      try {
        const p = await api.approve(post.id);
        replace(p);
        toast("success", "Approved", p.scheduledAt ? `Posting ${fmtDateTime(p.scheduledAt)}` : undefined);
      } catch (e) {
        replace(post);
        fail(e, "Couldn't approve");
      } finally {
        busyRef.current = false;
      }
    },
    [toast, fail], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (changeFor || open || chatFor || !top) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") window.dispatchEvent(new CustomEvent("sms-swipe", { detail: "right" }));
      if (e.key === "ArrowLeft") window.dispatchEvent(new CustomEvent("sms-swipe", { detail: "left" }));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [changeFor, open, chatFor, top]);

  const sendChange = async () => {
    if (!changeFor || !changeText.trim()) return;
    setSending(true);
    try {
      const p = await api.requestChange(changeFor.id, changeText.trim());
      replace(p);
      setSkipped((s) => [...s.filter((x) => x !== p.id), p.id]);
      toast("success", "Got it — remaking it", "It will come back here when it's ready.");
      setChangeFor(null);
    } catch (e) { fail(e, "Couldn't send the change"); } finally { setSending(false); }
  };

  const readyCount = queue.filter((p) => p.status === "ready").length;

  return (
    <div>
      <PageHeader
        icon={<Heart className="size-5" />}
        title="Approve"
        subtitle="Swipe right to approve, left to ask for a change. Arrow keys work too."
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => q.reload()}>Refresh</Button>}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col items-center">
          {q.loading ? (
            <Skeleton className="aspect-[9/16] w-full max-w-[22rem] rounded-3xl" />
          ) : !top ? (
            <div className="w-full">
              <EmptyState
                icon={<PartyPopper className="size-6" />}
                title="You're all caught up"
                action={<Link to="/plan"><Button variant="primary" icon={<Wand2 className="size-4" />}>Plan my week</Button></Link>}
              >
                Nothing is waiting for your yes. Plan more posts, or ask Claude to make some.
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="mb-3 flex w-full max-w-[22rem] items-center justify-between text-sm">
                <span className="text-zinc-500">{readyCount} ready · {queue.length} in queue</span>
                <StatusBadge status={top.status} />
              </div>
              <div className="relative aspect-[9/16] w-full max-w-[22rem]">
                {queue.slice(0, 2).reverse().map((p) => (
                  <SwipeCard key={p.id} post={p} top={p.id === top.id} onDecide={(d) => decide(p, d)} onOpen={() => setOpen(p)} />
                ))}
              </div>
              <div className="mt-6 flex items-center gap-5">
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent("sms-swipe", { detail: "left" }))}
                  className="flex size-16 items-center justify-center rounded-full border border-zinc-200 bg-white text-rose-500 shadow-lg transition hover:scale-105 active:scale-95 dark:border-zinc-700 dark:bg-zinc-900"
                  aria-label="Request a change"
                  title="Request a change (←)"
                >
                  <X className="size-7" strokeWidth={2.5} />
                </button>
                <button
                  onClick={() => setSkipped((s) => [...s.filter((x) => x !== top.id), top.id])}
                  className="flex size-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow transition hover:scale-105 dark:border-zinc-700 dark:bg-zinc-900"
                  aria-label="Skip for now"
                  title="Skip for now"
                >
                  <ArrowRight className="size-5" />
                </button>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent("sms-swipe", { detail: "right" }))}
                  className="flex size-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 transition hover:scale-105 active:scale-95"
                  aria-label="Approve"
                  title="Approve (→)"
                >
                  <Check className="size-7" strokeWidth={3} />
                </button>
              </div>
              <div className="mt-2 flex gap-6 text-xs text-zinc-500">
                <span className="flex items-center gap-1"><ArrowLeft className="size-3" />change</span>
                <span className="flex items-center gap-1">approve<ArrowRight className="size-3" /></span>
              </div>

              <Card className="mt-6 w-full max-w-[34rem] p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Caption</div>
                <p className="mt-1.5 whitespace-pre-line text-sm">{top.caption || <span className="text-zinc-400">No caption yet</span>}</p>
                {top.hashtags.length > 0 && <p className="mt-2 text-sm text-violet-600 dark:text-violet-300">{top.hashtags.map((h) => `#${h}`).join(" ")}</p>}
                <Button size="sm" variant="ghost" className="mt-3 mr-2" icon={<MessageCircle className="size-4" />} onClick={() => setChatFor(top.id)}>
                  Chat to change it
                </Button>
                {top.status === "draft" && (
                  <Button size="sm" className="mt-3" icon={<RefreshCw className="size-4" />} onClick={async () => { try { replace(await api.render(top.id)); } catch (e) { fail(e); } }}>
                    Render this post
                  </Button>
                )}
              </Card>
            </>
          )}
        </div>

        <div>
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">This week</h2>
              <Link to="/calendar" className="text-sm font-medium text-violet-600 dark:text-violet-300">Calendar →</Link>
            </div>
            {week.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">Nothing scheduled in the next 7 days.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {week.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => setOpen(p)} className="flex w-full items-center gap-3 py-2.5 text-left">
                      <div className="w-12 shrink-0 text-center">
                        <div className="text-[11px] font-semibold uppercase text-zinc-500">{new Date(p.scheduledAt!).toLocaleDateString(undefined, { weekday: "short" })}</div>
                        <div className="text-xs tabular-nums">{fmtTime(p.scheduledAt)}</div>
                      </div>
                      <div className="w-9 shrink-0"><PostPreview post={p} autoPlay={false} rounded="rounded-md" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.title}</div>
                        <StatusBadge status={p.status} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={!!changeFor}
        onClose={() => setChangeFor(null)}
        title={<span className="flex items-center gap-2"><MessageSquareText className="size-5 text-violet-500" />Say what to change…</span>}
        footer={
          <>
            <Button variant="ghost" onClick={() => setChangeFor(null)}>Cancel</Button>
            <Button variant="primary" loading={sending} disabled={!changeText.trim()} onClick={sendChange}>Remake it</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-zinc-500">“{changeFor?.title}” — we'll rewrite and re-render it.</p>
        <Textarea
          autoFocus
          value={changeText}
          onChange={(e) => setChangeText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendChange(); }}
          placeholder="e.g. Make the hook punchier, use the photo of the shop, and switch to the cinematic style"
          className="min-h-28"
        />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["Punchier hook", "Shorter", "Use my photos", "Different style", "More on-brand colors", "Fix the caption"].map((s) => (
            <button key={s} onClick={() => setChangeText((t) => (t ? `${t}. ${s}` : s))} className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs hover:border-violet-400 dark:border-zinc-700">
              {s}
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={!!chatFor}
        onClose={() => setChatFor(null)}
        wide
        title={<span className="flex items-center gap-2"><MessageCircle className="size-5 text-violet-500" />{posts.find((p) => p.id === chatFor)?.title ?? "Chat"}</span>}
      >
        {chatFor && posts.find((p) => p.id === chatFor) && (
          <PostChat post={posts.find((p) => p.id === chatFor)!} onPost={replace} showPreview className="h-[min(70vh,40rem)]" />
        )}
      </Modal>

      <PostDrawer
        post={open}
        onClose={() => setOpen(null)}
        onChanged={replace}
        onDeleted={(id) => q.setData((l) => (l ?? []).filter((x) => x.id !== id))}
      />
    </div>
  );
}

export default function ApprovePage() {
  return <NeedBrand>{(id) => <ApproveInner key={id} brandId={id} />}</NeedBrand>;
}
