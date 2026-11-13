import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Loader2, X } from "lucide-react";
import { cx, STATUS_META, TONE_CLASSES, type Tone } from "../lib/format";
import type { PostStatus } from "../lib/types";

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
const BTN: Record<BtnVariant, string> = {
  primary: "brand-gradient text-white shadow-sm shadow-fuchsia-500/20 hover:brightness-110",
  secondary: "border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-sm" : size === "lg" ? "h-12 px-6 text-base" : "h-10 px-4 text-sm",
        BTN[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900", className)} {...rest}>
      {children}
    </div>
  );
}

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONE_CLASSES[tone], className)}>{children}</span>;
}

export function StatusBadge({ status }: { status: PostStatus }) {
  const m = STATUS_META[status] ?? { label: status, tone: "gray" as Tone };
  return (
    <Badge tone={m.tone}>
      {(status === "rendering" || status === "publishing" || status === "changes_requested") && <Loader2 className="size-3 animate-spin" />}
      {m.label}
    </Badge>
  );
}

const fieldCls =
  "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(fieldCls, "h-10", className)} {...rest} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(fieldCls, "min-h-20 resize-y", className)} {...rest} />;
});
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldCls, "h-10 pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className, right }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <div className={cx("block", className)}>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        <span>{label}</span>
        {right}
      </div>
      {children}
      {hint && <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50", checked ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-700")}
    >
      <span className={cx("inline-block size-5 rounded-full bg-white shadow transition", checked ? "translate-x-5.5" : "translate-x-0.5")} />
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-violet-500", className)} />;
}

export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="brand-gradient mt-0.5 hidden size-10 shrink-0 items-center justify-center rounded-xl text-white sm:flex">{icon}</div>}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white/50 px-6 py-14 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-sm text-zinc-600 dark:text-zinc-400">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className={cx("toast-in relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl dark:bg-zinc-900", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0 text-lg font-semibold">{title}</div>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex flex-wrap gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Editable list of strings shown as chips. Enter or comma adds. `hashtag` strips '#' and spaces. */
export function ChipInput({ value, onChange, placeholder, hashtag }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; hashtag?: boolean }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    let items = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (hashtag) items = items.flatMap((s) => s.split(/\s+/)).map((s) => s.replace(/^#+/, "")).filter(Boolean);
    const next = [...value, ...items.filter((c) => !value.includes(c))];
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-2 py-1.5 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-500/20 dark:border-zinc-700 dark:bg-zinc-950">
      {value.map((v, i) => (
        <span key={`${v}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-violet-50 px-2 py-0.5 text-sm text-violet-800 dark:bg-violet-950/70 dark:text-violet-200">
          <span className="truncate">
            {hashtag && "#"}
            {v}
          </span>
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-violet-500 hover:text-violet-900 dark:hover:text-white" aria-label={`Remove ${v}`}>
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft && add(draft)}
        onPaste={(e) => {
          const t = e.clipboardData.getData("text");
          if (/[,\n]/.test(t)) {
            e.preventDefault();
            add(t);
          }
        }}
        placeholder={value.length ? "" : placeholder ?? "Type and press Enter"}
        className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-zinc-400"
      />
    </div>
  );
}

export function CopyButton({ text, label = "Copy", size = "sm" }: { text: string; label?: string; size?: "sm" | "md" }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      variant="secondary"
      icon={done ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx("h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800", className)}>
      <div className="brand-gradient h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(3, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-lg px-3 py-1.5 text-sm font-medium transition",
            value === o.value ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FilterChip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition",
        active ? "border-violet-600 bg-violet-600 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
      )}
    >
      {children}
      {count !== undefined && <span className={cx("rounded-full px-1.5 text-xs", active ? "bg-white/25" : "bg-zinc-100 dark:bg-zinc-800")}>{count}</span>}
    </button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold">{children}</h2>
      {right}
    </div>
  );
}
