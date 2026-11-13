// Pure metadata (no React / Remotion imports) so Node code can list styles without loading the composition.
import type { CaptionStyleMeta, StyleMeta } from "../../../../shared/types.ts";

export const CAPTION_STYLES: CaptionStyleMeta[] = [
  { id: "white-pill", name: "White Pill", description: "Bold dark words on a rounded white pill; active word in brand color." },
  { id: "black-bar", name: "Black Bar", description: "Classic broadcast caption: white text on a solid black bar." },
  { id: "yellow-didone", name: "Yellow Didone", description: "Elegant high-contrast serif in yellow with a soft shadow." },
  { id: "subtitle-strip", name: "Subtitle Strip", description: "Full-width translucent strip, cinema subtitle feel." },
  { id: "glass-pill", name: "Glass Pill", description: "Frosted-glass pill with white text and a glowing active word." },
  { id: "violet-pop", name: "Violet Pop", description: "Uppercase words that pop in with a violet highlighter box." },
  { id: "hustle-bold", name: "Hustle Bold", description: "Huge stroked uppercase words, active word in yellow-green." },
  { id: "lime-round", name: "Lime Round", description: "Rounded friendly words; the active word sits in a lime bubble." },
  { id: "brand-karaoke", name: "Brand Karaoke", description: "Words fill with your brand accent color as they are spoken." },
];

export const STYLE_LIST: StyleMeta[] = [
  {
    id: "persian",
    name: "Persian Tile",
    description: "Persian / Iranian art: girih star tiles, a mihrab arch window, gold carpet borders with turquoise corner medallions and a turning shamseh. Rich, cultural, devotional.",
    tags: ["cultural", "persian", "islamic", "elegant", "gold", "devotional"],
    supports: ["reel", "carousel", "story"],
  },
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Letterbox bars, slow Ken Burns, film grain and an elegant italic serif. Feels like a trailer.",
    tags: ["premium", "storytelling", "dark", "serif"],
    supports: ["reel", "carousel", "story"],
  },
  {
    id: "bold",
    name: "Bold",
    description: "Huge condensed uppercase type, slamming color blocks in your brand colors. Loud and scroll-stopping.",
    tags: ["loud", "typography", "color-block", "hook"],
    supports: ["reel", "carousel", "story"],
  },
  {
    id: "paper",
    name: "Paper Cut",
    description: "Textured paper, torn-strip headlines, tape and handwriting. Warm, handmade, craft-friendly.",
    tags: ["handmade", "craft", "warm", "etsy"],
    supports: ["reel", "carousel", "story"],
  },
  {
    id: "neon",
    name: "Neon Night",
    description: "Glowing neon type with flicker on a dark synthwave grid. Energetic, nightlife, tech.",
    tags: ["dark", "glow", "tech", "energetic"],
    supports: ["reel", "carousel", "story"],
  },
  {
    id: "magazine",
    name: "Magazine",
    description: "Editorial grid, Didone headlines, rules and drop caps — like a fashion magazine spread.",
    tags: ["editorial", "fashion", "elegant", "serif"],
    supports: ["reel", "carousel", "story"],
  },
  {
    id: "product-drop",
    name: "Product Drop",
    description: "Hero product zooms in under a spotlight with a swinging price-tag card and a NEW DROP ticker.",
    tags: ["product", "launch", "ecommerce", "etsy", "sale"],
    supports: ["reel", "carousel", "story"],
  },
  {
    id: "text-list",
    name: "Text List",
    description: "Numbered list that reveals point by point — perfect for tips, steps and listicles.",
    tags: ["educational", "tips", "listicle", "clean"],
    supports: ["reel", "carousel", "story"],
  },
  {
    id: "blueprint",
    name: "Blueprint",
    description: "Technical drawing: grid paper, self-drawing frames, dimension lines and monospaced type.",
    tags: ["technical", "engineering", "education", "how-it-works"],
    supports: ["reel", "carousel"],
  },
  {
    id: "zine",
    name: "Zine",
    description: "DIY collage: ransom-note words in mixed fonts, halftone dots, stickers and stop-motion jitter.",
    tags: ["playful", "diy", "collage", "youth"],
    supports: ["reel", "carousel", "story"],
  },
  {
    id: "pulse",
    name: "Pulse",
    description: "Beat-synced: type thumps and colors flip on every beat with expanding rings. Built for music.",
    tags: ["music", "energetic", "beat", "hype"],
    supports: ["reel", "story"],
  },
  {
    id: "clarity",
    name: "Clarity",
    description: "Minimal and clean: lots of white space, tight sans headlines, a single accent line.",
    tags: ["minimal", "clean", "professional", "education"],
    supports: ["reel", "carousel", "story"],
  },
  {
    id: "ember",
    name: "Ember",
    description: "Warm fire gradients with rising glowing particles and a soft display serif. Cozy, emotional.",
    tags: ["warm", "emotional", "cozy", "gradient"],
    supports: ["reel", "carousel", "story"],
  },
  {
    id: "velocity",
    name: "Velocity",
    description: "Fast whip transitions, skewed type, speed lines and motion blur. Sporty and urgent.",
    tags: ["fast", "sport", "urgent", "hype"],
    supports: ["reel", "carousel", "story"],
  },
  {
    id: "story",
    name: "Story",
    description: "Soft warm blobs and floating quote cards with an italic serif. Gentle, personal, testimonial-ready.",
    tags: ["soft", "warm", "quote", "testimonial", "personal"],
    supports: ["reel", "carousel", "story"],
  },
];

export const STYLE_META: Record<string, StyleMeta> = Object.fromEntries(STYLE_LIST.map((s) => [s.id, s]));
