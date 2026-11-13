// Brand / post language → narration voice + caption mode.
// Brand-level setting: brand.brain.language ("en" | "ur" | "ur-roman"); per-post override: spec.language.
//  - "ur":       Urdu-script voiceoverText (Piper Urdu voice), Urdu-script headlines + Nastaliq captions
//  - "ur-roman": Urdu-script voiceoverText for the voice, Roman Urdu (Latin) headlines; captions use
//                scene.captionText (Roman Urdu) when present
//  - "ar":       Arabic (Modern Standard Arabic): Arabic-script narration (Piper ar_kareem), Arabic headlines,
//                Naskh captions (renderer loads Noto Naskh Arabic for spec.language "ar")
//  - "en":       English (Kokoro)
// The Urdu voice is only used when the narration text really is Urdu script; Latin text always goes to the
// English voice (espeak "ur" cannot read Roman Urdu / English).
import type { Brand, ReelSpec } from "../../shared/types.ts";

export type BrandLanguage = "en" | "ur" | "ur-roman" | "ar";
export const URDU_VOICES = ["ur_fasih", "ur_aegis_female"] as const;
export const DEFAULT_URDU_VOICE = "ur_fasih";
export const ARABIC_VOICES = ["ar_kareem"] as const;
export const DEFAULT_ARABIC_VOICE = "ar_kareem";
export const isArabicVoice = (id?: string) => !!id && (ARABIC_VOICES as readonly string[]).includes(id);

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
export const hasUrduScript = (t: string | undefined) => ARABIC_SCRIPT.test(t ?? "");

/** Normalise free-form language values ("urdu", "ur-PK", "Roman Urdu", "ur-Latn"...) to our three modes. */
export function normalizeLanguage(v: unknown): BrandLanguage {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "en";
  if (/^ar\b|arabic|عربي|العربية/.test(s)) return "ar";
  if (/roman|latn|ur[-_ ]?en/.test(s)) return "ur-roman";
  if (/^ur\b|urdu|اردو/.test(s)) return "ur";
  return "en";
}

export function brandLanguage(brand: Brand | undefined): BrandLanguage {
  return normalizeLanguage(brand?.brain?.language);
}

export function specLanguage(spec: { language?: string } | undefined, brand: Brand | undefined): BrandLanguage {
  return spec?.language ? normalizeLanguage(spec.language) : brandLanguage(brand);
}

export const isUrduVoice = (id?: string) => !!id && (URDU_VOICES as readonly string[]).includes(id);

/** Voice + language for a reel's narration. `settingsVoice` is the global Kokoro voice. */
export function narrationFor(spec: ReelSpec, brand: Brand | undefined, settingsVoice?: string): { lang: "en" | "ur"; voice?: string } {
  const urdu = spec.scenes.some((sc) => hasUrduScript(sc.voiceoverText));
  const postVoice = spec.voice; // per-post override (set from chat / MCP)
  const brandVoice = brand?.brain?.voiceId;
  // Arabic script + Arabic post/brand (or an Arabic voice chosen) → Piper Arabic voice. The voice package treats all
  // Arabic-script narration on the "ur" path (Piper + timing-only alignment); the voice id picks the language model.
  if (urdu && (specLanguage(spec, brand) === "ar" || isArabicVoice(postVoice))) {
    const v = [postVoice, brandVoice].find(isArabicVoice);
    return { lang: "ur", voice: v ?? DEFAULT_ARABIC_VOICE };
  }
  if (urdu) {
    const v = [postVoice, brandVoice].find(isUrduVoice);
    return { lang: "ur", voice: v ?? DEFAULT_URDU_VOICE };
  }
  const v = [postVoice, brandVoice].find((x) => x && !isUrduVoice(x) && !isArabicVoice(x));
  return { lang: "en", voice: v ?? settingsVoice };
}

/** Prompt guidance appended to LLM prompts (planner / change requests) for Urdu brands. */
export function languageGuide(lang: BrandLanguage): string {
  if (lang === "ur")
    return `LANGUAGE: Urdu. Write every "voiceoverText" in Urdu script (Nastaliq/Arabic letters, e.g. "آج ہم سیکھیں گے"), never Roman Urdu or English letters — write English terms phonetically in Urdu script (AI → "اے آئی", video → "ویڈیو", Instagram → "انسٹاگرام"). Write on-screen "headline", "subtext", "bullets" and carousel slide text in Urdu script too (short). Captions and hashtags may mix Urdu and English. Use natural spoken Pakistani Urdu, end sentences with "۔". The CTA keyword stays one UPPERCASE Latin word (e.g. LEARN).`;
  if (lang === "ur-roman")
    return `LANGUAGE: Roman Urdu on screen, Urdu voice. Write every "voiceoverText" in Urdu script (Arabic letters, e.g. "آج ہم سیکھیں گے"; English terms phonetically: AI → "اے آئی") — it is read by an Urdu text-to-speech voice that cannot read Latin letters. For each scene also give "captionText": the same sentence in Roman Urdu (Latin letters, e.g. "Aaj hum seekhein ge"). Write "headline", "subtext", "bullets", slide text and the Instagram caption in Roman Urdu. The CTA keyword stays one UPPERCASE Latin word.`;
  if (lang === "ar")
    return `LANGUAGE: Arabic. Write every "voiceoverText" in Modern Standard Arabic (فصحى) in Arabic script, short natural sentences, never transliterated Latin letters — write brand/app names in Arabic letters for the voice (e.g. Azkaar → "أذكار"). Write on-screen "headline", "subtext", "bullets" and carousel slide text in Arabic too (short), plus the Instagram caption. Hashtags may mix Arabic and English. The CTA keyword stays one UPPERCASE Latin word (e.g. APP).`;
  return "";
}
