import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Info, Maximize2, MessageCirclePlus, Sparkles, X } from "lucide-react";
import { api } from "../../lib/api";
import { chatApi, mergeMessages } from "../../lib/chat";
import type { ChatAction, ChatMessage, ChatMode, Post } from "../../lib/types";
import { useBrands } from "../../state/brand";
import { useToast } from "../../state/toast";
import { PostDrawer } from "../PostDrawer";
import { ChatThread, type Chip } from "./ChatThread";

const KEY = "sms-chat-session";
export function storedSession(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
export function storeSession(id: string | undefined) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent("sms-chat-session", { detail: id }));
  } catch {
    /* ignore */
  }
}

const CHIPS = (brand?: string): Chip[] => [
  { label: "Status", text: "Status" },
  { label: "Waiting for approval", text: "What's waiting for approval?" },
  { label: "Plan 3 reels", text: `Plan 3 reels${brand ? ` for ${brand}` : ""} this week` },
  { label: "Calendar", text: "Show the calendar" },
  { label: "Approve all ready", text: "Approve all ready posts" },
  { label: "Run audit", text: "Run an audit" },
  { label: "Music", text: "List music" },
  { label: "Instagram", text: "Instagram status" },
  { label: "Edit latest reel…", text: "Make the hook of the latest reel punchier", fill: true },
];

/** The global assistant conversation (used by the floating panel and the /assistant page). */
export function AssistantPanel({ sessionId, onSession, className }: { sessionId?: string; onSession: (id: string | undefined) => void; className?: string }) {
  const { brand } = useBrands();
  const { fail } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<ChatMode | undefined>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [live, setLive] = useState<ChatAction[]>([]);
  const [openPost, setOpenPost] = useState<Post | null>(null);

  useEffect(() => {
    let alive = true;
    if (!sessionId) {
      setMessages([]);
      chatApi.info().then((i) => alive && setMode(i.mode), () => {});
      return;
    }
    chatApi.session(sessionId).then(
      (d) => {
        if (!alive) return;
        setMessages(d.messages);
        setMode(d.mode);
      },
      () => alive && onSession(undefined),
    );
    return () => {
      alive = false;
    };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text: string) => {
    const temp: ChatMessage = { id: `tmp-${Date.now()}`, sessionId: sessionId ?? "", role: "user", text, createdAt: new Date().toISOString() };
    setMessages((l) => [...l, temp]);
    setBusy(true);
    setStatus("");
    setLive([]);
    try {
      const r = await chatApi.send({ sessionId, message: text, brandId: brand?.id }, { onStatus: setStatus, onAction: (a) => setLive((l) => [...l.filter((x) => x.id !== a.id), a]) });
      setMessages((l) => mergeMessages(l.filter((m) => m.id !== temp.id), r.messages));
      setMode(r.mode);
      if (r.session.id !== sessionId) onSession(r.session.id);
    } catch (e) {
      setMessages((l) => l.filter((m) => m.id !== temp.id));
      fail(e, "Assistant failed");
    } finally {
      setBusy(false);
      setLive([]);
    }
  };
  const confirm = async (a: ChatAction, yes: boolean) => {
    if (!sessionId) return;
    try {
      const r = await chatApi.confirm(sessionId, a.id, yes);
      setMessages((l) => mergeMessages(l, r.messages));
    } catch (e) {
      fail(e);
    }
  };
  const open = useCallback(
    async (id: string) => {
      try {
        setOpenPost(await api.post(id));
      } catch (e) {
        fail(e, "Couldn't open that post");
      }
    },
    [fail],
  );

  return (
    <>
      <ChatThread
        className={className}
        messages={messages}
        busy={busy}
        status={status}
        liveActions={live}
        onSend={send}
        onConfirm={confirm}
        onOpenPost={open}
        chips={CHIPS(brand?.name)}
        placeholder="Ask me to plan, edit, approve, schedule…"
        top={
          mode === "rules" ? (
            <div className="flex items-start gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>Simple mode understands common requests. Add an Anthropic key in Settings (or use Claude Desktop via MCP) for full natural-language chat.</span>
            </div>
          ) : undefined
        }
        empty={
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-zinc-500">
            <div className="brand-gradient flex size-10 items-center justify-center rounded-2xl text-white">
              <Sparkles className="size-5" />
            </div>
            <div className="font-semibold text-zinc-800 dark:text-zinc-100">Your social media assistant</div>
            <p className="max-w-xs">Plan posts, change a reel, check what's ready, approve and schedule. I'll always ask before approving, publishing or deleting.</p>
          </div>
        }
      />
      <PostDrawer post={openPost} onClose={() => setOpenPost(null)} onChanged={(p) => setOpenPost(p)} onDeleted={() => setOpenPost(null)} />
    </>
  );
}

/** Floating button + slide-over assistant, available on every page (hidden on /assistant). */
export function AssistantLauncher() {
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(storedSession);
  useEffect(() => {
    const h = (e: Event) => setSessionId((e as CustomEvent).detail ?? undefined);
    window.addEventListener("sms-chat-session", h);
    return () => window.removeEventListener("sms-chat-session", h);
  }, []);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);
  if (loc.pathname.startsWith("/assistant")) return null;
  const setSession = (id: string | undefined) => {
    setSessionId(id);
    storeSession(id);
  };
  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setOpen(true)}
            className="brand-gradient fixed bottom-20 right-4 z-40 flex size-14 items-center justify-center rounded-full text-white shadow-xl shadow-fuchsia-500/30 lg:bottom-6 lg:right-6"
            aria-label="Open assistant"
            title="Assistant"
          >
            <Sparkles className="size-6" />
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="fixed inset-x-0 bottom-0 top-16 z-40 flex flex-col border-l border-zinc-200 bg-white shadow-2xl sm:inset-x-auto sm:right-0 sm:top-0 sm:w-[26rem] dark:border-zinc-800 dark:bg-zinc-950"
            aria-label="Assistant"
          >
            <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div className="brand-gradient flex size-7 items-center justify-center rounded-lg text-white">
                <Sparkles className="size-4" />
              </div>
              <div className="font-semibold">Assistant</div>
              <div className="flex-1" />
              <button onClick={() => setSession(undefined)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="New chat" aria-label="New chat">
                <MessageCirclePlus className="size-4.5" />
              </button>
              <button onClick={() => { setOpen(false); nav("/assistant"); }} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Open full page" aria-label="Open full page">
                <Maximize2 className="size-4.5" />
              </button>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close assistant">
                <X className="size-5" />
              </button>
            </div>
            <AssistantPanel sessionId={sessionId} onSession={setSession} className="min-h-0 flex-1 px-3 pb-3" />
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
