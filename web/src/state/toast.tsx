import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { ApiError } from "../lib/api";
import { cx } from "../lib/format";

type Kind = "success" | "error" | "info";
type Toast = { id: number; kind: Kind; title: string; detail?: string };

type Ctx = {
  toast: (kind: Kind, title: string, detail?: string) => void;
  /** Show a friendly error toast for any thrown value. */
  fail: (e: unknown, context?: string) => void;
};
const ToastCtx = createContext<Ctx>({ toast: () => {}, fail: () => {} });

let n = 0;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const toast = useCallback((kind: Kind, title: string, detail?: string) => {
    const id = ++n;
    setToasts((t) => [...t.filter((x) => x.title !== title), { id, kind, title, detail }].slice(-4));
    setTimeout(() => dismiss(id), kind === "error" ? 7000 : 3500);
  }, []);
  const fail = useCallback(
    (e: unknown, context?: string) => {
      if (e instanceof ApiError && e.down) return toast("error", "API server is not running", "Start the server: npm run dev in server/");
      if (e instanceof ApiError && e.status === 404 && /not found/i.test(e.message))
        return toast("error", context ?? "Not available", "This feature isn't available on your server yet — update server/ and restart it.");
      toast("error", context ?? "Something went wrong", e instanceof Error ? e.message : String(e));
    },
    [toast],
  );
  return (
    <ToastCtx.Provider value={{ toast, fail }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              "toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3.5 shadow-lg backdrop-blur",
              "border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-900/95",
            )}
          >
            {t.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" />
            ) : t.kind === "error" ? (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-500" />
            ) : (
              <Info className="mt-0.5 size-5 shrink-0 text-violet-500" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.detail && <p className="mt-0.5 break-words text-sm text-zinc-600 dark:text-zinc-400">{t.detail}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
