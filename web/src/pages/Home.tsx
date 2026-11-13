import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, Brain, CalendarCheck, Film, Globe, HardDrive, Heart, MessageSquareReply, Sparkles, X } from "lucide-react";
import { Instagram } from "../components/icons";
import { api } from "../lib/api";
import { fmtBytes } from "../lib/format";
import { useBrands } from "../state/brand";
import { useToast } from "../state/toast";
import { BrandAvatar } from "../components/Layout";
import { Dropzone, validateFiles } from "../components/media";
import { Button, Card, Field, Input, Progress, Textarea } from "../components/ui";
import { AutopilotDigestCard } from "../components/AutopilotDigestCard";

function Preview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url] = useState(() => URL.createObjectURL(file));
  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800">
      {file.type.startsWith("video") ? (
        <video src={url} muted className="size-full object-cover" />
      ) : file.type.startsWith("image") ? (
        <img src={url} alt={file.name} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center p-2 text-center text-xs text-zinc-500">{file.name}</div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white">{fmtBytes(file.size)}</div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white hover:bg-black/80"
        aria-label={`Remove ${file.name}`}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

const STEPS = [
  { icon: <Brain className="size-5" />, title: "Learns your brand", text: "Reads your website and media to build a Brand Brain: voice, colors, audience, offers." },
  { icon: <Film className="size-5" />, title: "Makes real reels", text: "Plans your week and renders finished MP4 reels, carousels and stories." },
  { icon: <Heart className="size-5" />, title: "You swipe to approve", text: "Swipe right to approve, left to ask for a change — it remakes it for you." },
  { icon: <CalendarCheck className="size-5" />, title: "Posts at the best time", text: "Auto-publishes to Instagram when your audience is most active." },
  { icon: <MessageSquareReply className="size-5" />, title: "Turns comments into DMs", text: "Replies to keyword comments and sends the link by DM automatically." },
];

export default function Home() {
  const nav = useNavigate();
  const { brands, upsert, setBrandId } = useBrands();
  const { toast, fail } = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [form, setForm] = useState({ name: "", description: "", website: "", instagramHandle: "", driveLink: "" });
  const [stage, setStage] = useState<null | { label: string; p: number }>(null);

  const addFiles = (incoming: File[]) => {
    const [ok, errs] = validateFiles([...files, ...incoming]);
    setFiles(ok);
    if (errs.length) toast("error", "Some files were skipped", errs.join(" · "));
  };

  const guessName = () => {
    if (form.name.trim()) return form.name.trim();
    if (form.instagramHandle.trim()) return form.instagramHandle.trim().replace(/^@/, "");
    try { return new URL(form.website.startsWith("http") ? form.website : `https://${form.website}`).hostname.replace(/^www\./, "").split(".")[0]; } catch { /* */ }
    return "My brand";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim() && !form.website.trim()) return toast("error", "Tell us a little about your business", "Add a website or describe what your business does.");
    try {
      setStage({ label: "Creating your brand…", p: 0.15 });
      let website = form.website.trim();
      if (website && !/^https?:\/\//.test(website)) website = `https://${website}`;
      const brand = await api.createBrand({
        name: guessName(),
        description: form.description.trim() || undefined,
        website: website || undefined,
        instagramHandle: form.instagramHandle.trim().replace(/^@/, "") || undefined,
        driveLink: form.driveLink.trim() || undefined,
      });
      upsert(brand);
      setBrandId(brand.id);
      if (files.length) {
        setStage({ label: `Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`, p: 0.5 });
        try {
          await api.uploadAssets(brand.id, files);
        } catch (err) {
          fail(err, "Brand created, but uploading media failed");
        }
      }
      setStage({ label: "Starting analysis…", p: 0.9 });
      toast("success", "Brand created", "We're analyzing it now.");
      nav(`/brands/${brand.id}`);
    } catch (err) {
      fail(err, "Couldn't create the brand");
    } finally {
      setStage(null);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-10">
      {brands.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Your brands</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {brands.map((b) => (
              <Link key={b.id} to={`/brands/${b.id}`} onClick={() => setBrandId(b.id)}>
                <Card className="flex items-center gap-3 p-4 transition hover:border-violet-300 hover:shadow-md dark:hover:border-violet-800">
                  <BrandAvatar name={b.name} className="size-11 text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{b.name}</div>
                    <div className="truncate text-xs text-zinc-500">
                      {b.analysisStatus === "running" ? "Analyzing…" : b.brain?.niche ?? b.website ?? "No analysis yet"}
                      {b.igConnected && " · Instagram connected"}
                    </div>
                  </div>
                  <ArrowRight className="size-4 text-zinc-400" />
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {brands.length > 0 && <AutopilotDigestCard />}

      <section className="hero-glow -mx-4 rounded-3xl px-4 pb-4 pt-6 sm:-mx-6 sm:px-6 lg:pt-10">
        <div className="grid items-start gap-10 lg:grid-cols-[1.05fr_1fr]">
          <div className="lg:sticky lg:top-24">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white/70 px-3 py-1 text-xs font-semibold text-violet-700 backdrop-blur dark:border-violet-900 dark:bg-zinc-900/60 dark:text-violet-300">
              <Sparkles className="size-3.5" /> Runs locally · drive it from Claude
            </div>
            <h1 className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              AI that runs your <span className="brand-text">social media</span>
            </h1>
            <p className="mt-4 max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
              Drop in a few photos and tell us what you do. Social MCP Studio learns your brand, audits your account, makes the reels, and posts them — you just swipe yes.
            </p>
            <ul className="mt-8 hidden space-y-4 lg:block">
              {STEPS.map((s) => (
                <li key={s.title} className="flex gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm dark:bg-zinc-900 dark:text-violet-300">{s.icon}</div>
                  <div>
                    <div className="font-semibold">{s.title}</div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">{s.text}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <Card className="p-5 shadow-xl shadow-violet-500/5 sm:p-6">
            <form onSubmit={submit} className="space-y-5">
              <div>
                <h2 className="text-lg font-bold">Set up a brand</h2>
                <p className="text-sm text-zinc-500">Takes about a minute. You can edit everything later.</p>
              </div>
              <Field label="Photos & videos" hint="Products, behind-the-scenes, team, past posts — anything we can use in your reels.">
                <Dropzone onFiles={addFiles} compact={files.length > 0} disabled={!!stage} />
                {files.length > 0 && (
                  <div className="mt-3 grid grid-cols-5 gap-2">
                    {files.map((f, i) => <Preview key={`${f.name}-${f.size}-${i}`} file={f} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />)}
                  </div>
                )}
              </Field>
              <Field label="What your business does">
                <Textarea value={form.description} onChange={set("description")} placeholder="e.g. We teach Arabic and Quran online to kids and adults with live 1:1 tutors." className="min-h-24" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Brand name" hint="Optional — we'll guess it">
                  <Input value={form.name} onChange={set("name")} placeholder="Saqqa Academy" />
                </Field>
                <Field label={<span className="flex items-center gap-1.5"><Globe className="size-3.5" />Website</span>}>
                  <Input value={form.website} onChange={set("website")} placeholder="yourshop.com" inputMode="url" />
                </Field>
                <Field label={<span className="flex items-center gap-1.5"><Instagram className="size-3.5" />Instagram handle</span>}>
                  <Input value={form.instagramHandle} onChange={set("instagramHandle")} placeholder="@yourbrand" />
                </Field>
                <Field label={<span className="flex items-center gap-1.5"><HardDrive className="size-3.5" />Google Drive link</span>} hint="Optional shared folder">
                  <Input value={form.driveLink} onChange={set("driveLink")} placeholder="https://drive.google.com/…" inputMode="url" />
                </Field>
              </div>
              {stage && (
                <div>
                  <Progress value={stage.p} />
                  <div className="mt-1.5 text-xs text-zinc-500">{stage.label}</div>
                </div>
              )}
              <Button type="submit" variant="primary" size="lg" className="w-full" loading={!!stage} icon={<Sparkles className="size-4" />}>
                Build my Brand Brain
              </Button>
            </form>
          </Card>
        </div>
      </section>
    </div>
  );
}
