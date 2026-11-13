import { useState } from "react";
import { Link } from "react-router";
import { Check, MessageCircle, MessageSquareReply, Pencil, Plus, RefreshCw, Send, Trash2, X } from "lucide-react";
import { Instagram } from "../components/icons";
import { api, type AutomationInput } from "../lib/api";
import { relTime } from "../lib/format";
import type { Automation } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useBrands } from "../state/brand";
import { useToast } from "../state/toast";
import { NeedBrand } from "../components/media";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea, Toggle } from "../components/ui";

const BLANK: AutomationInput = { keyword: "", replyText: "Just sent you a DM! 📩", dmText: "", link: "", postId: "", enabled: true };

function RuleModal({ brandId, rule, onClose, onSaved }: { brandId: string; rule: Automation | "new" | null; onClose: () => void; onSaved: (a: Automation) => void }) {
  const { fail } = useToast();
  const posts = useApi(() => api.posts({ brandId }), [brandId], { enabled: !!rule });
  const [f, setF] = useState<AutomationInput>(() => (rule && rule !== "new" ? { keyword: rule.keyword, replyText: rule.replyText, dmText: rule.dmText, link: rule.link ?? "", postId: rule.postId ?? "", enabled: rule.enabled } : BLANK));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const body = { ...f, keyword: f.keyword.trim().toUpperCase(), link: f.link?.trim() || undefined, postId: f.postId || undefined };
    try {
      onSaved(rule && rule !== "new" ? await api.updateAutomation(rule.id, body) : await api.createAutomation(brandId, body));
      onClose();
    } catch (e) { fail(e, "Couldn't save automation"); } finally { setBusy(false); }
  };
  return (
    <Modal
      open={!!rule}
      onClose={onClose}
      title={rule === "new" ? "New comment → DM rule" : "Edit rule"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.keyword.trim() || !f.dmText.trim() || !f.replyText.trim()} onClick={save}>Save rule</Button></>}
    >
      <div className="space-y-4">
        <Field label="When someone comments" hint="Case-insensitive keyword match">
          <Input value={f.keyword} onChange={(e) => setF({ ...f, keyword: e.target.value.toUpperCase() })} placeholder="GROW" className="font-semibold tracking-wide" />
        </Field>
        <Field label="Reply publicly with"><Input value={f.replyText} onChange={(e) => setF({ ...f, replyText: e.target.value })} /></Field>
        <Field label="And send this DM"><Textarea value={f.dmText} onChange={(e) => setF({ ...f, dmText: e.target.value })} placeholder="Here's your free guide 👇" /></Field>
        <Field label="Link in the DM" hint="Optional"><Input value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://…" inputMode="url" /></Field>
        <Field label="Only on this post">
          <Select value={f.postId} onChange={(e) => setF({ ...f, postId: e.target.value })}>
            <option value="">All posts</option>
            {(posts.data ?? []).filter((p) => p.status === "posted" || p.status === "approved").map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </Select>
        </Field>
        <div className="flex items-center justify-between"><span className="text-sm font-medium">Enabled</span><Toggle checked={!!f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Enabled" /></div>
      </div>
    </Modal>
  );
}

function AutomationsInner({ brandId }: { brandId: string }) {
  const { brand } = useBrands();
  const { fail, toast } = useToast();
  const rules = useApi(() => api.automations(brandId), [brandId]);
  const log = useApi(() => api.comments(brandId), [brandId], { poll: () => 30000 });
  const [edit, setEdit] = useState<Automation | "new" | null>(null);

  const upsert = (a: Automation) => rules.setData((l) => (l?.some((x) => x.id === a.id) ? l.map((x) => (x.id === a.id ? a : x)) : [...(l ?? []), a]));
  const toggle = async (a: Automation) => {
    upsert({ ...a, enabled: !a.enabled });
    try { upsert(await api.updateAutomation(a.id, { enabled: !a.enabled })); } catch (e) { upsert(a); fail(e); }
  };
  const remove = async (a: Automation) => {
    if (!confirm(`Delete the "${a.keyword}" rule?`)) return;
    try { await api.deleteAutomation(a.id); rules.setData((l) => (l ?? []).filter((x) => x.id !== a.id)); toast("success", "Rule deleted"); } catch (e) { fail(e); }
  };

  return (
    <div>
      <PageHeader
        icon={<MessageSquareReply className="size-5" />}
        title="Automations"
        subtitle="When someone comments a keyword, reply to them and send a DM with your link — automatically."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit("new")}>New rule</Button>}
      />
      {brand && !brand.igConnected && (
        <Card className="mb-6 flex flex-col gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <Instagram className="size-5 shrink-0" />
          <div className="flex-1">Connect Instagram for {brand.name} so we can watch comments (checked every 2 minutes).</div>
          <Link to="/instagram"><Button size="sm">Connect Instagram</Button></Link>
        </Card>
      )}

      {rules.loading ? (
        <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      ) : (rules.data?.length ?? 0) === 0 ? (
        <EmptyState icon={<MessageCircle className="size-6" />} title="No rules yet" action={<Button variant="primary" onClick={() => setEdit("new")}>Create your first rule</Button>}>
          Example: comment <b>GROW</b> → we reply “Check your DMs!” and send the free guide link.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rules.data!.map((a) => (
            <Card key={a.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-500">Comment keyword</div>
                  <div className="mt-0.5 inline-block rounded-lg bg-violet-100 px-2.5 py-1 font-mono text-lg font-bold tracking-wide text-violet-800 dark:bg-violet-950 dark:text-violet-200">{a.keyword}</div>
                </div>
                <Toggle checked={a.enabled} onChange={() => toggle(a)} label={`Enable ${a.keyword}`} />
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex gap-2"><MessageCircle className="mt-0.5 size-4 shrink-0 text-zinc-400" /><span>{a.replyText}</span></div>
                <div className="flex gap-2"><Send className="mt-0.5 size-4 shrink-0 text-zinc-400" /><span className="line-clamp-3">{a.dmText}{a.link && <span className="block truncate text-violet-600 dark:text-violet-300">{a.link}</span>}</span></div>
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <Badge tone={a.enabled ? "green" : "gray"}>{a.enabled ? "Active" : "Paused"}</Badge>
                {a.postId && <Badge tone="blue">One post</Badge>}
                <div className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => setEdit(a)} aria-label="Edit"><Pencil className="size-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(a)} aria-label="Delete"><Trash2 className="size-4 text-rose-500" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Comment log</h2>
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => log.reload()}>Refresh</Button>
        </div>
        <Card className="overflow-hidden">
          {log.loading ? (
            <div className="p-4"><Skeleton className="h-24" /></div>
          ) : (log.data?.length ?? 0) === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-500">No comments seen yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">When</th>
                    <th className="px-4 py-2.5 font-semibold">User</th>
                    <th className="px-4 py-2.5 font-semibold">Comment</th>
                    <th className="px-4 py-2.5 font-semibold">Keyword</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Replied</th>
                    <th className="px-4 py-2.5 text-center font-semibold">DM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {log.data!.map((c) => (
                    <tr key={c.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-2.5 text-zinc-500">{relTime(c.createdAt)}</td>
                      <td className="px-4 py-2.5 font-medium">@{c.username}</td>
                      <td className="px-4 py-2.5">{c.text}{c.error && <div className="text-xs text-rose-600">{c.error}</div>}</td>
                      <td className="px-4 py-2.5">{c.matchedKeyword ? <Badge tone="violet">{c.matchedKeyword}</Badge> : <span className="text-zinc-400">—</span>}</td>
                      <td className="px-4 py-2.5 text-center">{c.replied ? <Check className="mx-auto size-4 text-emerald-500" /> : <X className="mx-auto size-4 text-zinc-300" />}</td>
                      <td className="px-4 py-2.5 text-center">{c.dmSent ? <Check className="mx-auto size-4 text-emerald-500" /> : <X className="mx-auto size-4 text-zinc-300" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {edit && <RuleModal key={edit === "new" ? "new" : edit.id} brandId={brandId} rule={edit} onClose={() => setEdit(null)} onSaved={upsert} />}
    </div>
  );
}

export default function AutomationsPage() {
  return <NeedBrand>{(id) => <AutomationsInner key={id} brandId={id} />}</NeedBrand>;
}
