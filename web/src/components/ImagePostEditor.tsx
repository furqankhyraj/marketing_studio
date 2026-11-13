import { Plus, Trash2 } from "lucide-react";
import type { Asset, ImageDesign, ImageOption, ImageSpec, MediaRef, StyleMeta } from "../lib/types";
import { Button, Card, Field, Input, Select, Textarea } from "./ui";

export const IMAGE_DESIGN_LABELS: Record<ImageDesign, string> = {
  quote: "Quote card",
  tip: "Tip card",
  product: "Product spotlight",
  offer: "Announcement / offer",
  testimonial: "Testimonial (real reviews only)",
  question: "Question / poll",
  "before-after": "Before / after",
  fact: "Did you know?",
};

/** Which fields each design shows (others are kept but hidden). */
const FIELDS: Record<ImageDesign, string[]> = {
  quote: ["author", "cta"],
  tip: ["eyebrow", "bullets", "body", "cta"],
  product: ["media", "badge", "eyebrow", "body", "price", "cta"],
  offer: ["badge", "eyebrow", "body", "price", "cta", "media"],
  testimonial: ["eyebrow", "author", "body", "rating", "cta"],
  question: ["eyebrow", "options", "cta"],
  "before-after": ["eyebrow", "options", "cta"],
  fact: ["eyebrow", "body", "cta"],
};

/** Form editor for an image post's ImageSpec (design, style and every visible text field). */
export function ImagePostEditor({
  spec,
  onChange,
  styles,
  assets,
  MediaPicker,
}: {
  spec: ImageSpec;
  onChange: (s: ImageSpec) => void;
  styles: StyleMeta[];
  assets: Asset[];
  MediaPicker: (p: { value?: MediaRef; onChange: (m?: MediaRef) => void; assets: Asset[] }) => React.ReactNode;
}) {
  const set = (p: Partial<ImageSpec>) => onChange({ ...spec, ...p });
  const show = new Set(FIELDS[spec.design] ?? []);
  const opt = (s?: string) => (s && s.trim() ? s : undefined);
  const bullets = spec.bullets ?? [];
  const options: ImageOption[] = spec.options ?? [];
  const setOption = (i: number, p: Partial<ImageOption>) => set({ options: options.map((o, j) => (j === i ? { ...o, ...p } : o)) });
  const bodyLabel = spec.design === "testimonial" ? "Under the name (e.g. Parent · Lahore)" : spec.design === "fact" ? "Explanation" : "Body";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Design">
          <Select
            value={spec.design}
            onChange={(e) => {
              const d = e.target.value as ImageDesign;
              const next: Partial<ImageSpec> = { design: d };
              if (d === "question" && options.length < 2) next.options = [{ label: "A", text: "Option A" }, { label: "B", text: "Option B" }];
              if (d === "before-after" && options.length < 2) next.options = [{ label: "Before", text: "" }, { label: "After", text: "" }];
              set(next);
            }}
          >
            {(Object.keys(IMAGE_DESIGN_LABELS) as ImageDesign[]).map((d) => <option key={d} value={d}>{IMAGE_DESIGN_LABELS[d]}</option>)}
          </Select>
        </Field>
        <Field label="Style" hint="Background, fonts and decoration">
          <Select value={spec.style ?? ""} onChange={(e) => set({ style: e.target.value || undefined })}>
            {!spec.style && <option value="">Automatic</option>}
            {spec.style && !styles.some((s) => s.id === spec.style) && <option value={spec.style}>{spec.style}</option>}
            {styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      </div>
      <Field label={spec.design === "quote" ? "Quote" : spec.design === "testimonial" ? "Review text" : spec.design === "question" ? "Question" : "Headline"}>
        <Textarea value={spec.headline} onChange={(e) => set({ headline: e.target.value })} className="min-h-16" />
      </Field>
      {show.has("eyebrow") && <Field label="Small label above" hint="e.g. TIP #3, DID YOU KNOW?, NEW"><Input value={spec.eyebrow ?? ""} onChange={(e) => set({ eyebrow: opt(e.target.value) })} /></Field>}
      {show.has("bullets") && (
        <Field label="Steps" hint="Up to 4">
          <div className="space-y-2">
            {bullets.map((b, i) => (
              <div key={i} className="flex gap-2">
                <Input value={b} onChange={(e) => set({ bullets: bullets.map((x, j) => (j === i ? e.target.value : x)) })} />
                <Button size="sm" variant="ghost" onClick={() => set({ bullets: bullets.filter((_, j) => j !== i) })} aria-label="Remove step"><Trash2 className="size-4 text-rose-500" /></Button>
              </div>
            ))}
            <Button size="sm" icon={<Plus className="size-4" />} disabled={bullets.length >= 4} onClick={() => set({ bullets: [...bullets, "New step"] })}>Add step</Button>
          </div>
        </Field>
      )}
      {show.has("options") && (
        <Field label={spec.design === "before-after" ? "Before / after" : "Options"}>
          <div className="space-y-2">
            {options.map((o, i) => (
              <Card key={i} className="grid gap-2 p-2.5 sm:grid-cols-[6rem_1fr_auto]">
                <Input value={o.label} onChange={(e) => setOption(i, { label: e.target.value })} aria-label="Label" />
                <Input value={o.text} onChange={(e) => setOption(i, { text: e.target.value })} aria-label="Text" />
                <Button size="sm" variant="ghost" disabled={options.length <= 2} onClick={() => set({ options: options.filter((_, j) => j !== i) })} aria-label="Remove option"><Trash2 className="size-4 text-rose-500" /></Button>
                <div className="sm:col-span-3"><MediaPicker value={o.media} onChange={(m) => setOption(i, { media: m?.kind === "image" ? m : undefined })} assets={assets.filter((a) => a.kind === "image")} /></div>
              </Card>
            ))}
            {spec.design === "question" && (
              <Button size="sm" icon={<Plus className="size-4" />} disabled={options.length >= 3} onClick={() => set({ options: [...options, { label: String.fromCharCode(65 + options.length), text: "" }] })}>Add option</Button>
            )}
          </div>
        </Field>
      )}
      {show.has("author") && <Field label="Name / author"><Input value={spec.author ?? ""} onChange={(e) => set({ author: opt(e.target.value) })} /></Field>}
      {show.has("body") && <Field label={bodyLabel}><Textarea value={spec.body ?? ""} onChange={(e) => set({ body: opt(e.target.value) })} className="min-h-16" /></Field>}
      {show.has("rating") && (
        <Field label="Stars">
          <Select value={String(spec.rating ?? 5)} onChange={(e) => set({ rating: Number(e.target.value) })}>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
      )}
      {(show.has("price") || show.has("badge")) && (
        <div className="grid gap-3 sm:grid-cols-3">
          {show.has("badge") && <Field label="Badge" hint="NEW, 20% OFF"><Input value={spec.badge ?? ""} onChange={(e) => set({ badge: opt(e.target.value) })} /></Field>}
          {show.has("price") && <Field label="Price"><Input value={spec.price ?? ""} onChange={(e) => set({ price: opt(e.target.value) })} /></Field>}
          {show.has("price") && <Field label="Old price"><Input value={spec.oldPrice ?? ""} onChange={(e) => set({ oldPrice: opt(e.target.value) })} /></Field>}
        </div>
      )}
      {show.has("cta") && <Field label={spec.design === "product" || spec.design === "offer" ? "Button" : "Footer line"}><Input value={spec.cta ?? ""} onChange={(e) => set({ cta: opt(e.target.value) })} /></Field>}
      {show.has("media") && <Field label="Photo"><MediaPicker value={spec.media} onChange={(m) => set({ media: m?.kind === "image" ? m : undefined })} assets={assets.filter((a) => a.kind === "image")} /></Field>}
      <p className="text-xs text-zinc-500">Save & re-render to see changes (an image takes a few seconds).</p>
    </div>
  );
}
