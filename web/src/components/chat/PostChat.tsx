import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { CheckCircle2, History, Info, Loader2, Play } from "lucide-react";
import { api } from "../../lib/api";
import { chatApi, mergeMessages } from "../../lib/chat";
import { cx, mediaUrl, relTime } from "../../lib/format";
import type { ChatAction, ChatMessage, ChatMode, Post, PostRevision } from "../../lib/types";
import { useToast } from "../../state/toast";
import { PostPreview } from "../media";
import { Progress } from "../ui";
import { ChatThread, type Chip } from "./ChatThread";

const LIVE = ["rendering", "changes_requested"];

function chipsFor(post: Post): Chip[] {
  const common: Chip[] = [
    { label: "What does it say?", text: post.type === "carousel" ? "What does this carousel say?" : "What does this reel say?" },
    { label: "Punchier hook", text: "Make the hook punchier" },
    { label: "Switch style…", text: "Switch to neon style", fill: true },
    { label: "Change caption…", text: "Caption: ", fill: true },
  ];
  if (post.type === "image")
    return [
      { label: "What does it say?", text: "What does this image post say?" },
      { label: "New headline…", text: "Change the headline to ", fill: true },
      { label: "Switch style…", text: "Switch to magazine style", fill: true },
      { label: "Make it a poll", text: "Make it a question post" },
      { label: "Darker look", text: "Make it darker" },
      { label: "Change caption…", text: "Caption: ", fill: true },
      { label: "Approve", text: "Approve it" },
    ];
  if (post.type === "carousel") return [...common, { label: "Change slide 2…", text: "Change slide 2 text to ", fill: true }, { label: "Approve", text: "Approve it" }];
  return [
    ...common,
    { label: "Calm music", text: "Use calm music" },
    { label: "Shorten to 15s", text: "Shorten to 15s" },
    { label: "Change scene 2…", text: "Change scene 2 text to ", fill: true },
    { label: "Urdu captions", text: "Translate captions to Urdu" },
    { label: "Male voice", text: "Regenerate voiceover with a male voice" },
    { label: "Approve", text: "Approve it" },
  ];
}

/**
 * Chat with one post: "make the hook punchier", "use calm music"… The assistant edits the post, a re-render
 * starts, and this panel shows the progress and the new video. Shows revision history from the render folders.
 */
export function PostChat({ post, onPost, poll = true, showPreview = false, className }: { post: Post; onPost: (p: Post) => void; poll?: boolean; showPreview?: boolean; className?: string }) {
  const { fail } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  const [mode, setMode] = useState<ChatMode | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [live, setLive] = useState<ChatAction[]>([]);
  const [revisions, setRevisions] = useState<PostRevision[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [playing, setPlaying] = useState<PostRevision | null>(null);
  const [justFinished, setJustFinished] = useState<number | null>(null);
  const prevStatus = useRef(post.status);
  const onPostRef = useRef(onPost);
  onPostRef.current = onPost;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessages([]);
    chatApi
      .postChat(post.id)
      .then((d) => {
        if (!alive) return;
        setMessages(d.messages);
        setSessionId(d.session.id);
        setMode(d.mode);
      })
      .catch((e) => alive && fail(e, "Couldn't load the chat"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [post.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRevisions = useCallback(() => {
    chatApi.revisions(post.id).then(setRevisions, () => setRevisions([]));
  }, [post.id]);
  useEffect(loadRevisions, [loadRevisions, post.revision, post.status === "ready"]);

  // Own polling while a re-render runs (the post drawer has its own; pass poll={false} there).
  const isLive = LIVE.includes(post.status);
  useEffect(() => {
    if (!poll || !isLive) return;
    const t = setInterval(async () => {
      try {
        onPostRef.current(await api.post(post.id));
      } catch {
        /* transient */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [poll, isLive, post.id]);

  // Celebrate when a render we were waiting for finishes.
  useEffect(() => {
    if (LIVE.includes(prevStatus.current) && post.status === "ready") setJustFinished(post.revision);
    if (LIVE.includes(post.status)) setJustFinished(null);
    prevStatus.current = post.status;
  }, [post.status, post.revision]);

  const send = async (text: string) => {
    const temp: ChatMessage = { id: `tmp-${Date.now()}`, sessionId, role: "user", text, createdAt: new Date().toISOString() };
    setMessages((l) => [...l, temp]);
    setBusy(true);
    setStatus("");
    setLive([]);
    try {
      const r = await chatApi.sendPost(post.id, text, { onStatus: setStatus, onAction: (a) => setLive((l) => [...l.filter((x) => x.id !== a.id), a]) });
      setMessages((l) => mergeMessages(l.filter((m) => m.id !== temp.id), r.messages));
      setSessionId(r.session.id);
      setMode(r.mode);
      if (r.post) onPostRef.current(r.post);
    } catch (e) {
      setMessages((l) => l.filter((m) => m.id !== temp.id));
      fail(e, "Chat failed");
    } finally {
      setBusy(false);
      setLive([]);
    }
  };

  const confirm = async (a: ChatAction, yes: boolean) => {
    try {
      const r = await chatApi.confirm(sessionId, a.id, yes);
      setMessages((l) => mergeMessages(l, r.messages));
      if (r.post) onPostRef.current(r.post);
    } catch (e) {
      fail(e);
    }
  };

  const pendingRev = Math.max(0, ...messages.map((m) => m.revision ?? 0));
  const renderBar = isLive ? (
    <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/40">
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-violet-800 dark:text-violet-200">
        <Loader2 className="size-3.5 animate-spin" />
        {post.status === "changes_requested" ? `Rewriting for revision ${Math.max(pendingRev, post.revision + 1)}…` : `Rendering revision ${post.revision}… ${Math.round((post.renderProgress ?? 0) * 100)}%`}
      </div>
      <Progress value={post.status === "changes_requested" ? 0.04 : post.renderProgress ?? 0} />
    </div>
  ) : justFinished != null ? (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
      <CheckCircle2 className="size-4" /> Revision {justFinished} is ready{showPreview ? " — preview below." : " — it's playing in the preview."}
    </div>
  ) : post.status === "failed" && post.error ? (
    <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{post.error}</div>
  ) : null;

  const top = (
    <div className="space-y-2">
      {mode === "rules" && (
        <div className="flex items-start gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Simple mode: direct edits (hook, style, length, music, scene text, caption, approve). Add an Anthropic key in{" "}
            <Link to="/settings" className="font-semibold text-violet-700 underline-offset-2 hover:underline dark:text-violet-300">Settings</Link> for full chat — rewrites and translations.
          </span>
        </div>
      )}
      {showPreview && (post.mediaUrls.length > 0 || isLive) && (
        <div className="mx-auto w-40">
          <PostPreview post={post} controls />
        </div>
      )}
      {revisions.length > 0 && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
          <button type="button" onClick={() => setShowHistory((s) => !s)} className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            <History className="size-3.5" /> Revision history · {revisions.length} render{revisions.length === 1 ? "" : "s"} · now on revision {post.revision}
            <span className="ml-auto text-zinc-400">{showHistory ? "Hide" : "Show"}</span>
          </button>
          {showHistory && (
            <ul className="space-y-1 px-2 pb-2">
              {revisions.map((r) => (
                <li key={r.revision}>
                  <button
                    type="button"
                    onClick={() => setPlaying(playing?.revision === r.revision ? null : r)}
                    className={cx("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800", playing?.revision === r.revision && "bg-zinc-100 dark:bg-zinc-800")}
                  >
                    {r.thumbnailUrl ? <img src={mediaUrl(r.thumbnailUrl)} alt="" className="h-9 w-6 shrink-0 rounded object-cover" /> : <div className="h-9 w-6 shrink-0 rounded bg-zinc-200 dark:bg-zinc-700" />}
                    <span className="font-medium">Revision {r.revision}</span>
                    {r.current && <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">current</span>}
                    <span className="text-zinc-400">{relTime(r.createdAt)}</span>
                    <Play className="ml-auto size-3.5 text-zinc-400" />
                  </button>
                  {playing?.revision === r.revision && (
                    <div className="mx-auto my-1.5 w-40">
                      {/\.mp4/i.test(r.mediaUrls[0] ?? "") ? (
                        <video src={mediaUrl(r.mediaUrls[0])} poster={mediaUrl(r.thumbnailUrl)} controls autoPlay playsInline className="aspect-[9/16] w-full rounded-lg bg-black object-cover" />
                      ) : (
                        <img src={mediaUrl(r.mediaUrls[0])} alt={`Revision ${r.revision}`} className="w-full rounded-lg" />
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  return (
    <ChatThread
      className={className}
      top={top}
      pinned={renderBar ? <div className="pb-1">{renderBar}</div> : undefined}
      messages={messages}
      busy={busy || loading}
      status={loading ? "Loading conversation…" : status}
      liveActions={live}
      onSend={send}
      onConfirm={confirm}
      chips={chipsFor(post)}
      placeholder={`Ask for a change, e.g. “make the hook punchier”`}
      empty={
        <div className="py-6 text-center text-sm text-zinc-500">
          <div className="font-medium text-zinc-700 dark:text-zinc-200">Talk to this {post.type} like a designer.</div>
          Tell me what to change — I'll edit it, re-render it, and show you the new version here.
        </div>
      }
    />
  );
}
