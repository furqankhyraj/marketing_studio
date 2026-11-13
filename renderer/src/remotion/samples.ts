import type { CarouselSpec, ReelSpec } from "../../../shared/types.ts";

export const SAMPLE_BRAND = {
  name: "Luna & Thread",
  handle: "@lunaandthread",
  colors: { primary: "#7A3E48", secondary: "#D9A5A0", accent: "#E8B04B", background: "#FBF6F0", text: "#2B1D1F" },
};

export const SAMPLE_REEL: ReelSpec = {
  width: 1080,
  height: 1920,
  fps: 30,
  style: "bold",
  captionStyle: "white-pill",
  brand: SAMPLE_BRAND,
  scenes: [
    { id: "s1", durationSec: 2.6, headline: "Handmade jewelry that tells your story", voiceoverText: "Handmade jewelry that tells your story." },
    { id: "s2", durationSec: 3, headline: "Every piece made by hand", subtext: "Recycled sterling silver", voiceoverText: "Every single piece is shaped by hand from recycled sterling silver." },
    { id: "s3", durationSec: 3, headline: "Your initials, your birthstone", subtext: "Personalised in 3 days", voiceoverText: "Add your initials and birthstone, ready in three days." },
    { id: "s4", durationSec: 2.4, headline: "Gift-ready packaging", subtext: "Free shipping over $35", voiceoverText: "Gift-wrapped and shipped free over thirty-five dollars." },
  ],
  cta: { text: "Get 15% off your first order", keyword: "GIFT" },
};

export const SAMPLE_CAROUSEL: CarouselSpec = {
  width: 1080,
  height: 1350,
  style: "bold",
  brand: SAMPLE_BRAND,
  slides: [
    { headline: "3 ways to style a name necklace", body: "Swipe for the looks" },
    { headline: "Layer it with a simple chain", body: "Mix 16 and 18 inch lengths for depth" },
    { headline: "Make it yours", body: "Shop the collection — link in bio" },
  ],
};
