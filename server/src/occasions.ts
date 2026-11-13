// Small built-in calendar of dates the planner / autopilot can use for timely posts.
// Data checked 2026-11-11. Islamic dates depend on the moon sighting and can shift by ±1 day (marked approx);
// Pakistan usually follows its own sighting committee. Etsy does not publish fixed sales-event dates, so the
// Etsy entries are approximate windows. Extend with care: keep entries short and dated.
import type { BrandBrain } from "../../shared/types.ts";
import { brandKind } from "./hashtags.ts";

export type OccasionTag = "all" | "muslim" | "pk" | "shop" | "academy" | "etsy";

export interface Occasion {
  id: string;
  name: string;
  date: string;            // YYYY-MM-DD (local day)
  tags: OccasionTag[];
  angle: string;           // suggested angle for the post
  approx?: boolean;        // moon-sighting / estimated dates
  leadDays?: number;       // post up to N days before (default 3); 0 = on the day
}

export const OCCASIONS: Occasion[] = [
  // ---- 2026 ----
  { id: "valentines-2026", name: "Valentine's Day 2026", date: "2026-02-14", tags: ["shop", "etsy"], angle: "Gift ideas for someone you love", leadDays: 7 },
  { id: "ramadan-2026", name: "Ramadan 2026", date: "2026-02-18", tags: ["muslim"], angle: "Welcome Ramadan: goals, routines and reflection", approx: true, leadDays: 3 },
  { id: "eid-fitr-2026", name: "Eid al-Fitr 2026", date: "2026-03-20", tags: ["muslim"], angle: "Eid greetings and gift ideas", approx: true, leadDays: 4 },
  { id: "pakistan-day-2026", name: "Pakistan Day 2026", date: "2026-03-23", tags: ["pk"], angle: "Pakistan Resolution Day greeting", leadDays: 1 },
  { id: "mothers-day-2026", name: "Mother's Day 2026", date: "2026-05-10", tags: ["all"], angle: "Thank you, mums: gifts and gratitude", leadDays: 6 },
  { id: "eid-adha-2026", name: "Eid al-Adha 2026", date: "2026-05-27", tags: ["muslim"], angle: "Eid al-Adha greetings and the meaning of sacrifice", approx: true, leadDays: 3 },
  { id: "islamic-new-year-2026", name: "Islamic New Year 1448", date: "2026-06-16", tags: ["muslim"], angle: "New Hijri year: fresh intentions", approx: true, leadDays: 1 },
  { id: "fathers-day-2026", name: "Father's Day 2026", date: "2026-06-21", tags: ["all"], angle: "Celebrating dads", leadDays: 5 },
  { id: "independence-pk-2026", name: "Pakistan Independence Day 2026", date: "2026-08-14", tags: ["pk"], angle: "Jashn-e-Azadi greeting, green and white", leadDays: 2 },
  { id: "back-to-school-2026", name: "Back to School 2026", date: "2026-08-31", tags: ["academy"], angle: "Start the new term strong", leadDays: 7 },
  { id: "teachers-day-2026", name: "World Teachers' Day 2026", date: "2026-10-05", tags: ["academy"], angle: "Thank a teacher", leadDays: 1 },
  { id: "black-friday-2026", name: "Black Friday 2026", date: "2026-11-27", tags: ["shop", "etsy"], angle: "Our Black Friday picks / offer (only real discounts)", leadDays: 5 },
  { id: "small-business-saturday-2026", name: "Small Business Saturday 2026", date: "2026-11-28", tags: ["shop", "etsy"], angle: "Shop small, support makers", leadDays: 1 },
  { id: "cyber-monday-2026", name: "Cyber Monday 2026", date: "2026-11-30", tags: ["shop", "etsy"], angle: "Last chance for the sale weekend", leadDays: 1 },
  { id: "etsy-holiday-shipping-2026", name: "Etsy holiday shipping cut-off 2026", date: "2026-12-15", tags: ["etsy"], angle: "Order now to get it before the holidays", approx: true, leadDays: 5 },
  { id: "christmas-2026", name: "Christmas 2026", date: "2026-12-25", tags: ["shop", "etsy"], angle: "Season's greetings and last-minute gifts", leadDays: 5 },
  { id: "quaid-day-2026", name: "Quaid-e-Azam Day 2026", date: "2026-12-25", tags: ["pk"], angle: "Remembering Quaid-e-Azam", leadDays: 1 },
  // ---- 2027 ----
  { id: "new-year-2027", name: "New Year 2027", date: "2027-01-01", tags: ["all"], angle: "New year, new goals", leadDays: 2 },
  { id: "ramadan-2027", name: "Ramadan 2027", date: "2027-02-08", tags: ["muslim"], angle: "Welcome Ramadan: goals, routines and reflection", approx: true, leadDays: 3 },
  { id: "valentines-2027", name: "Valentine's Day 2027", date: "2027-02-14", tags: ["shop", "etsy"], angle: "Gift ideas for someone you love", leadDays: 7 },
  { id: "eid-fitr-2027", name: "Eid al-Fitr 2027", date: "2027-03-10", tags: ["muslim"], angle: "Eid greetings and gift ideas", approx: true, leadDays: 4 },
  { id: "pakistan-day-2027", name: "Pakistan Day 2027", date: "2027-03-23", tags: ["pk"], angle: "Pakistan Resolution Day greeting", leadDays: 1 },
  { id: "mothers-day-2027", name: "Mother's Day 2027", date: "2027-05-09", tags: ["all"], angle: "Thank you, mums: gifts and gratitude", leadDays: 6 },
  { id: "eid-adha-2027", name: "Eid al-Adha 2027", date: "2027-05-17", tags: ["muslim"], angle: "Eid al-Adha greetings and the meaning of sacrifice", approx: true, leadDays: 3 },
  { id: "islamic-new-year-2027", name: "Islamic New Year 1449", date: "2027-06-06", tags: ["muslim"], angle: "New Hijri year: fresh intentions", approx: true, leadDays: 1 },
  { id: "fathers-day-2027", name: "Father's Day 2027", date: "2027-06-20", tags: ["all"], angle: "Celebrating dads", leadDays: 5 },
  { id: "independence-pk-2027", name: "Pakistan Independence Day 2027", date: "2027-08-14", tags: ["pk"], angle: "Jashn-e-Azadi greeting, green and white", leadDays: 2 },
  { id: "back-to-school-2027", name: "Back to School 2027", date: "2027-08-30", tags: ["academy"], angle: "Start the new term strong", leadDays: 7 },
  { id: "teachers-day-2027", name: "World Teachers' Day 2027", date: "2027-10-05", tags: ["academy"], angle: "Thank a teacher", leadDays: 1 },
  { id: "black-friday-2027", name: "Black Friday 2027", date: "2027-11-26", tags: ["shop", "etsy"], angle: "Our Black Friday picks / offer (only real discounts)", leadDays: 5 },
  { id: "small-business-saturday-2027", name: "Small Business Saturday 2027", date: "2027-11-27", tags: ["shop", "etsy"], angle: "Shop small, support makers", leadDays: 1 },
  { id: "cyber-monday-2027", name: "Cyber Monday 2027", date: "2027-11-29", tags: ["shop", "etsy"], angle: "Last chance for the sale weekend", leadDays: 1 },
  { id: "etsy-holiday-shipping-2027", name: "Etsy holiday shipping cut-off 2027", date: "2027-12-15", tags: ["etsy"], angle: "Order now to get it before the holidays", approx: true, leadDays: 5 },
  { id: "christmas-2027", name: "Christmas 2027", date: "2027-12-25", tags: ["shop", "etsy"], angle: "Season's greetings and last-minute gifts", leadDays: 5 },
  { id: "quaid-day-2027", name: "Quaid-e-Azam Day 2027", date: "2027-12-25", tags: ["pk"], angle: "Remembering Quaid-e-Azam", leadDays: 1 },
];

/** Which occasion tags apply to a brand (from its brain text). */
export function brandOccasionTags(brain: Pick<BrandBrain, "niche" | "summary" | "products" | "audience" | "keywords" | "language">, website?: string): Set<OccasionTag> {
  const t = `${brain.niche} ${brain.summary} ${(brain.products ?? []).join(" ")} ${brain.audience} ${(brain.keywords ?? []).join(" ")} ${website ?? ""}`;
  const tags = new Set<OccasionTag>(["all"]);
  const kind = brandKind(brain);
  if (kind === "academy") tags.add("academy");
  if (kind === "handmade") tags.add("shop");
  if (/etsy/i.test(t)) tags.add("etsy");
  if (/\b(shop|store|gift|jewel|buy|order)/i.test(t)) tags.add("shop");
  if (/quran|qur'an|islam|muslim|tajweed|hadith|arabic|ramadan|eid|masjid|halal|hifz|nazra/i.test(t)) tags.add("muslim");
  if (/pakistan|karachi|lahore|islamabad|urdu|\.pk\b|rawalpindi|faisalabad|peshawar/i.test(t) || /^ur/.test(brain.language ?? "")) tags.add("pk");
  return tags;
}

/** Occasions relevant to the brand between `from` and `to` (by date; inclusive of the lead window). */
export function upcomingOccasions(brain: Parameters<typeof brandOccasionTags>[0], from: Date, to: Date, website?: string): Occasion[] {
  const tags = brandOccasionTags(brain, website);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const a = day(from);
  const b = day(new Date(to.getTime() + 0));
  return OCCASIONS.filter((o) => o.date >= a && o.date <= b && o.tags.some((t) => tags.has(t))).sort((x, y) => x.date.localeCompare(y.date));
}
