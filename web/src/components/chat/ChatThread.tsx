import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowUp, Ban, Bot, Check, ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import type { ChatAction, ChatLink, ChatMessage } from "../../lib/types";
import { cx, relTime } from "../../lib/format";
import { Button } from "../ui";

export type Chip = { label: string; text?: string; fill?: boolean };

function LinkChip({ link, onOpenPost }: { link: ChatLink; onOpenPost?: (id: string) => void }) {
  const cls =
    "inline-flex max-w-full items-center gap-1 truncate rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-violet-700 hover:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-violet-300";
  if (link.postId)
    return (
      <button type="button" className={cls} onClick={() => onOpenPost?.(link.postId!)} disabled={!onOpenPost} title={link.label}>
        <span className="truncate">{link.label}</span>
      </button>
    );
  if (link.to && /^https?:\/\//.test(link.to))
    return (
      <a href={link.to} target="_blank" rel="noreferrer" className={cls}>
        <span className="truncate">{link.label}</span> <ExternalLink className="size-3 shrink-0" />
      </a>
    );
  return (
    <Link to={link.to ?? "/"} className={cls}>
      <span className="truncate">{link.label}</span> →
    </Link>
  );
}

export function ActionCard({ action, onConfirm, onOpenPost }: { action: ChatAction; onConfirm?: (a: ChatAction, yes: boolean) => Promise<void>; onOpenPost?: (id: string) => void }) {
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const pending = action.status === "pending_confirmation";
  const icon =
    action.status === "done" || action.status === "confirmed" ? (
      <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
    ) : action.status === "failed" ? (
      <X className="size-3.5 text-rose-600" strokeWidth={3} />
    ) : action.status === "cancelled" ? (
      <Ban className="size-3.5 text-zinc-400" />
    ) : (
      <AlertTriangle className="size-3.5 text-amber-500" />
    );
  const go = async (yes: boolean) => {
    if (!onConfirm) return;
    setBusy(yes ? "yes" : "no");
    try {
      await onConfirm(action, yes);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div
      className={cx(
        "rounded-xl border px-3 py-2 text-xs",
        pending ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40" : action.status === "failed" ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40" : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900",
      )}
    >
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className={cx("min-w-0 flex-1 font-medium", action.status === "cancelled" && "text-zinc-400 line-through")}>{action.label}</span>
        {action.revision != null && <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/60 dark:text-violet-200">Rev {action.revision}</span>}
        {action.status === "confirmed" && <span className="shrink-0 text-[10px] font-semibold uppercase text-emerald-600">confirmed</span>}
      </div>
      {action.status === "failed" && action.detail && <div className="mt-1 text-rose-700 dark:text-rose-300">{action.detail.slice(0, 300)}</div>}
      {!!action.links?.length && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {action.links.map((l, i) => (
            <LinkChip key={i} link={l} onOpenPost={onOpenPost} />
          ))}
        </div>
      )}
      {pending && onConfirm && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="success" icon={<Check className="size-4" />} loading={busy === "yes"} disabled={!!busy} onClick={() => go(true)}>
            Confirm
          </Button>
          <Button size="sm" variant="ghost" loading={busy === "no"} disabled={!!busy} onClick={() => go(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function Bubble({ m, onConfirm, onOpenPost }: { m: ChatMessage; onConfirm?: (a: ChatAction, yes: boolean) => Promise<void>; onOpenPost?: (id: string) => void }) {
  const mine = m.role === "user";
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className={cx("flex gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine && (
        <div className="brand-gradient mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-white">
          <Sparkles className="size-3.5" />
        </div>
      )}
      <div className={cx("min-w-0 max-w-[85%] space-y-1.5", mine && "items-end")}>
        {m.text && (
          <div
            className={cx(
              "whitespace-pre-line break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
              mine ? "rounded-br-md bg-violet-600 text-white" : "rounded-bl-md bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100",
            )}
          >
            {m.text}
          </div>
        )}
        {m.actions?.map((a) => (
          <ActionCard key={a.id} action={a} onConfirm={onConfirm} onOpenPost={onOpenPost} />
        ))}
        <div className={cx("flex items-center gap-1.5 px-1 text-[10px] text-zinc-400", mine && "justify-end")}>
          {relTime(m.createdAt)}
          {!mine && m.mode && <span>· {m.mode === "llm" ? "Claude" : "simple mode"}</span>}
          {m.revision != null && <span>· revision {m.revision}</span>}
        </div>
      </div>
    </motion.div>
  );
}

export function ChatThread({
  messages,
  busy,
  status,
  liveActions,
  onSend,
  onConfirm,
  onOpenPost,
  chips,
  placeholder,
  empty,
  top,
  pinned,
  className,
}: {
  messages: ChatMessage[];
  busy: boolean;
  status?: string;
  liveActions?: ChatAction[];
  onSend: (text: string) => void;
  onConfirm?: (a: ChatAction, yes: boolean) => Promise<void>;
  onOpenPost?: (id: string) => void;
  chips?: Chip[];
  placeholder?: string;
  empty?: ReactNode;
  top?: ReactNode;
  pinned?: ReactNode;
  className?: string;
}) {
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy, liveActions?.length]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(160, el.scrollHeight) + "px";
  }, [text]);

  const send = (t = text) => {
    const v = t.trim();
    if (!v || busy) return;
    onSend(v);
    setText("");
  };
  const chip = (c: Chip) => {
    if (c.fill) {
      setText(c.text ?? c.label);
      requestAnimationFrame(() => {
        const el = input.current;
        if (el) {
          el.focus();
          el.selectionStart = el.selectionEnd = el.value.length;
        }
      });
    } else send(c.text ?? c.label);
  };

  return (
    <div className={cx("flex min-h-0 flex-col", className)}>
      {pinned}
      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-3">
        {top}
        {messages.length === 0 && !busy && (empty ?? <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-zinc-500"><Bot className="size-6 text-violet-500" />Ask me anything.</div>)}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} onConfirm={onConfirm} onOpenPost={onOpenPost} />
        ))}
        <AnimatePresence>
          {busy && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-2">
              <div className="brand-gradient mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-white">
                <Sparkles className="size-3.5" />
              </div>
              <div className="min-w-0 max-w-[85%] space-y-1.5">
                <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md bg-zinc-100 px-3.5 py-2 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <Loader2 className="size-3.5 animate-spin" /> {status || "Thinking…"}
                </div>
                {liveActions?.map((a) => <ActionCard key={a.id} action={a} />)}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {!!chips?.length && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2 pt-1">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              disabled={busy}
              onClick={() => chip(c)}
              className="shrink-0 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:border-violet-400 hover:text-violet-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-violet-300"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-2xl border border-zinc-200 bg-white p-1.5 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-500/20 dark:border-zinc-700 dark:bg-zinc-900">
        <textarea
          ref={input}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder ?? "Type a message…"}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-zinc-400"
          aria-label="Message"
        />
        <button
          type="button"
          onClick={() => send()}
          disabled={busy || !text.trim()}
          className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-xl text-white transition hover:brightness-110 disabled:opacity-40"
          aria-label="Send"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  );
}
