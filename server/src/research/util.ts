// Small shared helpers for the research module.
export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export function domainOf(u: string | undefined): string {
  if (!u) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].toLowerCase();
  }
}
export function normalizeSite(u: string): string {
  const s = u.trim();
  if (!s) return s;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
/** Root domain without common subdomains ("shop.acme.co.uk" → "acme.co.uk"). */
export function rootDomain(d: string): string {
  const parts = d.split(".");
  if (parts.length <= 2) return d;
  const sld = parts[parts.length - 2];
  if (["co", "com", "org", "net", "gov", "ac"].includes(sld) && parts.length >= 3) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

/** Sites that are never "a competitor": marketplaces, social networks, directories, news. */
export const GENERIC_DOMAINS = new Set(
  "amazon.com amazon.co.uk amazon.de amazon.ca ebay.com walmart.com target.com aliexpress.com alibaba.com temu.com wish.com shopify.com pinterest.com facebook.com instagram.com tiktok.com youtube.com twitter.com x.com reddit.com quora.com wikipedia.org google.com apple.com microsoft.com linkedin.com medium.com canva.com creativefabrica.com teacherspayteachers.com yelp.com tripadvisor.com bbc.com cnn.com nytimes.com forbes.com buzzfeed.com huffpost.com gumroad.com patreon.com linktr.ee bit.ly github.com stackoverflow.com".split(" "),
);
export const isGeneric = (domain: string) => {
  const r = rootDomain(domain);
  return GENERIC_DOMAINS.has(r) || GENERIC_DOMAINS.has(domain);
};

export const uniq = <T>(a: T[]) => [...new Set(a)];
export const take = <T>(a: T[], n: number) => a.slice(0, n);
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

/** Top n most frequent strings (case-insensitive) with counts. */
export function topCounts(items: string[], n = 10): { value: string; count: number }[] {
  const m = new Map<string, { value: string; count: number }>();
  for (const raw of items) {
    const k = raw.trim().toLowerCase();
    if (!k) continue;
    const e = m.get(k);
    if (e) e.count++;
    else m.set(k, { value: raw.trim(), count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);
}

export const OFFER_RE = /\b(\d{1,2}% ?off|free shipping|buy \d+ get \d+|bogo|save \$?\d+|\$\d+ off|limited time|flash sale|clearance|bundle|free trial|\d+ days? free|money[- ]back|lifetime|no ads|premium free|discount code|use code \w+|sale ends|today only|new arrivals?|best ?seller)\b/gi;
export const CTA_RE = /\b(shop now|buy now|order now|get started|download( now| free)?|install|try (it )?free|start free|learn more|sign up|subscribe|book now|get (the|your) \w+|join (now|free)|see more|watch now|add to cart|claim (your|the) \w+|get offer|apply now|contact us|read more|try now)\b/gi;
export const PRICE_RE = /(?:\$|€|£|Rs\.?|PKR|USD)\s?\d{1,5}(?:[.,]\d{2})?|\b\d{1,5}(?:[.,]\d{2})?\s?(?:USD|EUR|GBP|PKR)\b/g;

export function firstSentence(t: string | undefined, max = 110): string {
  if (!t) return "";
  const s = t.replace(/\s+/g, " ").trim().split(/(?<=[.!?…])\s|\n/)[0] ?? "";
  return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : s;
}
export function daysBetween(a?: string, b?: string): number | undefined {
  if (!a) return undefined;
  const t0 = Date.parse(a);
  const t1 = b ? Date.parse(b) : Date.now();
  if (isNaN(t0) || isNaN(t1)) return undefined;
  return Math.max(0, Math.round((t1 - t0) / 86400_000));
}
export const isoDate = (v: unknown): string | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v));
  return isNaN(n) ? undefined : new Date(n).toISOString().slice(0, 10);
};

/** Fuzzy "is this advertiser the competitor?" — name tokens or domain stem appear in the advertiser name/url. */
export function matchesCompetitor(advertiser: string, link: string | undefined, c: { name: string; domain: string }): boolean {
  const adv = advertiser.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const stem = rootDomain(c.domain).split(".")[0];
  if (stem.length >= 4 && (adv.replace(/\s/g, "").includes(stem) || (link ?? "").toLowerCase().includes(stem))) return true;
  const nameTokens = c.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length >= 4 && !/^(the|shop|store|official|app|inc|llc|ltd)$/.test(t));
  if (!nameTokens.length) return adv.includes(c.name.toLowerCase());
  const hit = nameTokens.filter((t) => adv.includes(t)).length;
  return hit >= Math.max(1, Math.ceil(nameTokens.length * 0.6));
}
