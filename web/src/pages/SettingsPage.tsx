import { useEffect, useMemo, useState } from "react";
import { Bot, Globe, Mic, Music, Save, Settings as SettingsIcon, Store, Video , Radar } from "lucide-react";
import { Instagram } from "../components/icons";
import { api, type SettingsPatch, type SettingsX } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useToast } from "../state/toast";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Skeleton, Toggle } from "../components/ui";

const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"];

function SecretField({ label, isSet, value, onChange, placeholder, hint }: { label: string; isSet?: boolean; value: string; onChange: (v: string) => void; placeholder?: string; hint?: React.ReactNode }) {
  return (
    <Field label={label} hint={hint} right={isSet === undefined ? null : <Badge tone={isSet ? "green" : "gray"}>{isSet ? "Set" : "Not set"}</Badge>}>
      <Input type="password" autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} placeholder={isSet ? "•••••••• (leave empty to keep)" : placeholder} />
    </Field>
  );
}

function Section({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300">{icon}</div>
        <div>
          <h2 className="font-semibold">{title}</h2>
          {desc && <p className="text-sm text-zinc-500">{desc}</p>}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

export default function SettingsPage() {
  const { toast, fail } = useToast();
  const q = useApi(() => api.settings(), []);
  const voices = useApi(() => api.voices(), []);
  const tracks = useApi(() => api.music(), []);
  const s = q.data;
  const [f, setF] = useState({ anthropicModel: "", igAppId: "", publicBaseUrl: "", timezone: "", autoPublish: true, voice: "", autoVoiceover: true });
  const [mu, setMu] = useState({ autoMusic: true, musicVolume: 0.3, defaultMusicMood: "" });
  const [secrets, setSecrets] = useState({ anthropicApiKey: "", claudeOauthToken: "", igAppSecret: "", pexelsApiKey: "", pixabayApiKey: "", etsyApiKey: "", apifyToken: "" });
  const [provider, setProvider] = useState<"auto" | "api" | "subscription">("auto");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const zones = useMemo(() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"); } catch { return []; } }, []);

  const load = (x: SettingsX) => {
    setF({ anthropicModel: x.anthropicModel ?? "", igAppId: x.igAppId ?? "", publicBaseUrl: x.publicBaseUrl ?? "", timezone: x.timezone ?? "", autoPublish: x.autoPublish ?? true, voice: x.voice ?? "", autoVoiceover: x.autoVoiceover ?? true });
    setProvider(x.llmProvider ?? "auto");
    setMu({ autoMusic: x.autoMusic ?? true, musicVolume: x.musicVolume ?? 0.3, defaultMusicMood: x.defaultMusicMood ?? "" });
  };
  useEffect(() => { if (s) load(s); }, [s]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!s) return;
    const patch: SettingsPatch = {};
    if (f.anthropicModel !== (s.anthropicModel ?? "")) patch.anthropicModel = f.anthropicModel;
    if (provider !== (s.llmProvider ?? "auto")) patch.llmProvider = provider;
    if (f.igAppId !== (s.igAppId ?? "")) patch.igAppId = f.igAppId;
    if (f.publicBaseUrl !== (s.publicBaseUrl ?? "")) patch.publicBaseUrl = f.publicBaseUrl.replace(/\/+$/, "");
    if (f.timezone !== (s.timezone ?? "")) patch.timezone = f.timezone;
    if (f.autoPublish !== s.autoPublish) patch.autoPublish = f.autoPublish;
    if (f.voice && f.voice !== (s.voice ?? "")) patch.voice = f.voice;
    if (f.autoVoiceover !== (s.autoVoiceover ?? true)) patch.autoVoiceover = f.autoVoiceover;
    if (mu.autoMusic !== (s.autoMusic ?? true)) patch.autoMusic = mu.autoMusic;
    if (mu.musicVolume !== (s.musicVolume ?? 0.3)) patch.musicVolume = mu.musicVolume;
    if (mu.defaultMusicMood !== (s.defaultMusicMood ?? "")) patch.defaultMusicMood = mu.defaultMusicMood;
    for (const [k, v] of Object.entries(secrets)) if (v.trim()) (patch as Record<string, string>)[k] = v.trim();
    if (!Object.keys(patch).length) return toast("info", "Nothing to save");
    setSaving(true);
    try {
      const next = await api.updateSettings(patch);
      q.setData(next);
      setSecrets({ anthropicApiKey: "", claudeOauthToken: "", igAppSecret: "", pexelsApiKey: "", pixabayApiKey: "", etsyApiKey: "", apifyToken: "" });
      toast("success", "Settings saved");
    } catch (err) { fail(err, "Couldn't save settings"); } finally { setSaving(false); }
  };

  if (q.loading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-56" /><Skeleton className="h-56" /></div>;
  if (!s)
    return (
      <EmptyState icon={<SettingsIcon className="size-6" />} title="Couldn't load settings" action={<Button onClick={() => q.reload()}>Retry</Button>}>
        Start the server: <code className="font-mono">npm run dev</code> in <code className="font-mono">server/</code>.
      </EmptyState>
    );

  const voiceList = voices.data ?? [];
  return (
    <form onSubmit={save}>
      <PageHeader
        icon={<SettingsIcon className="size-5" />}
        title="Settings"
        subtitle="Keys are stored locally and never shown again after saving."
        actions={<Button type="submit" variant="primary" loading={saving} icon={<Save className="size-4" />}>Save settings</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section icon={<Bot className="size-5" />} title="AI" desc="Without a key, the app still works using built-in templates — or let Claude Desktop do the writing via MCP.">
          <SecretField label="Claude subscription token (Pro/Max)" isSet={!!s.claudeSubscriptionSet} value={secrets.claudeOauthToken} onChange={(v) => setSecrets({ ...secrets, claudeOauthToken: v })} placeholder="sk-ant-oat01-…" />
          <p className="-mt-2 text-xs text-zinc-500">Uses your Claude subscription instead of API billing. In a terminal run <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">claude setup-token</code>, sign in, and paste the token here. Needs Claude Code installed on this PC.</p>
          <SecretField label="Anthropic API key (pay as you go)" isSet={s.anthropicApiKeySet} value={secrets.anthropicApiKey} onChange={(v) => setSecrets({ ...secrets, anthropicApiKey: v })} placeholder="sk-ant-…" />
          <Field label="Use">
            <Select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
              <option value="auto">Automatic — subscription if set, otherwise API key</option>
              <option value="subscription">Claude subscription only</option>
              <option value="api">API key only</option>
            </Select>
          </Field>
          <div className="flex items-center gap-2">
            <Button size="sm" loading={testing} onClick={async () => {
              setTesting(true);
              try {
                const r = await api.testLlm();
                if (r.ok) toast("success", `Claude works (${r.mode === "subscription" ? "subscription" : "API key"}, ${Math.round((r.ms ?? 0) / 100) / 10}s)`, typeof r.sample === "string" ? r.sample : undefined);
                else toast("error", "Claude isn't working", r.message);
              } catch (err) { fail(err, "Test failed"); } finally { setTesting(false); }
            }}>Test Claude</Button>
            <span className="text-xs text-zinc-500">Save first, then test.</span>
          </div>
          <Field label="Model">
            <Input list="models" value={f.anthropicModel} onChange={(e) => setF({ ...f, anthropicModel: e.target.value })} placeholder="claude-sonnet-5-5" />
            <datalist id="models">{MODELS.map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
        </Section>

        <Section icon={<Radar className="size-5" />} title="Research" desc="Market research reads Google results, competitors' Instagram profiles and the Meta / Google / TikTok ad libraries through Apify.">
          <SecretField label="Apify API token" isSet={!!s.apifyTokenSet} value={secrets.apifyToken} onChange={(v) => setSecrets({ ...secrets, apifyToken: v })} placeholder="apify_api_…" />
          <p className="-mt-2 text-xs text-zinc-500">Free account at apify.com → Settings → API &amp; Integrations → Personal API tokens. The free tier's $5/month credit covers a few full research runs (≈ $1 each).</p>
        </Section>

        <Section icon={<Instagram className="size-5" />} title="Instagram app" desc="From your Meta developer app (Instagram API with Instagram Login).">
          <Field label="Instagram App ID"><Input value={f.igAppId} onChange={(e) => setF({ ...f, igAppId: e.target.value })} /></Field>
          <SecretField label="Instagram App Secret" isSet={s.igAppSecretSet} value={secrets.igAppSecret} onChange={(v) => setSecrets({ ...secrets, igAppSecret: v })} />
          <p className="text-xs text-zinc-500">OAuth redirect URL: <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">http://localhost:4300/api/instagram/callback</code></p>
        </Section>

        <Section icon={<Mic className="size-5" />} title="Voiceover" desc="Local text-to-speech narration for reels.">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Auto voiceover</div>
              <div className="text-xs text-zinc-500">Narrate scenes that have voiceover lines and add word-timed captions</div>
            </div>
            <Toggle checked={f.autoVoiceover} onChange={(v) => setF({ ...f, autoVoiceover: v })} label="Auto voiceover" />
          </div>
          <Field label="Voice" hint={voices.error ? "Voice list unavailable — update the server to enable voices." : undefined}>
            <Select value={f.voice} onChange={(e) => setF({ ...f, voice: e.target.value })} disabled={!voiceList.length && !f.voice}>
              {!f.voice && <option value="">Default voice</option>}
              {f.voice && !voiceList.some((v) => v.id === f.voice) && <option value={f.voice}>{f.voice}</option>}
              {voiceList.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.gender}, {v.accent}</option>)}
            </Select>
          </Field>
        </Section>

        <Section icon={<Music className="size-5" />} title="Music & audio" desc="Royalty-free background music, mixed under the voice and loudness-matched for Instagram.">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Auto music</div>
              <div className="text-xs text-zinc-500">Add a track that fits the brand and post to every reel and story (unless you remove it on a post)</div>
            </div>
            <Toggle checked={mu.autoMusic} onChange={(v) => setMu({ ...mu, autoMusic: v })} label="Auto music" />
          </div>
          <Field label={`Music volume — ${Math.round(mu.musicVolume * 100)}%`} hint="Level of the music next to the voice. It dips further while someone is speaking. 30% suits most reels.">
            <input type="range" min={0} max={1} step={0.05} value={mu.musicVolume} onChange={(e) => setMu({ ...mu, musicVolume: Number(e.target.value) })} className="w-full accent-violet-600" aria-label="Music volume" />
          </Field>
          <Field label="Mood" hint="Automatic picks a mood from the brand and each post. Pick one to use it for every post.">
            <Select value={mu.defaultMusicMood} onChange={(e) => setMu({ ...mu, defaultMusicMood: e.target.value })}>
              <option value="">Automatic (recommended)</option>
              {(tracks.data ?? []).filter((t) => t.source === "builtin").map((t) => <option key={t.id} value={t.mood}>{t.name}</option>)}
            </Select>
          </Field>
          {!!tracks.data?.length && (
            <details className="text-sm">
              <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">Listen to the tracks ({tracks.data.length})</summary>
              <ul className="mt-3 space-y-3">
                {tracks.data.map((t) => (
                  <li key={t.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{t.name}</span>
                      <Badge tone="gray">{t.source === "builtin" ? "built-in" : t.source}</Badge>
                    </div>
                    {t.description && <p className="text-xs text-zinc-500">{t.description}</p>}
                    <audio controls preload="none" src={t.url} className="mt-1 h-8 w-full" />
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-zinc-500">Add your own tracks by uploading audio files to a brand, or by putting files in <code className="font-mono">data/music/library/</code>.</p>
            </details>
          )}
        </Section>

        <Section icon={<Store className="size-5" />} title="Etsy" desc="Reads your shop's listings, photos and reviews to make product reels (Etsy page).">
          <SecretField label="Etsy API key" isSet={s.etsyApiKeySet} value={secrets.etsyApiKey} onChange={(v) => setSecrets({ ...secrets, etsyApiKey: v })} placeholder="keystring:shared_secret"
            hint={<>Paste <b>keystring:shared secret</b> from <a className="underline" href="https://www.etsy.com/developers/your-apps" target="_blank" rel="noreferrer">etsy.com/developers/your-apps</a>. Without a key, the 10 newest listings come from your shop's RSS feed.</>} />
        </Section>

        <Section icon={<Video className="size-5" />} title="Stock media" desc="Free b-roll when a brand has no uploaded media.">
          <SecretField label="Pexels API key" isSet={s.pexelsApiKeySet} value={secrets.pexelsApiKey} onChange={(v) => setSecrets({ ...secrets, pexelsApiKey: v })} />
          <SecretField label="Pixabay API key" isSet={s.pixabayApiKeySet} value={secrets.pixabayApiKey} onChange={(v) => setSecrets({ ...secrets, pixabayApiKey: v })} />
        </Section>

        <Section icon={<Globe className="size-5" />} title="Publishing" desc="When and how approved posts go out.">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Auto-publish</div>
              <div className="text-xs text-zinc-500">Post approved content automatically at its scheduled time</div>
            </div>
            <Toggle checked={f.autoPublish} onChange={(v) => setF({ ...f, autoPublish: v })} label="Auto-publish" />
          </div>
          <Field label="Timezone">
            <Input list="zones" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} placeholder="Asia/Karachi" />
            <datalist id="zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          </Field>
          <Field label="Public base URL" hint="Optional tunnel URL (e.g. cloudflared) so Instagram can fetch carousel images.">
            <Input value={f.publicBaseUrl} onChange={(e) => setF({ ...f, publicBaseUrl: e.target.value })} placeholder="https://your-tunnel.trycloudflare.com" inputMode="url" />
          </Field>
        </Section>
      </div>
      <div className="mt-6 flex justify-end sm:hidden">
        <Button type="submit" variant="primary" loading={saving} className="w-full" icon={<Save className="size-4" />}>Save settings</Button>
      </div>
    </form>
  );
}
