import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { AlertTriangle, Brain, Check, ImagePlus, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { cx, fmtBytes } from "../lib/format";
import type { Asset, Brand, BrandBrain, BrandColors } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useBrands } from "../state/brand";
import { useToast } from "../state/toast";
import { AssetThumb, Dropzone, NeedBrand, StockDialog, validateFiles } from "../components/media";
import { Badge, Button, Card, ChipInput, Field, Input, PageHeader, Progress, SectionTitle, Select, Skeleton, Textarea } from "../components/ui";

// Brand language → narration voice + captions (server/src/language.ts mirrors this normalisation).
const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ur", label: "Urdu (اردو script)" },
  { value: "ur-roman", label: "Roman Urdu (Latin letters on screen, Urdu voice)" },
  { value: "ar", label: "Arabic (العربية — Arabic voice, Naskh captions)" },
];
const URDU_VOICES = [
  { value: "", label: "Default — Fasih (male)" },
  { value: "ur_fasih", label: "Fasih (male)" },
  { value: "ur_aegis_female", label: "Aegis (female)" },
];
function langValue(v?: string): string {
  const s = (v ?? "").trim().toLowerCase();
  if (/^ar\b|arabic|عربي/.test(s)) return "ar";
  if (/roman|latn/.test(s)) return "ur-roman";
  if (/^ur\b|urdu|اردو/.test(s)) return "ur";
  return "en";
}

const EMPTY_BRAIN: BrandBrain = {
  summary: "", products: [], audience: "", voice: "", niche: "",
  colors: { primary: "#7c3aed", secondary: "#0f172a", accent: "#ec4899", background: "#ffffff", text: "#0f172a" },
  claimsToAvoid: [], differentiators: [], ctas: [], keywords: [], contentPillars: [], competitors: [], bestTimes: [], language: "en",
};

const ANALYSIS_STEPS = ["Reading your website", "Looking at your photos & videos", "Finding your voice and audience", "Picking colors & fonts", "Writing your Brand Brain"];

function AnalysisProgress({ brand }: { brand: Brand }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, []);
  const step = Math.min(ANALYSIS_STEPS.length - 1, Math.floor(t / 6));
  const p = Math.min(0.95, 1 - Math.exp(-t / 25));
  return (
    <Card className="overflow-hidden">
      <div className="brand-gradient h-1" />
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
        <div className="relative flex size-16 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300">
          <Brain className="size-8" />
          <Loader2 className="absolute -right-1 -top-1 size-5 animate-spin text-fuchsia-500" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Analyzing {brand.name}…</h2>
          <p className="text-sm text-zinc-500">This usually takes under a minute. You can leave this page — it keeps going.</p>
          <Progress value={p} className="mt-3" />
          <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {ANALYSIS_STEPS.map((s, i) => (
              <li key={s} className={cx("flex items-center gap-2 text-sm", i > step ? "text-zinc-400" : "")}>
                {i < step ? <Check className="size-4 text-emerald-500" /> : i === step ? <Loader2 className="size-4 animate-spin text-violet-500" /> : <span className="size-4 rounded-full border border-zinc-300 dark:border-zinc-700" />}
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium capitalize text-zinc-600 dark:text-zinc-400">{label}</div>
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-1.5 dark:border-zinc-700 dark:bg-zinc-950">
        <input type="color" value={valid ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="size-8 shrink-0" aria-label={`${label} color`} />
        <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full min-w-0 bg-transparent font-mono text-xs uppercase outline-none" />
      </div>
    </div>
  );
}

function BrainEditor({ brandId }: { brandId: string }) {
  const { upsert, refresh } = useBrands();
  const { toast, fail } = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const brandQ = useApi(() => api.brand(brandId), [brandId], { poll: (b) => (b?.analysisStatus === "running" ? 3000 : false) });
  const assetsQ = useApi(() => api.assets(brandId), [brandId]);
  const brand = brandQ.data;
  const [info, setInfo] = useState({ name: "", website: "", instagramHandle: "", driveLink: "", description: "" });
  const [brain, setBrain] = useState<BrandBrain>(EMPTY_BRAIN);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stock, setStock] = useState(false);
  const [snapshot, setSnapshot] = useState("");

  useEffect(() => {
    if (params.get("ig") === "connected") {
      toast("success", "Instagram connected");
      params.delete("ig");
      setParams(params, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the server copy into the form when brand changes or analysis finishes.
  const key = brand ? `${brand.id}:${brand.analysisStatus}:${brand.brain ? "1" : "0"}` : "";
  useEffect(() => {
    if (!brand) return;
    const i = { name: brand.name ?? "", website: brand.website ?? "", instagramHandle: brand.instagramHandle ?? "", driveLink: brand.driveLink ?? "", description: brand.description ?? "" };
    const b = { ...EMPTY_BRAIN, ...(brand.brain ?? {}), colors: { ...EMPTY_BRAIN.colors, ...(brand.brain?.colors ?? {}) } };
    setInfo(i);
    setBrain(b);
    setSnapshot(JSON.stringify([i, b]));
    upsert(brand);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => snapshot !== "" && JSON.stringify([info, brain]) !== snapshot, [info, brain, snapshot]);

  if (brandQ.loading && !brand) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;
  if (!brand) return <Card className="p-6 text-sm text-zinc-600">Couldn't load this brand. {brandQ.error instanceof Error ? brandQ.error.message : ""}</Card>;

  const running = brand.analysisStatus === "running";
  const setB = <K extends keyof BrandBrain>(k: K, v: BrandBrain[K]) => setBrain({ ...brain, [k]: v });
  const setColor = (k: keyof BrandColors, v: string) => setBrain({ ...brain, colors: { ...brain.colors, [k]: v } });

  const save = async () => {
    setSaving(true);
    try {
      const b = await api.updateBrand(brandId, { ...info, instagramHandle: info.instagramHandle.replace(/^@/, ""), brain });
      brandQ.setData(b);
      upsert(b);
      setSnapshot(JSON.stringify([info, brain]));
      toast("success", "Brand Brain saved");
    } catch (e) { fail(e, "Couldn't save"); } finally { setSaving(false); }
  };
  const reanalyze = async () => {
    try { const b = await api.analyze(brandId); brandQ.setData(b); upsert(b); toast("info", "Re-analyzing your brand…"); } catch (e) { fail(e, "Couldn't start analysis"); }
  };
  const upload = async (files: File[]) => {
    const [ok, errs] = validateFiles(files);
    if (errs.length) toast("error", "Some files were skipped", errs.join(" · "));
    if (!ok.length) return;
    setUploading(true);
    try { const added = await api.uploadAssets(brandId, ok); assetsQ.setData([...(assetsQ.data ?? []), ...added]); toast("success", `Uploaded ${added.length} file${added.length === 1 ? "" : "s"}`); }
    catch (e) { fail(e, "Upload failed"); } finally { setUploading(false); }
  };
  const removeAsset = async (a: Asset) => {
    if (!confirm(`Delete ${a.originalName}?`)) return;
    try { await api.deleteAsset(a.id); assetsQ.setData((assetsQ.data ?? []).filter((x) => x.id !== a.id)); } catch (e) { fail(e, "Couldn't delete"); }
  };
  const deleteBrand = async () => {
    if (!confirm(`Delete ${brand.name} and all its posts? This can't be undone.`)) return;
    try { await api.deleteBrand(brandId); await refresh(); toast("success", "Brand deleted"); navigate("/"); } catch (e) { fail(e, "Couldn't delete brand"); }
  };

  const lists: { k: "products" | "differentiators" | "contentPillars" | "ctas" | "claimsToAvoid" | "competitors"; label: string; hint?: string }[] = [
    { k: "products", label: "Products & offers" },
    { k: "differentiators", label: "What makes you different" },
    { k: "contentPillars", label: "Content pillars", hint: "Recurring themes for posts" },
    { k: "ctas", label: "Calls to action", hint: "e.g. Shop on Etsy — link in bio" },
    { k: "claimsToAvoid", label: "Claims to never make" },
    { k: "competitors", label: "Similar brands & creators" },
  ];

  return (
    <div>
      <PageHeader
        icon={<Brain className="size-5" />}
        title="Brand Brain"
        subtitle={`Everything the AI knows about ${brand.name}. Edit anything — it's used for every post.`}
        actions={
          <>
            <Button icon={<RefreshCw className={cx("size-4", running && "animate-spin")} />} disabled={running} onClick={reanalyze}>
              {running ? "Analyzing…" : "Re-analyze"}
            </Button>
            <Button variant="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || running} onClick={save}>
              Save changes
            </Button>
          </>
        }
      />

      {running && <div className="mb-6"><AnalysisProgress brand={brand} /></div>}
      {brand.analysisStatus === "failed" && (
        <Card className="mb-6 flex items-start gap-3 border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">Analysis failed</div>
            <div>{brand.analysisError ?? "Unknown error."} You can fill in the fields below yourself, or try again.</div>
          </div>
          <Button size="sm" onClick={reanalyze}>Try again</Button>
        </Card>
      )}
      {!brand.brain && !running && brand.analysisStatus !== "failed" && (
        <Card className="mb-6 flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center">
          <div className="flex-1">No Brand Brain yet. Add a website or description below and run the analysis — or fill it in yourself.</div>
          <Button variant="primary" size="sm" onClick={reanalyze}>Analyze now</Button>
        </Card>
      )}

      <div className={cx("grid gap-6 xl:grid-cols-[1fr_22rem]", running && "pointer-events-none opacity-60")}>
        <div className="space-y-6">
          <Card className="p-5">
            <SectionTitle>Business</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Brand name"><Input value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} /></Field>
              <Field label="Niche"><Input value={brain.niche} onChange={(e) => setB("niche", e.target.value)} placeholder="Online education" /></Field>
              <Field label="Website"><Input value={info.website} onChange={(e) => setInfo({ ...info, website: e.target.value })} /></Field>
              <Field label="Instagram handle"><Input value={info.instagramHandle} onChange={(e) => setInfo({ ...info, instagramHandle: e.target.value })} placeholder="@handle" /></Field>
              <Field label="Google Drive link" className="sm:col-span-2"><Input value={info.driveLink} onChange={(e) => setInfo({ ...info, driveLink: e.target.value })} /></Field>
              <Field label="What your business does" className="sm:col-span-2"><Textarea value={info.description} onChange={(e) => setInfo({ ...info, description: e.target.value })} /></Field>
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle>Positioning</SectionTitle>
            <div className="space-y-4">
              <Field label="Summary"><Textarea value={brain.summary} onChange={(e) => setB("summary", e.target.value)} className="min-h-24" /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Audience"><Textarea value={brain.audience} onChange={(e) => setB("audience", e.target.value)} /></Field>
                <Field label="Tone of voice"><Textarea value={brain.voice} onChange={(e) => setB("voice", e.target.value)} /></Field>
              </div>
              {lists.map((l) => (
                <Field key={l.k} label={l.label} hint={l.hint}>
                  <ChipInput value={brain[l.k] ?? []} onChange={(v) => setB(l.k, v)} />
                </Field>
              ))}
              <Field label="Keywords & hashtags"><ChipInput hashtag value={brain.keywords} onChange={(v) => setB("keywords", v)} /></Field>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <SectionTitle>Look & feel</SectionTitle>
            <div
              className="mb-4 flex h-20 items-end overflow-hidden rounded-xl p-3"
              style={{ background: `linear-gradient(135deg, ${brain.colors.primary}, ${brain.colors.secondary})` }}
            >
              <span className="rounded-lg px-2.5 py-1 text-sm font-bold" style={{ background: brain.colors.accent, color: brain.colors.text }}>
                {info.name || "Your brand"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(EMPTY_BRAIN.colors) as (keyof BrandColors)[]).map((k) => (
                <ColorField key={k} label={k} value={brain.colors[k]} onChange={(v) => setColor(k, v)} />
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Heading font"><Input value={brain.fonts?.heading ?? ""} onChange={(e) => setB("fonts", { ...brain.fonts, heading: e.target.value || undefined })} placeholder="Poppins" /></Field>
              <Field label="Body font"><Input value={brain.fonts?.body ?? ""} onChange={(e) => setB("fonts", { ...brain.fonts, body: e.target.value || undefined })} placeholder="Inter" /></Field>
            </div>
            <Field label="Logo URL" className="mt-4">
              <div className="flex items-center gap-2">
                {brain.logoUrl && <img src={brain.logoUrl} alt="" className="size-10 rounded-lg border border-zinc-200 bg-white object-contain dark:border-zinc-700" />}
                <Input value={brain.logoUrl ?? ""} onChange={(e) => setB("logoUrl", e.target.value || undefined)} placeholder="https://…/logo.png" />
              </div>
            </Field>
          </Card>
          <Card className="p-5">
            <SectionTitle>Posting</SectionTitle>
            <Field label="Best times to post" hint='Local time, e.g. "Tue 18:00"'>
              <ChipInput value={brain.bestTimes ?? []} onChange={(v) => setB("bestTimes", v)} placeholder="Tue 18:00" />
            </Field>
            <Field label="Language" className="mt-4" hint="Voiceover, captions and on-screen text">
              <Select value={langValue(brain.language)} onChange={(e) => setB("language", e.target.value)}>
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </Select>
            </Field>
            {langValue(brain.language) === "ar" && (
              <p className="mt-2 text-xs text-zinc-500">Arabic voice: Kareem (male), a free local Piper voice that downloads once (~64 MB) on first use.</p>
            )}
            {langValue(brain.language).startsWith("ur") && (
              <Field label="Urdu voice" className="mt-4" hint="Free local Piper voice; downloads once (~64 MB) on first use">
                <Select value={brain.voiceId?.startsWith("ur_") ? brain.voiceId : ""} onChange={(e) => setB("voiceId", e.target.value)}>
                  {URDU_VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </Select>
              </Field>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-6 p-5">
        <SectionTitle
          right={
            <Button size="sm" icon={<ImagePlus className="size-4" />} onClick={() => setStock(true)}>
              Add stock media
            </Button>
          }
        >
          Brand assets <Badge className="ml-1.5">{assetsQ.data?.length ?? 0}</Badge>
        </SectionTitle>
        <Dropzone onFiles={upload} compact disabled={uploading}>
          {uploading && <div className="flex items-center gap-1.5 text-xs text-violet-600"><Loader2 className="size-3.5 animate-spin" />Uploading…</div>}
        </Dropzone>
        {assetsQ.loading ? (
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-square" />)}</div>
        ) : (assetsQ.data?.length ?? 0) === 0 ? (
          <p className="mt-4 text-center text-sm text-zinc-500">No assets yet. Your reels will use motion graphics in your brand colors until you add some.</p>
        ) : (
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
            {assetsQ.data!.map((a) => (
              <div key={a.id} className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800">
                <AssetThumb asset={a} />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white">
                  <div className="truncate">{a.originalName}</div>
                  <div className="opacity-70">{a.kind} · {fmtBytes(a.size)}</div>
                </div>
                <button
                  onClick={() => removeAsset(a)}
                  className="absolute right-1 top-1 rounded-full bg-black/55 p-1.5 text-white opacity-100 transition hover:bg-rose-600 sm:opacity-0 sm:group-hover:opacity-100"
                  aria-label={`Delete ${a.originalName}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-6 flex flex-col gap-3 border-rose-200 p-5 sm:flex-row sm:items-center dark:border-rose-900/60">
        <div className="flex-1">
          <div className="font-semibold">Delete brand</div>
          <div className="text-sm text-zinc-500">Removes the brand, its assets, posts and automations.</div>
        </div>
        <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={deleteBrand}>Delete {brand.name}</Button>
      </Card>

      <StockDialog open={stock} onClose={() => setStock(false)} brandId={brandId} onAdded={(a) => assetsQ.setData([...(assetsQ.data ?? []), a])} />
    </div>
  );
}

/** /brain uses the current brand; /brands/:id selects that brand first. */
export default function BrandBrainPage() {
  const { id } = useParams();
  const { setBrandId, brandId } = useBrands();
  useEffect(() => {
    if (id && id !== brandId) setBrandId(id);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (id) return <BrainEditor key={id} brandId={id} />;
  return <NeedBrand>{(bid) => <BrainEditor key={bid} brandId={bid} />}</NeedBrand>;
}
