import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, BarChart3, Check, ExternalLink, Eye, Flame, Globe, Megaphone, Play, Radar, Sparkles, Target, Trash2 } from "lucide-react";
import { Instagram as InstagramIcon } from "../components/icons";
import type { AdCreative, AdPlatform, Competitor, ResearchJob, ResearchReport } from "../lib/types";
import { researchApi } from "../lib/researchApi";
import { fmtDateTime, relTime } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useBrands } from "../state/brand";
import { useToast } from "../state/toast";
import { NeedBrand } from "../components/media";
import { Badge, Button, Card, CopyButton, Field, FilterChip, Input, PageHeader, Progress, Segmented, Select, Skeleton, Toggle } from "../components/ui";

const COUNTRIES = ["US", "GB", "CA", "AU", "DE", "FR", "AE", "SA", "PK", "IN", "ALL"];
const PLAT: { id: AdPlatform; label: string }[] = [
  { id: "meta", label: "Meta (FB/IG)" },
  { id: "google", label: "Google / YouTube" },
  { id: "tiktok", label: "TikTok" },
];
const num = (n?: number) => (n === undefined || n === null ? "—" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

function AdCard({ ad, who }: { ad: AdCreative; who?: string }) {
  const media = ad.previewUrl || ad.imageUrl;
  return (
    <Card className="flex gap-3 p-3">
      <div className="size-24 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
        {media ? <img src={media} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <div className="flex size-full items-center justify-center text-xs text-zinc-400">{ad.format}</div>}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <Badge tone={ad.platform === "meta" ? "blue" : ad.platform === "google" ? "green" : "pink"}>{ad.platform}</Badge>
          <Badge tone="gray">{ad.format}</Badge>
          {ad.active ? <Badge tone="green">active</Badge> : null}
          {ad.daysRunning !== undefined ? <span className="text-zinc-500">{ad.daysRunning} days</span> : null}
          {who ? <span className="truncate text-zinc-500">· {who}</span> : null}
        </div>
        {ad.headline ? <div className="line-clamp-1 text-sm font-semibold">{ad.headline}</div> : null}
        <div className="line-clamp-3 text-sm text-zinc-700 dark:text-zinc-300">{ad.body || "(no text)"}</div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {ad.cta ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium dark:bg-zinc-800">{ad.cta}</span> : null}
          {ad.link ? <a href={ad.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline"><ExternalLink className="size-3" />{ad.landingDomain ?? "link"}</a> : null}
          {ad.videoUrl ? <a href={ad.videoUrl} target="_blank" rel="noreferrer" className="hover:underline">video</a> : null}
        </div>
      </div>
    </Card>
  );
}

function CompetitorCard({ c }: { c: Competitor }) {
  const [open, setOpen] = useState(false);
  const ads = Object.values(c.ads ?? {}).filter((a): a is NonNullable<typeof a> => !!a);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <a href={c.website} target="_blank" rel="noreferrer" className="truncate text-lg font-bold hover:underline">{c.name}</a>
            <Badge tone="gray">{c.kind}</Badge>
            <span className="text-xs text-zinc-500">{Math.round(c.relevance * 100)}% match</span>
          </div>
          <div className="text-xs text-zinc-500">{c.domain}{c.why ? ` · ${c.why}` : ""}</div>
        </div>
        <div className="flex gap-4 text-center text-sm">
          <div><div className="text-xl font-bold">{c.adsTotal}</div><div className="text-xs text-zinc-500">ads</div></div>
          <div><div className="text-xl font-bold text-emerald-600">{c.adsActive}</div><div className="text-xs text-zinc-500">active</div></div>
          {c.social ? (
            <>
              <div><div className="text-xl font-bold">{num(c.social.followers)}</div><div className="text-xs text-zinc-500">followers</div></div>
              <div><div className="text-xl font-bold">{c.social.engagementRate ?? "—"}{c.social.engagementRate !== undefined ? "%" : ""}</div><div className="text-xs text-zinc-500">engagement</div></div>
              <div><div className="text-xl font-bold">{c.social.postsPerWeek ?? "—"}</div><div className="text-xs text-zinc-500">posts/wk</div></div>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {ads.map((a) => (
          <Badge key={a.platform} tone={a.error ? "red" : a.total ? "violet" : "gray"}>{a.platform}: {a.error ? "unavailable" : `${a.total} ads, ${a.active} active${a.newLast30d ? `, ${a.newLast30d} new` : ""}`}</Badge>
        ))}
        {c.social?.username ? <a href={c.social.url} target="_blank" rel="noreferrer"><Badge tone="pink"><InstagramIcon className="mr-1 inline size-3" />@{c.social.username}</Badge></a> : null}
        {c.profile?.blocked ? <Badge tone="amber">site blocked bots</Badge> : null}
      </div>
      {ads.some((a) => a.hooks.length) ? (
        <div className="mt-3 space-y-1 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Their hooks</div>
          <ul className="list-disc space-y-0.5 pl-5">{ads.flatMap((a) => a.hooks.slice(0, 3)).slice(0, 5).map((h, i) => <li key={i}>{h}</li>)}</ul>
        </div>
      ) : null}
      <div className="mt-3"><Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Hide details" : "Details, winning ads"}</Button></div>
      {open ? (
        <div className="mt-3 space-y-4 border-t pt-3 text-sm dark:border-zinc-800">
          {c.profile ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><div className="text-xs font-semibold uppercase text-zinc-500">Sells</div><div>{c.profile.products.slice(0, 8).join(" · ") || "—"}</div></div>
              <div><div className="text-xs font-semibold uppercase text-zinc-500">Prices</div><div>{c.profile.prices.slice(0, 8).join(" · ") || "—"}</div></div>
              <div><div className="text-xs font-semibold uppercase text-zinc-500">Offers</div><div>{c.profile.offers.join(" · ") || "—"}</div></div>
              <div><div className="text-xs font-semibold uppercase text-zinc-500">Site CTAs</div><div>{c.profile.ctas.join(" · ") || "—"}</div></div>
              {c.social?.topHashtags?.length ? <div><div className="text-xs font-semibold uppercase text-zinc-500">Top hashtags</div><div>{c.social.topHashtags.map((h) => `#${h}`).join(" ")}</div></div> : null}
              {c.social?.bestPost ? <div><div className="text-xs font-semibold uppercase text-zinc-500">Best recent post</div><a href={c.social.bestPost.url} target="_blank" rel="noreferrer" className="hover:underline">{c.social.bestPost.caption.slice(0, 120) || "(no caption)"} · {num(c.social.bestPost.likes)} likes</a></div> : null}
            </div>
          ) : null}
          {ads.map((a) =>
            a.longestRunning.length || a.samples.length ? (
              <div key={a.platform} className="space-y-2">
                <div className="text-xs font-semibold uppercase text-zinc-500">{a.platform}: longest-running (their winners)</div>
                <div className="grid gap-2 md:grid-cols-2">{(a.longestRunning.length ? a.longestRunning : a.samples).slice(0, 4).map((ad) => <AdCard key={ad.id} ad={ad} />)}</div>
              </div>
            ) : null,
          )}
        </div>
      ) : null}
    </Card>
  );
}

function StrategyView({ r }: { r: ResearchReport }) {
  const s = r.strategy;
  const Sec = ({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) => (
    <Card className="space-y-3 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">{icon}{title}</div>
      {children}
    </Card>
  );
  return (
    <div className="space-y-4">
      {r.llm === "none" ? (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"><AlertTriangle className="size-4 shrink-0" />This is the rule-based strategy. Add a Claude subscription token or API key in Settings for a written one.</div>
      ) : null}
      <Sec title="Summary" icon={<Sparkles className="size-4" />}><p className="whitespace-pre-line text-[15px] leading-relaxed">{s.summary}</p></Sec>
      <div className="grid gap-4 lg:grid-cols-2">
        <Sec title="Positioning" icon={<Target className="size-4" />}>
          <p className="text-lg font-semibold">{s.positioning.statement}</p>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <div><div className="mb-1 font-semibold">What sets you apart</div><ul className="list-disc space-y-1 pl-5">{s.positioning.differentiators.map((d, i) => <li key={i}>{d}</li>)}</ul></div>
            <div><div className="mb-1 font-semibold">Gaps vs competitors</div><ul className="list-disc space-y-1 pl-5">{s.positioning.gaps.map((d, i) => <li key={i}>{d}</li>)}</ul></div>
          </div>
        </Sec>
        <Sec title="Audience" icon={<Eye className="size-4" />}>
          <div className="space-y-2 text-sm">{s.audience.segments.map((a, i) => <div key={i}><span className="font-semibold">{a.name}</span> — {a.pain} <span className="text-zinc-500">· buys when: {a.trigger}</span></div>)}</div>
        </Sec>
      </div>
      <Sec title="Messaging" icon={<Flame className="size-4" />}>
        <div className="grid gap-4 md:grid-cols-3 text-sm">
          <div><div className="mb-1 font-semibold">Hooks</div><ul className="space-y-1">{s.messaging.hooks.map((h, i) => <li key={i} className="flex items-start gap-2"><span>“{h}”</span><CopyButton text={h} label="" /></li>)}</ul></div>
          <div><div className="mb-1 font-semibold">Offers</div><ul className="list-disc space-y-1 pl-5">{s.messaging.offers.map((h, i) => <li key={i}>{h}</li>)}</ul><div className="mb-1 mt-3 font-semibold">CTAs</div><div className="flex flex-wrap gap-1">{s.messaging.ctas.map((c, i) => <Badge key={i} tone="violet">{c}</Badge>)}</div></div>
          <div><div className="mb-1 font-semibold">Avoid claiming</div><ul className="list-disc space-y-1 pl-5">{s.messaging.claimsToAvoid.map((h, i) => <li key={i}>{h}</li>)}</ul></div>
        </div>
      </Sec>
      <Sec title="Content plan" icon={<BarChart3 className="size-4" />}>
        <p className="text-sm">{s.content.cadence}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{s.content.pillars.map((p, i) => <div key={i} className="rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900"><div className="font-semibold">{p.name}</div><div className="text-zinc-600 dark:text-zinc-400">{p.why}</div><div className="mt-1 text-xs text-zinc-500">{p.formats.join(" · ")}</div></div>)}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-zinc-500"><th className="py-1 pr-2">Day</th><th className="py-1 pr-2">Type</th><th className="py-1 pr-2">Pillar</th><th className="py-1">Hook</th></tr></thead>
            <tbody>{s.content.plan30.map((p, i) => <tr key={i} className="border-t dark:border-zinc-800"><td className="py-1.5 pr-2 tabular-nums">{p.day}</td><td className="py-1.5 pr-2 capitalize">{p.type}</td><td className="py-1.5 pr-2 text-zinc-500">{p.pillar}</td><td className="py-1.5">{p.hook}{p.notes ? <span className="text-zinc-500"> — {p.notes}</span> : null}</td></tr>)}</tbody>
          </table>
        </div>
      </Sec>
      <Sec title="Paid ads" icon={<Megaphone className="size-4" />}>
        <p className="text-sm"><Badge tone={s.ads.recommended ? "green" : "gray"}>{s.ads.recommended ? "Recommended" : "Not yet"}</Badge> {s.ads.why}</p>
        <div className="flex flex-wrap gap-2">{s.ads.channels.map((c, i) => <div key={i} className="rounded-xl bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900"><span className="font-semibold">{c.platform} {c.budgetShare}%</span> <span className="text-zinc-500">· {c.why}</span></div>)}</div>
        <div className="grid gap-2 md:grid-cols-2">{s.ads.concepts.map((c, i) => <div key={i} className="rounded-xl border p-3 text-sm dark:border-zinc-800"><div className="flex items-center justify-between"><span className="font-semibold">{c.name}</span><Badge tone="gray">{c.format}</Badge></div><div className="mt-1">“{c.hook}”</div><div className="text-zinc-600 dark:text-zinc-400">{c.angle}</div><div className="mt-1 text-xs text-zinc-500">{c.cta} → {c.landing}</div></div>)}</div>
        <ol className="list-decimal space-y-1 pl-5 text-sm">{s.ads.testPlan.map((t, i) => <li key={i}>{t}</li>)}</ol>
      </Sec>
      <div className="grid gap-4 lg:grid-cols-3">
        <Sec title="Quick wins this week"><ul className="space-y-1 text-sm">{s.quickWins.map((q, i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{q}</li>)}</ul></Sec>
        <Sec title="Search keywords to own"><div className="flex flex-wrap gap-1">{s.seo.keywords.map((k, i) => <Badge key={i} tone="sky">{k}</Badge>)}</div>{s.seo.notes.length ? <ul className="list-disc pl-5 text-sm">{s.seo.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}</Sec>
        <Sec title="KPIs"><ul className="space-y-1 text-sm">{s.kpis.map((k, i) => <li key={i}><span className="font-semibold">{k.name}:</span> {k.target}</li>)}</ul>{s.risks.length ? <><div className="mt-2 text-xs font-semibold uppercase text-zinc-500">Risks</div><ul className="list-disc pl-5 text-sm">{s.risks.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null}</Sec>
      </div>
    </div>
  );
}

function ReportView({ r, onDeleted }: { r: ResearchReport; onDeleted: () => void }) {
  const { toast, fail } = useToast();
  const [tab, setTab] = useState<"strategy" | "competitors" | "ads" | "market">("strategy");
  const [plat, setPlat] = useState<AdPlatform | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const allAds = useMemo(() => r.competitors.flatMap((c) => Object.values(c.ads ?? {}).flatMap((a) => (a ? a.samples.map((ad) => ({ ad, who: c.name })) : []))).sort((a, b) => (b.ad.daysRunning ?? 0) - (a.ad.daysRunning ?? 0)), [r]);
  const [md, setMd] = useState("");
  useEffect(() => {
    fetch(researchApi.markdownUrl(r.id)).then((x) => x.text()).then(setMd).catch(() => setMd(""));
  }, [r.id]);
  const apply = async () => {
    setBusy("apply");
    try {
      await researchApi.apply(r.id);
      toast("success", "Brand Brain updated with competitors, keywords and pillars");
    } catch (e) {
      fail(e, "Couldn't apply");
    } finally {
      setBusy(null);
    }
  };
  const totalAds = r.competitors.reduce((n, c) => n + c.adsTotal, 0);
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="font-semibold">{r.brandSnapshot.name} · {r.website}</div>
          <div className="text-xs text-zinc-500">{fmtDateTime(r.createdAt)} · {r.competitors.length} competitors · {totalAds} competitor ads{r.brandSnapshot.adsTotal ? ` · you: ${r.brandSnapshot.adsTotal} ads` : " · you: no ads found"}{r.costUsd ? ` · Apify $${r.costUsd.toFixed(2)}` : ""} · strategy by {r.llm === "none" ? "rules" : "Claude"}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" loading={busy === "apply"} onClick={apply}>Apply to Brand Brain</Button>
          {md ? <CopyButton text={md} label="Copy as text" /> : null}
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={async () => { await researchApi.remove(r.id); onDeleted(); }} />
        </div>
      </Card>
      <Segmented value={tab} onChange={setTab} options={[{ value: "strategy", label: "Strategy" }, { value: "competitors", label: `Competitors (${r.competitors.length})` }, { value: "ads", label: `Ads (${allAds.length})` }, { value: "market", label: "Market" }]} />
      {tab === "strategy" ? <StrategyView r={r} /> : null}
      {tab === "competitors" ? <div className="space-y-3">{r.competitors.map((c) => <CompetitorCard key={c.id} c={c} />)}{!r.competitors.length ? <Card className="p-6 text-sm text-zinc-500">No competitors found. Add some with "Always include" and run again.</Card> : null}</div> : null}
      {tab === "ads" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">{(["all", "meta", "google", "tiktok"] as const).map((p) => <FilterChip key={p} active={plat === p} onClick={() => setPlat(p)} count={p === "all" ? allAds.length : allAds.filter((x) => x.ad.platform === p).length}>{p}</FilterChip>)}</div>
          <div className="grid gap-2 md:grid-cols-2">{allAds.filter((x) => plat === "all" || x.ad.platform === plat).map((x) => <AdCard key={`${x.ad.platform}-${x.ad.id}`} ad={x.ad} who={x.who} />)}</div>
          {!allAds.length ? <Card className="p-6 text-sm text-zinc-500">No ads found. {r.options.platforms?.length ? "These competitors don't appear in the ad libraries, or the Apify token is missing." : "No ad libraries were selected."}</Card> : null}
        </div>
      ) : null}
      {tab === "market" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-2 p-4 text-sm">
            <div className="font-semibold">Who ranks for your customers' searches</div>
            {r.landscape.serp.map((s, i) => <div key={i}><span className="font-medium">{s.query}</span><div className="text-zinc-500">{s.topDomains.join(" · ") || "no data"}</div></div>)}
          </Card>
          <Card className="space-y-3 p-4 text-sm">
            <div className="font-semibold">Ad landscape</div>
            {r.landscape.adSummary.map((a) => <div key={a.platform}><span className="font-medium capitalize">{a.platform}</span>: {a.competitorsAdvertising}/{r.competitors.length} competitors advertise · {a.totalAds} ads ({a.activeAds} active) · {a.topFormats.join(", ")}</div>)}
            <div className="text-zinc-500">{r.landscape.postingCadence}</div>
            <div><div className="font-medium">Common hooks</div><ul className="list-disc pl-5">{r.landscape.commonHooks.slice(0, 8).map((h, i) => <li key={i}>{h}</li>)}</ul></div>
            <div><span className="font-medium">Common offers:</span> {r.landscape.commonOffers.join(" · ") || "—"}</div>
            <div><span className="font-medium">Common CTAs:</span> {r.landscape.commonCtas.join(" · ") || "—"}</div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function ResearchInner({ brandId }: { brandId: string }) {
  const { brand } = useBrands();
  const { toast, fail } = useToast();
  const home = useApi(() => researchApi.home(brandId), [brandId], { poll: (d) => (d?.job && (d.job.status === "running" || d.job.status === "queued") ? 4000 : false) });
  const [website, setWebsite] = useState("");
  const [country, setCountry] = useState("US");
  const [count, setCount] = useState(6);
  const [platforms, setPlatforms] = useState<AdPlatform[]>(["meta", "google", "tiktok"]);
  const [social, setSocial] = useState(true);
  const [include, setInclude] = useState("");
  const [estimate, setEstimate] = useState<{ usd: number; lines: string[] } | null>(null);
  const [reportId, setReportId] = useState<string | undefined>();
  const report = useApi(() => (reportId ? researchApi.report(reportId) : Promise.resolve(undefined as unknown as ResearchReport)), [reportId], { enabled: !!reportId });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (home.data && !website) {
      setWebsite(home.data.defaults.website);
      if (!reportId && home.data.lastReportId) setReportId(home.data.lastReportId);
    }
  }, [home.data]);
  useEffect(() => {
    const j = home.data?.job;
    if (j?.status === "done" && j.reportId && j.reportId !== reportId) setReportId(j.reportId);
  }, [home.data?.job?.status]);
  const opts = { website, country, competitorCount: count, platforms, social, include: include.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) };
  useEffect(() => {
    if (!website) return;
    const t = setTimeout(() => researchApi.estimate(brandId, opts).then(setEstimate).catch(() => setEstimate(null)), 300);
    return () => clearTimeout(t);
  }, [website, country, count, platforms.join(","), social]);
  const run = async () => {
    setBusy(true);
    try {
      await researchApi.start(brandId, opts);
      toast("success", "Research started — this takes a few minutes");
      home.reload(true);
    } catch (e) {
      fail(e, "Couldn't start research");
    } finally {
      setBusy(false);
    }
  };
  const job: ResearchJob | undefined = home.data?.job;
  const active = job && (job.status === "running" || job.status === "queued");
  if (!home.data) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  return (
    <div>
      <PageHeader icon={<Radar className="size-5" />} title="Market research" subtitle={`Finds ${brand?.name ?? "your brand"}'s real competitors, reads their Instagram and every ad they run (Meta, Google, TikTok), and writes a strategy you can act on.`} />
      {!home.data.apify ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"><AlertTriangle className="size-4 shrink-0" />Running without Apify (optional): competitors come from Claude + your site, and the ad libraries are read by Claude itself when you ask it to (<code className="rounded bg-amber-100 px-1 dark:bg-amber-900/60">research_add_findings</code>). An Apify token in <Link to="/settings" className="underline">Settings → Research</Link> only automates that part.</div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {active && job ? (
            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between"><div className="font-semibold">Researching… {job.step}</div><span className="text-xs text-zinc-500">{job.costUsd ? `Apify $${job.costUsd.toFixed(2)}` : ""}</span></div>
              <Progress value={job.progress} />
              <ul className="max-h-48 space-y-0.5 overflow-auto font-mono text-xs text-zinc-600 dark:text-zinc-400">{job.log.slice(-12).map((l, i) => <li key={i}>{l.at.slice(11, 19)} {l.text}</li>)}</ul>
            </Card>
          ) : null}
          {job?.status === "failed" ? <Card className="p-4 text-sm text-rose-600">Last run failed: {job.error}</Card> : null}
          {report.data ? <ReportView r={report.data} onDeleted={() => { setReportId(undefined); home.reload(true); }} /> : reportId ? <Skeleton className="h-64" /> : (
            <Card className="p-8 text-center text-sm text-zinc-500">No report yet. Set the website on the right and press <b>Run research</b>.</Card>
          )}
        </div>
        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            <div className="font-semibold">Run research</div>
            <Field label="Website / shop / app"><Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://… or etsy.com/shop/… or Play Store link" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Country"><Select value={country} onChange={(e) => setCountry(e.target.value)}>{COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
              <Field label="Competitors"><Input type="number" min={2} max={12} value={count} onChange={(e) => setCount(Math.max(2, Math.min(12, Number(e.target.value) || 6)))} /></Field>
            </div>
            <Field label="Ad libraries">
              <div className="flex flex-wrap gap-2">{PLAT.map((p) => <FilterChip key={p.id} active={platforms.includes(p.id)} onClick={() => setPlatforms(platforms.includes(p.id) ? platforms.filter((x) => x !== p.id) : [...platforms, p.id])}>{p.label}</FilterChip>)}</div>
            </Field>
            <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Instagram metrics</div><div className="text-xs text-zinc-500">Followers, cadence, engagement</div></div><Toggle checked={social} onChange={setSocial} label="Instagram" /></div>
            <Field label="Always include" hint="Competitor sites or @handles, comma separated"><Input value={include} onChange={(e) => setInclude(e.target.value)} placeholder="rivalshop.com, @rivalbrand" /></Field>
            {estimate ? <div className="rounded-lg bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">Estimated Apify cost ≈ <b>${estimate.usd.toFixed(2)}</b>{home.data.apify ? "" : " (skipped without a token)"}</div> : null}
            <Button variant="primary" icon={<Play className="size-4" />} loading={busy} disabled={!!active || !website} onClick={run}>Run research</Button>
          </Card>
          <Card className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Refresh weekly</div><div className="text-xs text-zinc-500">Re-runs every 7 days to catch new competitor ads</div></div><Toggle checked={home.data.watch} onChange={async (v) => { await researchApi.setWatch(brandId, v); home.reload(true); }} label="Weekly" /></div>
          </Card>
          {home.data.reports.length ? (
            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold"><Globe className="size-4" />Past reports</div>
              <ul className="space-y-1 text-sm">{home.data.reports.map((r) => <li key={r.id}><button type="button" className={`w-full rounded-lg px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${r.id === reportId ? "bg-zinc-100 font-medium dark:bg-zinc-800" : ""}`} onClick={() => setReportId(r.id)}>{relTime(r.createdAt)} · {r.competitors} competitors · {r.adsTotal} ads</button></li>)}</ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ResearchPage() {
  return <NeedBrand>{(id) => <ResearchInner key={id} brandId={id} />}</NeedBrand>;
}
