// Hashtags + search-first captions. Pure helpers (no DB access) so they are safe to import anywhere.
// Instagram caps hashtags at 5 per post/reel (announced Dec 2025), so every path trims to MAX_HASHTAGS.
import type { BrandBrain } from "../../shared/types.ts";

export const MAX_HASHTAGS = 5;

/** Normalize one tag: no '#', no spaces/punctuation, lowercase. */
export function normTag(t: unknown): string {
  return String(t ?? "")
    .normalize("NFKC")
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .toLowerCase();
}

/** Clean, dedupe and cap a hashtag list (default cap 5). */
export function capHashtags(tags: unknown, max = MAX_HASHTAGS): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    const n = normTag(t);
    if (n.length < 2 || n.length > 40 || /^\d+$/.test(n) || out.includes(n)) continue;
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

const INLINE_TAG = /(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]+)/gu;

/**
 * Final Instagram caption: caption text + hashtags, with at most `max` hashtags in total
 * (inline #tags in the caption count too; extras beyond the cap are stripped). Max 2200 chars.
 */
export function composeCaption(caption: string, hashtags: string[], max = MAX_HASHTAGS): string {
  const seen: string[] = [];
  let text = (caption ?? "").replace(INLINE_TAG, (m, pre: string, tag: string) => {
    const n = tag.toLowerCase();
    if (seen.includes(n)) return pre + tag; // duplicate → keep the word, drop the '#'
    if (seen.length >= max) return pre + tag;
    seen.push(n);
    return m;
  });
  const extra = capHashtags(hashtags, MAX_HASHTAGS * 4).filter((h) => !seen.includes(h)).slice(0, Math.max(0, max - seen.length));
  text = text.trimEnd();
  const tags = extra.length ? (text ? "\n\n" : "") + extra.map((h) => "#" + h).join(" ") : "";
  const tail = tags.slice(0, 400);
  return (text.slice(0, 2200 - tail.length) + tail).slice(0, 2200);
}

/** Count hashtags in a final caption (for tests / warnings). */
export function countHashtags(text: string): number {
  return [...(text ?? "").matchAll(INLINE_TAG)].length;
}

// ---------- heuristic hashtag generator ----------
const STOP = new Set(
  (
    "the a an and or but of to in on for with at by from is are was were be been it this that these those you your we our us they them their as not no yes can will just more most all any each about into over than then so if out up do does did have has had get got how what when where who why which also only very new one two its i me my " +
    "shop store home cart menu login sign account search page free shipping ship policy privacy terms cookies cookie copyright reserved rights view add usd eur gbp pkr rs www com http https click here read contact email " +
    "launch regular price off link friend friends upcoming work program partner partners waitlist waitlists via per day days week weeks"
  ).split(" "),
);
// Words that are real but useless as hashtags on their own (too broad / meaningless out of context).
const GENERIC = new Set(
  "sold hand made make item items product products thing things stuff video videos photo photos post posts blog blogs learning learn course courses class classes gift gifts love best great good nice quality custom order orders sale deal deals offer offers referral style life time today world people online business service services pro tips tip guide free piece pieces".split(
    " ",
  ),
);
const KEEP_SHORT = new Set(["ai", "3d", "diy", "ux", "ui", "seo", "art", "tea", "spa", "pet", "kid", "kids", "mom", "dad", "law", "tax"]);

function tokens(text: string): string[] {
  return (String(text ?? "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [])
    .map((w) => w.replace(/'s$/, "").replace(/['-]/g, ""))
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w) && (w.length >= 4 || KEEP_SHORT.has(w)));
}

/** Short, human topic from a product line: "AI Video Pro course: Rs 3999 launch price (...)" → "AI Video Pro course". */
export function shortTopic(s: string, maxWords = 4): string {
  const base = String(s ?? "")
    .split(/\s[–—-]\s|[:(|•·,]/)[0]
    .replace(/\s+/g, " ")
    .trim();
  const words = base.split(" ").filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

/** Lowercase normal words for mid-sentence use but keep acronyms: "AI Video Pro Course" → "AI video pro course". */
export function smartLower(s: string): string {
  return String(s ?? "").replace(/\p{L}[\p{L}\p{N}'’-]*/gu, (w) => (/^\p{Lu}[\p{Ll}'’-]/u.test(w) || /^\p{Ll}/u.test(w) ? w.toLowerCase() : w));
}

/** Split CamelCase / compound keyword into lowercase words: "AIVideoCourse" → ["ai","video","course"]. */
function splitCompound(k: string): string[] {
  return String(k)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export type BrandKind = "academy" | "handmade" | "general";
export function brandKind(brain: Pick<BrandBrain, "niche" | "summary" | "products">): BrandKind {
  const t = `${brain.niche} ${brain.summary} ${(brain.products ?? []).join(" ")}`;
  if (/academy|course|class|lesson|learn|school|tutor|teach|student|education|training/i.test(t)) return "academy";
  if (/etsy|handmade|handcrafted|artisan|crafted|jewel|gift|personali[sz]ed|custom order/i.test(t)) return "handmade";
  return "general";
}
const DEFAULTS: Record<BrandKind, string[]> = {
  academy: ["onlinelearning", "learnonline", "skillsdevelopment"],
  handmade: ["handmadegifts", "etsyfinds", "shopsmall"],
  general: ["smallbusiness", "supportsmallbusiness"],
};

/**
 * Deterministic hashtags (no LLM): prefer specific niche keywords that overlap the post topic,
 * then niche compounds, then one sensible category default. Never more than `max`.
 */
export function heuristicHashtags(brain: BrandBrain, topic = "", max = MAX_HASHTAGS): string[] {
  const topicTok = new Set(tokens(topic));
  const scored = new Map<string, number>();
  const add = (tag: string, score: number) => {
    const n = normTag(tag);
    if (n.length < 4 || n.length > 24 || /^\d/.test(n)) return;
    if (GENERIC.has(n) || STOP.has(n)) score -= 6;
    scored.set(n, Math.max(scored.get(n) ?? -Infinity, score));
  };
  // 1) brand keywords (curated SEO words from the brand brain)
  (brain.keywords ?? []).forEach((k, i) => {
    const parts = splitCompound(k).filter((w) => !STOP.has(w));
    if (!parts.length) return;
    const overlap = parts.filter((w) => topicTok.has(w)).length;
    let s = 4 - i * 0.15 + overlap * 3 + (parts.length >= 2 ? 1.5 : 0);
    if (parts.length === 1 && GENERIC.has(parts[0])) s -= 6;
    add(parts.join(""), s);
  });
  // 2) topic compounds: adjacent meaningful word pairs from the post topic ("ai video course" → aivideo, videocourse)
  const tt = tokens(topic);
  for (let i = 0; i + 1 < tt.length; i++) {
    if (GENERIC.has(tt[i]) && GENERIC.has(tt[i + 1])) continue;
    add(tt[i] + tt[i + 1], 3.5);
  }
  for (const w of tt) if (!GENERIC.has(w) && w.length >= 5) add(w, 1.5);
  // 3) niche + products: 2-word compounds
  for (const src of [brain.niche, ...(brain.products ?? []).map((p) => shortTopic(p))]) {
    const nt = tokens(src);
    for (let i = 0; i + 1 < nt.length; i++) {
      if (GENERIC.has(nt[i]) && GENERIC.has(nt[i + 1])) continue;
      const overlap = (topicTok.has(nt[i]) ? 1 : 0) + (topicTok.has(nt[i + 1]) ? 1 : 0);
      add(nt[i] + nt[i + 1], 2.5 + overlap * 1.5);
    }
  }
  const ranked = [...scored.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const out: string[] = [];
  for (const t of ranked) {
    // skip near-duplicates (one contains the other and both are long)
    if (out.some((o) => (o.includes(t) || t.includes(o)) && Math.min(o.length, t.length) >= 0.7 * Math.max(o.length, t.length))) continue;
    out.push(t);
    if (out.length >= max - 1) break;
  }
  // 4) one broad-but-relevant default, then fill
  for (const d of DEFAULTS[brandKind(brain)]) {
    if (out.length >= max) break;
    if (!out.includes(d)) out.push(d);
    if (out.length >= Math.min(max, Math.max(3, ranked.length + 1))) break;
  }
  for (const t of ranked) {
    if (out.length >= max) break;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, max);
}

/** Main search keyword for a post: short topic phrase people would type into Instagram search. */
export function mainKeyword(brain: BrandBrain, topic: string): string {
  const t = shortTopic(topic || brain.products?.[0] || brain.niche, 4);
  return t || shortTopic(brain.niche, 3);
}

/**
 * Keyword-first caption: line 1 = hook that contains the main search keyword, then value lines, then one CTA.
 */
export function keywordFirstCaption(opts: { hook: string; keyword: string; body?: string; cta?: string }): string {
  const hook = opts.hook.trim();
  const kw = opts.keyword.trim();
  const line1 = !kw || hook.toLowerCase().includes(kw.toLowerCase()) ? hook : `${capFirst(kw)}: ${hook}`;
  return [line1, opts.body?.trim().replace(/\.{2}(?!\.)/g, "."), opts.cta?.trim()].filter(Boolean).join("\n\n");
}

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
