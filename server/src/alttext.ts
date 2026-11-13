// Heuristic alt text for image / carousel posts (pure, no DB). The LLM version lives in growth.ts.
import type { Post, CarouselSpec, ImageSpec } from "../../shared/types.ts";
import { MAX_ALT_TEXT } from "./igparams.ts";

const clean = (s?: string) => String(s ?? "").replace(/\s+/g, " ").trim();

/** One alt text per image: describes the rendered slide (brand graphic + its text). Empty for reels/stories. */
export function heuristicAltText(post: Pick<Post, "type" | "spec" | "mediaUrls">, brandName?: string): string[] {
  if (post.type === "image") return [imageAlt(post.spec as ImageSpec, brandName)];
  if (post.type !== "carousel") return [];
  const spec = post.spec as CarouselSpec;
  const slides = Array.isArray(spec?.slides) ? spec.slides : [];
  const n = Math.max(slides.length, post.mediaUrls?.length ?? 0);
  const who = brandName ? `${brandName} ` : "";
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = slides[i];
    const head = clean(s?.headline);
    const body = clean(s?.body);
    const bg = s?.media?.kind === "image" ? "over a product photo" : "on a brand-colored background";
    const pos = n > 1 ? `Slide ${i + 1} of ${n}: ` : "";
    let t = head
      ? `${pos}${who}graphic ${bg} with the headline "${head}"${body ? ` and the text "${body}"` : ""}.`
      : `${pos}${who}branded graphic ${bg}.`;
    if (t.length > MAX_ALT_TEXT) t = t.slice(0, MAX_ALT_TEXT - 1) + "…";
    out.push(t);
  }
  return out;
}

const DESIGN_WORDS: Record<string, string> = {
  quote: "quote card", tip: "tip card", product: "product spotlight", offer: "announcement graphic", testimonial: "customer review card",
  question: "poll graphic", "before-after": "before and after graphic", fact: "'did you know' fact card",
};
/** Alt text for a single-image post (ImageSpec): design + its visible text. */
function imageAlt(s: ImageSpec, brandName?: string): string {
  const who = brandName ? `${brandName} ` : "";
  const kind = DESIGN_WORDS[s?.design] ?? "graphic";
  const photo = s?.media ? " with a product photo" : " on a brand-colored background";
  const parts = [`${who}${kind}${photo}`, s?.headline ? `headline "${clean(s.headline)}"` : ""];
  if (s?.bullets?.length) parts.push(`steps: ${s.bullets.map(clean).join("; ")}`);
  if (s?.options?.length) parts.push(`options: ${s.options.map((o) => `${clean(o.label)} ${clean(o.text)}`).join(", ")}`);
  if (s?.body) parts.push(`text "${clean(s.body)}"`);
  if (s?.price) parts.push(`price ${clean(s.price)}`);
  let t = parts.filter(Boolean).join(", ") + ".";
  if (t.length > MAX_ALT_TEXT) t = t.slice(0, MAX_ALT_TEXT - 1) + "…";
  return t;
}
