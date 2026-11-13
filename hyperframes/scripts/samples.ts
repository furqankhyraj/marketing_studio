import type { BrandStyleRef, Scene } from "../../shared/types.ts";

const img = (id: number, w = 1080, h = 1350) => `https://picsum.photos/id/${id}/${w}/${h}`;

export type Sample = { brand: BrandStyleRef; scenes: Record<string, Scene[]>; cta: { text: string; keyword?: string } };

export const etsy: Sample = {
  brand: {
    name: "Willow & Clay",
    handle: "@willowandclay",
    colors: { primary: "#B5562F", secondary: "#E8C9A6", accent: "#2F5D50", background: "#FBF5EE", text: "#2B1D14" },
    fonts: { heading: "Playfair Display", body: "Poppins" },
  },
  cta: { text: "and we'll DM you the shop link", keyword: "MUG" },
  scenes: {
    "kinetic-type": [
      { id: "1", durationSec: 2.6, headline: "Handmade mugs that feel like *home*", subtext: "Small-batch stoneware from our tiny studio" },
      { id: "2", durationSec: 2.6, headline: "Every glaze is *one of a kind*", media: { src: img(1060), kind: "image" } },
      { id: "3", durationSec: 2.8, headline: "Gift-ready in 3 days", bullets: ["Free gift wrap", "Ships worldwide"] },
    ],
    "product-showcase": [
      { id: "1", durationSec: 3.6, headline: "The *Morning Ritual* mug", subtext: "$34", bullets: ["Hand-thrown stoneware", "Holds 12 oz", "Dishwasher safe"], media: { src: img(30), kind: "image" } },
      { id: "2", durationSec: 3.6, headline: "Speckled oat glaze", subtext: "Pairs with any kitchen — $38", bullets: ["Lead-free glaze", "Microwave safe"], media: { src: img(63), kind: "image" } },
      { id: "3", durationSec: 3.2, headline: "Matching pour-over set", subtext: "€56 bundle", media: { src: img(431), kind: "image" } },
    ],
    "course-promo": [
      { id: "1", durationSec: 3.4, headline: "Learn to throw your first *mug*", subtext: "Pottery workshop", media: { src: img(1059), kind: "image" } },
      { id: "2", durationSec: 3.8, headline: "In one weekend you'll learn", bullets: ["Centering clay", "Pulling walls", "Trimming & handles", "Glazing basics"] },
      { id: "3", durationSec: 3.2, headline: "Taught by Mira, potter for 12 years", subtext: "Founder of Willow & Clay", media: { src: img(1027, 800, 800), kind: "image" } },
    ],
    "testimonial-quote": [
      { id: "1", durationSec: 4.6, headline: "My coffee tastes better in this mug. I bought *three more* as gifts!", subtext: "Hannah R., Ohio", bullets: ["Morning Ritual mug"], media: { src: img(64, 400, 400), kind: "image" } },
      { id: "2", durationSec: 4.4, headline: "Packaged so beautifully — it arrived like a *present*.", subtext: "Lucas M.", media: { src: "https://picsum.photos/this-url-does-not-exist.jpg", kind: "image" } },
    ],
    "listicle-5-tips": [
      { id: "0", durationSec: 3, headline: "Tips to make your *handmade mug* last forever", subtext: "From our studio to your kitchen" },
      { id: "1", durationSec: 3, headline: "Warm it up first", subtext: "Rinse with warm water before pouring boiling coffee." },
      { id: "2", durationSec: 3, headline: "Hand-wash the *glaze*", subtext: "Dishwashers are safe, but hand-washing keeps the shine.", media: { src: img(42), kind: "image" } },
      { id: "3", durationSec: 3, headline: "Skip the scrubbers", bullets: ["Soft sponge only", "Baking soda for stains"] },
      { id: "4", durationSec: 3, headline: "Store with space", subtext: "Don't stack mugs inside each other." },
      { id: "5", durationSec: 3, headline: "Use it every day", subtext: "Handmade pieces are made to be loved." },
    ],
    "before-after": [
      { id: "1", durationSec: 3.2, headline: "A lump of raw clay", subtext: "Day 1 on the wheel", media: { src: img(1062), kind: "image" } },
      { id: "2", durationSec: 3.8, headline: "Your new *favorite* mug", subtext: "7 days, 2 firings, 1 glaze", media: { src: img(30), kind: "image" } },
      { id: "3", durationSec: 3, headline: "Made by hand, start to finish", bullets: ["Food-safe glaze", "Signed by the maker"] },
    ],
  },
};

export const saqqa: Sample = {
  brand: {
    name: "Saqqa Academy",
    handle: "@saqqa.academy",
    colors: { primary: "#0F4C81", secondary: "#38BDF8", accent: "#FACC15", background: "#F4F8FC", text: "#0B1B2B" },
    fonts: { heading: "Montserrat", body: "Inter" },
  },
  cta: { text: "to get the free first lesson in your DMs", keyword: "LEARN" },
  scenes: {
    "kinetic-type": [
      { id: "1", durationSec: 2.6, headline: "Stop scrolling. *Start building.*", subtext: "Practical courses for real careers" },
      { id: "2", durationSec: 2.6, headline: "Learn the skills employers *actually* want", media: { src: img(180), kind: "image" } },
      { id: "3", durationSec: 2.8, headline: "Live mentors. Real projects.", bullets: ["Arabic & English", "Certificate"] },
    ],
    "product-showcase": [
      { id: "1", durationSec: 3.6, headline: "Web Development *Bootcamp*", subtext: "$49 / month", bullets: ["40+ video lessons", "Weekly live Q&A", "Portfolio projects"], media: { src: img(0), kind: "image" } },
      { id: "2", durationSec: 3.4, headline: "UI/UX Design Starter", subtext: "Lifetime access — $79", bullets: ["Figma templates", "Mentor feedback"], media: { src: img(20), kind: "image" } },
    ],
    "course-promo": [
      { id: "1", durationSec: 3.4, headline: "Become a *Front-End Developer* in 12 weeks", subtext: "Enrollment open" },
      { id: "2", durationSec: 4, headline: "Your roadmap", subtext: "Course modules", bullets: ["HTML & CSS foundations", "JavaScript in depth", "React & APIs", "Build 3 portfolio apps", "Interview prep"] },
      { id: "3", durationSec: 3.2, headline: "Eng. Omar Saqqa", subtext: "10 years at product startups • 4,000+ students", media: { src: img(1005, 800, 800), kind: "image" } },
      { id: "4", durationSec: 2.8, headline: "Learn at your pace, *anywhere*", subtext: "Mobile-friendly lessons, Arabic & English" },
    ],
    "testimonial-quote": [
      { id: "1", durationSec: 4.6, headline: "I landed my first *developer job* three months after finishing the bootcamp.", subtext: "Lina K., Amman", bullets: ["Web Dev Bootcamp"] },
      { id: "2", durationSec: 4.4, headline: "The mentors actually review your code. That changed *everything* for me.", subtext: "Yousef A.", media: { src: img(338, 400, 400), kind: "image" } },
    ],
    "listicle-5-tips": [
      { id: "0", durationSec: 3, headline: "Ways to learn coding *faster*", subtext: "Save this before your next study session" },
      { id: "1", durationSec: 3, headline: "Build, don't binge", subtext: "One small project beats ten tutorials." },
      { id: "2", durationSec: 3, headline: "Code *every* day", subtext: "30 focused minutes > 5 hours on Sunday." },
      { id: "3", durationSec: 3, headline: "Read error messages", bullets: ["Copy the exact line", "Google it with the language name"] },
      { id: "4", durationSec: 3, headline: "Teach what you learn", subtext: "Explaining it is the fastest way to master it.", media: { src: img(24), kind: "image" } },
      { id: "5", durationSec: 3, headline: "Get a mentor", subtext: "Feedback turns months into weeks." },
    ],
    "before-after": [
      { id: "1", durationSec: 3.2, headline: "Copy-pasting tutorials", subtext: "Week 1" },
      { id: "2", durationSec: 3.8, headline: "Shipping your *own* apps", subtext: "Week 12 at Saqqa Academy" },
      { id: "3", durationSec: 3, headline: "What changed", bullets: ["Real projects", "Weekly code reviews", "A portfolio that gets interviews"] },
    ],
  },
};

export const SAMPLES: Record<string, Sample> = { etsy, saqqa };
