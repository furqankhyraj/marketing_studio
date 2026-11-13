import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CheckCircle2, ClipboardCheck, Film, Lightbulb, Loader2, Sparkles, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";
import type { Audit } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useBrands } from "../state/brand";
import { useToast } from "../state/toast";
import { NeedBrand } from "../components/media";
import { Button, Card, EmptyState, PageHeader, Progress, Select, Skeleton } from "../components/ui";

function Running() {
  const [t, setT] = useState(0);
  useEffect(() => { const i = setInterval(() => setT((x) => x + 1), 500); return () => clearInterval(i); }, []);
  const msgs = ["Looking at your recent posts", "Comparing with your niche", "Spotting quick wins", "Choosing your first 3 reels"];
  return (
    <Card className="p-6">
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 animate-spin text-violet-500" />
        <div className="font-semibold">{msgs[Math.min(msgs.length - 1, Math.floor(t / 14))]}…</div>
      </div>
      <Progress value={Math.min(0.95, t / 70)} className="mt-4" />
      <p className="mt-2 text-xs text-zinc-500">An audit takes about 30 seconds.</p>
    </Card>
  );
}

function List({ items, icon, title, tone }: { items: string[]; icon: React.ReactNode; title: string; tone: string }) {
  return (
    <Card className="p-5">
      <h3 className="mb-3 font-semibold">{title}</h3>
      {items.length === 0 ? <p className="text-sm text-zinc-500">Nothing here.</p> : (
        <ul className="space-y-2.5">
          {items.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span className={`mt-0.5 shrink-0 ${tone}`}>{icon}</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AuditView({ audit }: { audit: Audit }) {
  return (
    <div className="space-y-6">
      <Card className="relative overflow-hidden p-6">
        <div className="brand-gradient absolute inset-x-0 top-0 h-1" />
        <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Summary · {fmtDate(audit.createdAt)}</div>
        <p className="mt-2 text-lg leading-relaxed">{audit.summary}</p>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <List title="What you do well" items={audit.strengths} icon={<CheckCircle2 className="size-4" />} tone="text-emerald-500" />
        <List title="What holds you back" items={audit.weaknesses} icon={<XCircle className="size-4" />} tone="text-rose-500" />
        <List title="Opportunities" items={audit.opportunities} icon={<Lightbulb className="size-4" />} tone="text-amber-500" />
      </div>
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your first 3 reels</h2>
          <Link to="/plan"><Button variant="primary" size="sm" icon={<Sparkles className="size-4" />}>Make them</Button></Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {audit.firstReels.map((r, i) => (
            <Card key={i} className="flex flex-col p-5">
              <div className="mb-3 flex items-center gap-2">
                <div className="brand-gradient flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white">{i + 1}</div>
                <Film className="size-4 text-zinc-400" />
              </div>
              <h3 className="font-semibold">{r.title}</h3>
              <p className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-sm font-medium text-violet-800 dark:bg-violet-950/50 dark:text-violet-200">“{r.hook}”</p>
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{r.why}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function AuditInner({ brandId }: { brandId: string }) {
  const { brand } = useBrands();
  const { fail, toast } = useToast();
  const q = useApi(() => api.audits(brandId), [brandId]);
  const [running, setRunning] = useState(false);
  const [sel, setSel] = useState<string>("");
  const audits = q.data ?? [];
  const audit = audits.find((a) => a.id === sel) ?? audits[0];

  const run = async () => {
    setRunning(true);
    try {
      const a = await api.runAudit(brandId);
      q.setData([a, ...audits]);
      setSel(a.id);
      toast("success", "Audit complete");
    } catch (e) { fail(e, "Audit failed"); } finally { setRunning(false); }
  };

  return (
    <div>
      <PageHeader
        icon={<ClipboardCheck className="size-5" />}
        title="Growth audit"
        subtitle={`An honest look at ${brand?.name ?? "your brand"}'s Instagram — and what to post first.`}
        actions={
          <>
            {audits.length > 1 && (
              <Select value={audit?.id} onChange={(e) => setSel(e.target.value)} className="w-auto">
                {audits.map((a) => <option key={a.id} value={a.id}>{fmtDate(a.createdAt)}</option>)}
              </Select>
            )}
            <Button variant="primary" loading={running} icon={<Sparkles className="size-4" />} onClick={run}>
              {audits.length ? "Run new audit" : "Run audit"}
            </Button>
          </>
        }
      />
      {running && <div className="mb-6"><Running /></div>}
      {q.loading ? (
        <div className="space-y-4"><Skeleton className="h-28" /><div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div></div>
      ) : audit ? (
        <AuditView audit={audit} />
      ) : !running && (
        <EmptyState icon={<ClipboardCheck className="size-6" />} title="No audit yet" action={<Button variant="primary" onClick={run}>Run my first audit</Button>}>
          We'll review your account and brand, list strengths and weaknesses, and pick the first 3 reels to make.
        </EmptyState>
      )}
    </div>
  );
}

export default function AuditPage() {
  return <NeedBrand>{(id) => <AuditInner key={id} brandId={id} />}</NeedBrand>;
}
