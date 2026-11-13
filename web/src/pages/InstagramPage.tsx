import { useState } from "react";
import { Link } from "react-router";
import { ExternalLink, Heart, KeyRound, LogOut, MessageCircle, Users } from "lucide-react";
import { Instagram } from "../components/icons";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useBrands } from "../state/brand";
import { useToast } from "../state/toast";
import { NeedBrand } from "../components/media";
import { Badge, Button, Card, Field, Input, PageHeader, Skeleton } from "../components/ui";

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value?: number }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm text-zinc-500">{icon}{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums">{value === undefined ? "—" : value.toLocaleString()}</div>
    </Card>
  );
}

function InstagramInner({ brandId }: { brandId: string }) {
  const { brand, upsert } = useBrands();
  const { fail, toast } = useToast();
  const connected = !!brand?.igConnected;
  const insights = useApi(() => api.igInsights(brandId), [brandId, connected], { enabled: connected });
  const [token, setToken] = useState("");
  const [igUserId, setIgUserId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const oauth = async () => {
    setBusy("oauth");
    try { const { url } = await api.igAuthUrl(brandId); window.location.href = url; } catch (e) { fail(e, "Couldn't start Instagram login"); setBusy(null); }
  };
  const paste = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("token");
    try { upsert(await api.igToken(brandId, token.trim(), igUserId.trim())); setToken(""); setIgUserId(""); toast("success", "Instagram connected"); } catch (err) { fail(err, "Token was not accepted"); } finally { setBusy(null); }
  };
  const disconnect = async () => {
    if (!confirm(`Disconnect Instagram from ${brand?.name}? Scheduled posts won't publish until you reconnect.`)) return;
    setBusy("disconnect");
    try { upsert(await api.igDisconnect(brandId)); toast("success", "Instagram disconnected"); } catch (e) { fail(e); } finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader icon={<Instagram className="size-5" />} title="Instagram" subtitle={`Connect ${brand?.name ?? "this brand"}'s Instagram professional account to auto-post and auto-reply.`} />
      {connected ? (
        <div className="space-y-6">
          <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 via-pink-500 to-violet-600 text-white"><Instagram className="size-6" /></div>
            <div className="flex-1">
              <div className="flex items-center gap-2 font-semibold">{brand?.instagramHandle ? `@${brand.instagramHandle.replace(/^@/, "")}` : "Instagram account"}<Badge tone="green">Connected</Badge></div>
              {brand?.igUserId && <div className="text-xs text-zinc-500">IG user id {brand.igUserId}</div>}
            </div>
            <Button variant="secondary" icon={<LogOut className="size-4" />} loading={busy === "disconnect"} onClick={disconnect}>Disconnect</Button>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            {insights.loading ? <><Skeleton className="h-24" /><Skeleton className="h-24" /></> : (
              <>
                <Stat icon={<Users className="size-4" />} label="Followers" value={insights.data?.followers} />
                <Stat icon={<Instagram className="size-4" />} label="Posts" value={insights.data?.mediaCount} />
              </>
            )}
          </div>
          {insights.error ? (
            <Card className="p-4 text-sm text-zinc-500">Couldn't load insights: {insights.error instanceof Error ? insights.error.message : "unknown error"}</Card>
          ) : null}
          {(insights.data?.recent?.length ?? 0) > 0 && (
            <Card className="overflow-hidden">
              <div className="border-b border-zinc-200 px-5 py-3 font-semibold dark:border-zinc-800">Recent posts</div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {insights.data!.recent.map((r) => (
                  <li key={r.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{r.caption || <span className="text-zinc-400">No caption</span>}</div>
                      <div className="text-xs text-zinc-500">{fmtDate(r.timestamp)}</div>
                    </div>
                    <span className="flex items-center gap-1 tabular-nums text-zinc-600 dark:text-zinc-400"><Heart className="size-4" />{r.likeCount}</span>
                    <span className="flex items-center gap-1 tabular-nums text-zinc-600 dark:text-zinc-400"><MessageCircle className="size-4" />{r.commentsCount}</span>
                    <a href={r.permalink} target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-violet-600" aria-label="Open on Instagram"><ExternalLink className="size-4" /></a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="flex flex-col p-6">
            <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 via-pink-500 to-violet-600 text-white"><Instagram className="size-6" /></div>
            <h2 className="text-lg font-semibold">Connect with Instagram</h2>
            <p className="mt-1 flex-1 text-sm text-zinc-600 dark:text-zinc-400">
              Log in with Instagram and allow publishing, comments and messages. Needs a Business or Creator account and your Instagram App ID & secret in <Link to="/settings" className="font-medium text-violet-600 dark:text-violet-300">Settings</Link>.
            </p>
            <Button variant="primary" size="lg" className="mt-5" loading={busy === "oauth"} icon={<Instagram className="size-4" />} onClick={oauth}>Connect with Instagram</Button>
          </Card>
          <Card className="p-6">
            <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"><KeyRound className="size-6" /></div>
            <h2 className="text-lg font-semibold">Or paste a long-lived token</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Generated in the Meta developer dashboard. Stored locally on this computer and never shown again.</p>
            <form onSubmit={paste} className="mt-4 space-y-3">
              <Field label="Access token"><Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="IGAA…" /></Field>
              <Field label="IG user id" hint="Optional — we'll look it up"><Input value={igUserId} onChange={(e) => setIgUserId(e.target.value)} /></Field>
              <Button type="submit" disabled={!token.trim()} loading={busy === "token"}>Save token</Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function InstagramPage() {
  return <NeedBrand>{(id) => <InstagramInner key={id} brandId={id} />}</NeedBrand>;
}
