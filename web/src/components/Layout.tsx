import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  Bot, Brain, CalendarDays, Check, ChevronDown, ClipboardCheck, Heart, Home, LayoutGrid, Menu, MessageSquareReply, Moon,
  Palette, Pin, Plus, Radar, Rocket, Scissors, Settings, Sparkles, Store, Sun, Wand2, X, Zap,
} from "lucide-react";
import { Instagram } from "./icons";
import { api, mockEnabled } from "../lib/api";
import { cx } from "../lib/format";
import { useBrands } from "../state/brand";
import { useTheme } from "../state/theme";
import { AssistantLauncher } from "./chat/Assistant";

type NavItem = { to: string; label: string; icon: ReactNode };
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Create",
    items: [
      { to: "/", label: "Home", icon: <Home className="size-4" /> },
      { to: "/assistant", label: "Assistant", icon: <Sparkles className="size-4" /> },
      { to: "/brain", label: "Brand Brain", icon: <Brain className="size-4" /> },
      { to: "/audit", label: "Audit", icon: <ClipboardCheck className="size-4" /> },
      { to: "/plan", label: "Plan my week", icon: <Wand2 className="size-4" /> },
      { to: "/autopilot", label: "Autopilot", icon: <Rocket className="size-4" /> },
      { to: "/clips", label: "Clips", icon: <Scissors className="size-4" /> },
      { to: "/etsy", label: "Etsy shop", icon: <Store className="size-4" /> },
    ],
  },
  {
    group: "Publish",
    items: [
      { to: "/approve", label: "Approve", icon: <Heart className="size-4" /> },
      { to: "/library", label: "Library", icon: <LayoutGrid className="size-4" /> },
      { to: "/calendar", label: "Calendar", icon: <CalendarDays className="size-4" /> },
      { to: "/styles", label: "Styles", icon: <Palette className="size-4" /> },
    ],
  },
  {
    group: "Grow",
    items: [
      { to: "/research", label: "Market research", icon: <Radar className="size-4" /> },
      { to: "/automations", label: "Automations", icon: <MessageSquareReply className="size-4" /> },
      { to: "/instagram", label: "Instagram", icon: <Instagram className="size-4" /> },
      { to: "/pinterest", label: "Pinterest", icon: <Pin className="size-4" /> },
    ],
  },
  {
    group: "Setup",
    items: [
      { to: "/claude", label: "Use in Claude", icon: <Bot className="size-4" /> },
      { to: "/settings", label: "Settings", icon: <Settings className="size-4" /> },
    ],
  },
];
const MOBILE_TABS: NavItem[] = [
  { to: "/", label: "Home", icon: <Home className="size-5" /> },
  { to: "/approve", label: "Approve", icon: <Heart className="size-5" /> },
  { to: "/library", label: "Library", icon: <LayoutGrid className="size-5" /> },
  { to: "/calendar", label: "Calendar", icon: <CalendarDays className="size-5" /> },
];

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="brand-gradient flex size-8 items-center justify-center rounded-xl text-white shadow-md shadow-fuchsia-500/25">
        <Zap className="size-4.5" fill="currentColor" />
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="text-sm font-bold tracking-tight">Social MCP Studio</div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">AI social autopilot</div>
        </div>
      )}
    </div>
  );
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{g.group}</div>
          <div className="flex flex-col gap-0.5">
            {g.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === "/"}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cx(
                    "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition",
                    isActive
                      ? "bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-200"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100",
                  )
                }
              >
                {it.icon}
                {it.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function BrandAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  return <div className={cx("brand-gradient flex shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white", className ?? "size-7")}>{initials || "?"}</div>;
}

function BrandSwitcher() {
  const { brands, brand, setBrandId } = useBrands();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 max-w-[15rem] items-center gap-2 rounded-xl border border-zinc-200 bg-white pl-1.5 pr-2.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 sm:max-w-xs"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {brand ? <BrandAvatar name={brand.name} /> : <div className="size-7 rounded-lg bg-zinc-200 dark:bg-zinc-700" />}
        <span className="truncate">{brand?.name ?? "No brand yet"}</span>
        <ChevronDown className="size-4 shrink-0 text-zinc-400" />
      </button>
      {open && (
        <div className="toast-in absolute left-0 z-40 mt-2 w-72 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900" role="listbox">
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Brands</div>
          {brands.length === 0 && <div className="px-2.5 py-2 text-sm text-zinc-500">No brands yet</div>}
          {brands.map((b) => (
            <button
              key={b.id}
              role="option"
              aria-selected={b.id === brand?.id}
              onClick={() => {
                setBrandId(b.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <BrandAvatar name={b.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{b.name}</div>
                <div className="truncate text-xs text-zinc-500">{b.instagramHandle ? `@${b.instagramHandle.replace(/^@/, "")}` : b.website ?? "—"}</div>
              </div>
              {b.id === brand?.id && <Check className="size-4 text-violet-600" />}
            </button>
          ))}
          <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
          <button
            onClick={() => {
              setOpen(false);
              nav("/new");
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/50"
          >
            <Plus className="size-4" /> Add a brand
          </button>
        </div>
      )}
    </div>
  );
}

function ServerBanner() {
  const { error, refresh } = useBrands();
  const [down, setDown] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () =>
      api.health().then(
        () => alive && setDown(false),
        () => alive && setDown(true),
      );
    check();
    const t = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!down && !error) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">API server is not reachable.</span>
        <span>
          Start the server: <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs dark:bg-amber-900/60">npm run dev</code> in{" "}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs dark:bg-amber-900/60">server/</code> (or <code className="font-mono text-xs">npm run dev</code> in the project root).
        </span>
        <button onClick={() => refresh()} className="font-medium underline underline-offset-2">
          Retry
        </button>
      </div>
    </div>
  );
}

export function Layout() {
  const [drawer, setDrawer] = useState(false);
  const { theme, toggle } = useTheme();
  const loc = useLocation();
  const mock = mockEnabled();
  useEffect(() => setDrawer(false), [loc.pathname]);

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-zinc-200 bg-white/80 px-3 py-5 backdrop-blur lg:flex dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="px-2">
          <Logo />
        </div>
        <div className="mt-7 flex-1 overflow-y-auto">
          <SideNav />
        </div>
        <div className="mt-4 rounded-2xl bg-gradient-to-br from-violet-50 to-pink-50 p-3.5 text-xs text-zinc-700 dark:from-violet-950/50 dark:to-pink-950/30 dark:text-zinc-300">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <Sparkles className="size-3.5 text-fuchsia-500" /> Drive it from Claude
          </div>
          Connect the MCP server and ask Claude to plan, edit and approve posts for you.
          <NavLink to="/claude" className="mt-2 block font-semibold text-violet-700 dark:text-violet-300">
            Set it up →
          </NavLink>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-zinc-950/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-white px-3 py-5 dark:bg-zinc-900">
            <div className="mb-6 flex items-center justify-between px-2">
              <Logo />
              <button onClick={() => setDrawer(false)} className="rounded-lg p-1 text-zinc-500" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <SideNav onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
            <button onClick={() => setDrawer(true)} className="-ml-1 rounded-lg p-2 text-zinc-600 lg:hidden dark:text-zinc-300" aria-label="Open menu">
              <Menu className="size-5" />
            </button>
            <div className="lg:hidden">
              <Logo compact />
            </div>
            <BrandSwitcher />
            <div className="flex-1" />
            {mock && <span className="hidden rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 sm:inline dark:bg-amber-900/60 dark:text-amber-200">Mock data</span>}
            <NavLink to="/new" className="hidden sm:block">
              <span className="brand-gradient inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-medium text-white shadow-sm hover:brightness-110">
                <Plus className="size-4" /> New brand
              </span>
            </NavLink>
            <button
              onClick={toggle}
              className="flex size-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              aria-label="Toggle dark mode"
            >
              {theme === "dark" ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
            </button>
          </div>
        </header>
        <ServerBanner />
        <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12 lg:pt-8">
          <Outlet />
        </main>
      </div>

      <AssistantLauncher />

      {/* Mobile bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="grid grid-cols-5">
          {MOBILE_TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) => cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", isActive ? "text-violet-600 dark:text-violet-300" : "text-zinc-500")}
            >
              {t.icon}
              {t.label}
            </NavLink>
          ))}
          <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-zinc-500">
            <Menu className="size-5" />
            More
          </button>
        </div>
      </nav>
    </div>
  );
}

export { BrandAvatar };
