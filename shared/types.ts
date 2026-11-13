// Shared contract types for Social MCP Studio.
// Pure types only (no runtime code, no imports) so every package can import this file.
// Import with:  import type { ... } from "../../shared/types.ts"  (adjust relative path)

export type ID = string; // nanoid-style string ids

// ---------- Brand ----------
export interface BrandColors {
  primary: string;    // hex, e.g. "#1E3A8A"
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

export interface BrandBrain {
  summary: string;              // one paragraph: what the business does
  products: string[];           // what you sell
  audience: string;             // who it's for
  voice: string;                // tone of voice description
  niche: string;
  colors: BrandColors;
  fonts?: { heading?: string; body?: string };
  logoUrl?: string;             // http URL (local server /files/... or remote)
  claimsToAvoid: string[];      // things the brand must never claim
  differentiators: string[];    // what makes them different
  ctas: string[];               // e.g. "Shop on Etsy — link in bio"
  keywords: string[];           // hashtags / SEO keywords (no #)
  contentPillars: string[];     // recurring themes
  competitors?: string[];       // similar creators/brands
  bestTimes?: string[];         // e.g. ["Tue 18:00","Thu 12:30","Sat 10:00"] local time
  language?: string;            // default "en". "ur" = Urdu script (Piper Urdu voice + Nastaliq captions), "ur-roman" = Urdu voice, Roman Urdu (Latin) on-screen text/captions
  voiceId?: string;             // optional per-brand narration voice (e.g. "ur_fasih", "ur_aegis_female", or a Kokoro id); default: settings.voice / ur_fasih for Urdu
}

export interface Brand {
  id: ID;
  name: string;
  website?: string;
  instagramHandle?: string;
  driveLink?: string;
  description?: string;         // "What your business does" free text
  brain?: BrandBrain;           // undefined until analysis has run
  analysisStatus: "idle" | "running" | "done" | "failed";
  analysisError?: string;
  igConnected: boolean;         // token present (token itself is never returned by the API)
  igUserId?: string;
  createdAt: string;            // ISO
  updatedAt: string;
}

export interface Asset {
  id: ID;
  brandId: ID;
  kind: "image" | "video" | "audio";
  url: string;                  // http URL served by the server: http://localhost:4300/files/uploads/...
  path: string;                 // absolute local path
  originalName: string;
  mime: string;
  size: number;
  createdAt: string;
}

// ---------- Audit ----------
export interface Audit {
  id: ID;
  brandId: ID;
  summary: string;
  strengths: string[];          // "what your account does well"
  weaknesses: string[];         // "what holds it back"
  opportunities: string[];
  firstReels: { title: string; hook: string; why: string }[]; // first 3 reels we will make
  createdAt: string;
}

// ---------- Render specs (consumed by renderer) ----------
export interface MediaRef {
  src: string;                  // http(s) URL (renderer fetches it). Local files are exposed via server /files/...
  kind: "image" | "video";
  frame?: "phone";              // show the whole image inside a phone frame (app screenshots) instead of cropping it to fill
}

export interface Scene {
  id: string;
  durationSec: number;          // 1.5 – 8 typical
  headline: string;             // big on-screen text
  subtext?: string;
  bullets?: string[];
  media?: MediaRef;
  voiceoverText?: string;       // narration line for this scene (also used for captions)
  captionText?: string;         // optional on-screen caption text when it differs from voiceoverText (e.g. Roman Urdu transliteration of Urdu-script narration)
}

export interface BrandStyleRef {
  name: string;
  handle?: string;              // "@saqqa.academy"
  colors: BrandColors;
  logoUrl?: string;
  fonts?: { heading?: string; body?: string };
}

export interface ReelSpec {
  width: number;                // 1080
  height: number;               // 1920
  fps: number;                  // 30
  style: string;                // StyleMeta.id, e.g. "cinematic"
  captionStyle?: string;        // CaptionStyleMeta.id, e.g. "white-pill"; omit = none
  brand: BrandStyleRef;
  scenes: Scene[];
  cta?: { text: string; keyword?: string }; // final end card ("Comment GROW")
  music?: MusicRef;                          // background music (mixed + ducked under the voice by the server)
  musicOff?: boolean;                        // true = the user removed music; auto-music will not add any
  voiceover?: { src: string };               // http URL to full narration audio
  voice?: string;                            // per-post narration voice id (overrides brand/settings voice)
  // Word-level caption timings (from whisper.cpp on the voiceover). When present, renderer uses these
  // instead of evenly spacing scene.voiceoverText words. Times are from the start of the video.
  captions?: { text: string; startMs: number; endMs: number }[];
  // When a voiceover exists, scene durations should already be stretched to fit the narration (server does this).
  language?: string;            // per-post override of brand.brain.language: "en" | "ur" | "ur-roman"
}

// Second render engine: HyperFrames (HTML + GSAP compositions → MP4, Apache-2.0).
// Lets Claude (via MCP) author a fully custom reel as HTML. Post.type "reel"/"story" may carry this spec.
export interface HtmlReelSpec {
  engine: "hyperframes";
  width: number;                // 1080
  height: number;               // 1920
  fps?: number;                 // 30
  durationSec: number;
  html: string;                 // full HyperFrames composition (index.html contents)
  template?: string;            // template id it was generated from, if any
  assets?: { name: string; src: string }[]; // http URLs downloaded next to index.html as ./assets/<name>
  brand?: BrandStyleRef;
  // Audio (muxed into the MP4 by the server after the HTML render)
  music?: MusicRef;
  musicOff?: boolean;
  // Narration audio. `segments` place slices of the narration file on the video timeline (template reels);
  // without segments the file plays from t=0.
  voiceover?: { src: string; segments?: { startMs: number; endMs: number; atMs: number }[] };
  voice?: string;               // per-post narration voice id
  // Narration lines for custom HTML (no template): synthesized, concatenated and played from t=0.
  narration?: { id: string; text: string }[];
  // The input buildFromTemplate() used, so the server can re-time scenes to the narration and rebuild the HTML.
  templateInput?: { brand: BrandStyleRef; scenes: Scene[]; cta?: { text: string; keyword?: string }; durationSec?: number };
}

// ---------- Music ----------
export interface MusicRef {
  src: string;                  // http URL (or /files URL) of the track
  volume?: number;              // 0–1 music level relative to the voice (default Settings.musicVolume)
  trackId?: string;             // MusicTrack.id it came from
  credit?: string;              // attribution, appended to the IG caption as "Music: <credit>"
  auto?: boolean;               // picked automatically (auto-music)
}

export interface MusicTrack {
  id: string;                   // "builtin:<mood>" | "library:<file>" | "asset:<assetId>"
  name: string;
  mood?: string;                // calm | lofi | upbeat | inspiring | cinematic | playful | elegant | focus
  energy?: number;              // 1–5
  source: "builtin" | "library" | "asset";
  url: string;                  // http URL (builtin tracks are generated on first request)
  durationSec?: number;
  license?: string;
  credit?: string;
  brandId?: ID;                 // asset tracks
}

export interface CarouselSlide {
  headline: string;
  body?: string;
  media?: MediaRef;
}

export interface CarouselSpec {
  width: number;                // 1080
  height: number;               // 1350
  style: string;
  brand: BrandStyleRef;
  slides: CarouselSlide[];      // 2–10
}

export interface StyleMeta {
  id: string;
  name: string;
  description: string;
  tags: string[];
  supports: ("reel" | "carousel" | "story")[];
  previewUrl?: string;          // optional thumbnail
}

export interface CaptionStyleMeta {
  id: string;
  name: string;
  description: string;
}

// ---------- Posts ----------
export type PostType = "reel" | "carousel" | "story" | "image"; // "image" = single 4:5 feed graphic (ImageSpec)
export type PostStatus =
  | "draft"              // idea/spec exists, not rendered
  | "rendering"
  | "ready"              // rendered, waiting for your yes
  | "changes_requested"  // user asked for a change; being remade
  | "approved"           // approved, waiting for its scheduled time
  | "publishing"
  | "posted"
  | "failed";

export interface Post {
  id: ID;
  brandId: ID;
  type: PostType;
  status: PostStatus;
  title: string;
  hook: string;
  caption: string;              // Instagram caption (without hashtags)
  hashtags: string[];           // without '#'
  spec: ReelSpec | CarouselSpec | HtmlReelSpec | ImageSpec; // ImageSpec for type "image"; ReelSpec (Remotion) or HtmlReelSpec (HyperFrames, has engine:"hyperframes") for reel/story; CarouselSpec for carousel
  scheduledAt?: string;         // ISO
  postedAt?: string;
  igMediaId?: string;
  igPermalink?: string;
  mediaUrls: string[];          // rendered outputs (http URLs): [video] or [slide1.png, ...]
  thumbnailUrl?: string;
  renderProgress?: number;      // 0..1 while rendering
  error?: string;
  revision: number;
  changeRequests: { text: string; createdAt: string }[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Automations (comment → DM) ----------
export interface Automation {
  id: ID;
  brandId: ID;
  keyword: string;              // case-insensitive match, e.g. "GROW"
  replyText: string;            // public comment reply
  dmText: string;               // private DM text
  link?: string;
  enabled: boolean;
  postId?: ID;                  // limit to one post; omit = all posts
  createdAt: string;
}

export interface CommentLog {
  id: ID;
  brandId: ID;
  igCommentId: string;
  igMediaId: string;
  username: string;
  text: string;
  matchedKeyword?: string;
  replied: boolean;
  dmSent: boolean;
  error?: string;
  createdAt: string;
}

export interface Settings {
  anthropicApiKeySet: boolean;  // API never returns the key itself
  claudeSubscriptionSet?: boolean; // Claude Code OAuth token (claude setup-token) stored — writing runs on the Claude subscription via the claude CLI
  llmProvider?: "auto" | "api" | "subscription"; // auto = subscription when a token is set, else API key
  anthropicModel: string;       // default "claude-sonnet-5-5"
  igAppId?: string;
  igAppSecretSet: boolean;
  publicBaseUrl?: string;       // optional tunnel URL (e.g. cloudflared) for IG to fetch media
  timezone: string;             // e.g. "Asia/Karachi"
  autoPublish: boolean;         // publish approved posts at their time (default true)
  voice: string;                // Kokoro voice id, default "af_heart"
  autoVoiceover: boolean;       // default true
  autoMusic: boolean;           // add a mood-matched background track to reels/stories (default true)
  musicVolume: number;          // 0–1 music level relative to the voice (default 0.3; ducked further while speaking)
  defaultMusicMood?: string;    // force one mood for auto-music (omit = pick from brand + post)
  pexelsApiKeySet: boolean;
  pixabayApiKeySet: boolean;
}

export interface ApiError { error: string }

// ---------- Chat (post chat + global assistant) ----------
export type ChatMode = "llm" | "rules";

/** A link shown on an action card: either a dashboard route (`to`) or a post to open (`postId`). */
export interface ChatLink {
  label: string;
  to?: string;                  // web route, e.g. "/calendar", "/audit", "/brands/<id>"
  postId?: ID;                  // open this post's detail drawer
}

/** One tool call the assistant made (or proposes, when it needs the user's confirmation). */
export interface ChatAction {
  id: ID;
  tool: string;                 // tool name, e.g. "plan_content", "approve_post"
  label: string;                // human summary, e.g. "Planned 3 reels"
  status: "done" | "failed" | "pending_confirmation" | "confirmed" | "cancelled";
  detail?: string;              // longer result text / error
  input?: Record<string, unknown>; // tool input (kept for pending confirmations)
  links?: ChatLink[];
  postIds?: ID[];
  brandId?: ID;
  revision?: number;            // post revision this action produced (post edits)
}

export interface ChatMessage {
  id: ID;
  sessionId: ID;
  role: "user" | "assistant";
  text: string;
  actions?: ChatAction[];
  mode?: ChatMode;              // assistant messages: answered by Claude (llm) or the rule-based router
  revision?: number;            // post chat: revision number produced by this reply
  createdAt: string;
}

export interface ChatSession {
  id: ID;
  kind: "global" | "post";
  postId?: ID;                  // kind "post"
  brandId?: ID;
  title: string;
  context?: { lastPostIds?: ID[]; brandId?: ID }; // short-term memory for follow-ups ("approve them")
  createdAt: string;
  updatedAt: string;
}

/** Response of POST /api/chat, POST /api/posts/:id/chat and POST /api/chat/confirm. */
export interface ChatResponse {
  session: ChatSession;
  messages: ChatMessage[];      // new or updated messages of this turn (replace by id on the client)
  post?: Post;                  // post chat: the post after the turn
  mode: ChatMode;
}

/** A rendered revision of a post (GET /api/posts/:id/revisions). */
export interface PostRevision {
  revision: number;
  mediaUrls: string[];
  thumbnailUrl?: string;
  createdAt: string;
  current: boolean;
}

// ---------- Instagram growth (growth agent) ----------
// Extra Post fields merged into the Post interface above (TypeScript interface declaration merging).
export type TrialGraduation = "MANUAL" | "SS_PERFORMANCE";
export interface TrialReelOptions {
  enabled: boolean;
  graduation: TrialGraduation;  // MANUAL = graduate in the IG app; SS_PERFORMANCE = auto-graduate if it performs well
}

export interface HookScores {
  curiosity: number;            // 1-10
  specificity: number;          // 1-10
  clarity: number;              // 1-10: readable in the first 3 seconds
}

export interface HookVariant {
  text: string;
  score: number;                // 1-10 overall (mean of scores)
  scores: HookScores;
  why?: string;
  source: "llm" | "heuristic";
}

export interface Post {
  altText?: string[];           // alt text per image (index-aligned with mediaUrls); carousel/image posts only
  coverUrl?: string;            // branded reel cover (JPEG, /files URL); sent as cover_url when publicBaseUrl is set
  coverRevision?: number;       // post.revision the cover was rendered for
  coverThumbOffsetMs?: number;  // fallback cover frame (thumb_offset) when no public cover URL; default 1000
  trial?: TrialReelOptions;     // reels only: publish as a trial reel (trial_params)
  collaborators?: string[];     // up to 3 IG usernames (reels, feed images, carousels; not stories)
  audioName?: string;           // reels: rename the original audio (once). undefined = "<Brand> original audio", "" = don't send
  hookVariants?: HookVariant[]; // last generated hook A/B variants
  publishWarnings?: string[];   // optional params Instagram rejected on the last publish (retried without them)
}

// ---------- Image posts (single 4:5 feed graphic, autopost agent) ----------
export type ImageDesign =
  | "quote"         // big quote + author
  | "tip"           // eyebrow "TIP", headline, 1-4 bullet steps
  | "product"       // product spotlight: brand photo + name + price + CTA
  | "offer"         // announcement / offer: badge ("20% OFF", "NEW"), headline, price / old price, CTA
  | "testimonial"   // review card: stars, quote, author
  | "question"      // engagement: question + options A/B ("Comment A or B")
  | "before-after"  // two panels (options[0] = before, options[1] = after)
  | "fact";         // "Did you know?" fact

export interface ImageOption {
  label: string;                // "A", "B", "Before", "After"
  text: string;
  media?: MediaRef;             // optional photo per option (image only)
}

/** Rendered by renderer `renderImagePost` (Remotion still of the "ImagePost" composition) → image.png + thumb.jpg. */
export interface ImageSpec {
  kind: "image";                // discriminator
  width: number;                // 1080
  height: number;               // 1350 (4:5)
  design: ImageDesign;
  style?: string;               // StyleMeta.id: the image reuses that style's background, fonts and decoration
  brand: BrandStyleRef;
  headline: string;             // main text (quote / tip title / product name / offer headline / question / fact)
  eyebrow?: string;             // small label above the headline ("TIP #3", "DID YOU KNOW?", "NEW DROP")
  body?: string;                // supporting text
  bullets?: string[];           // tip steps (max 4)
  author?: string;              // quote / testimonial attribution
  rating?: number;              // testimonial stars 1–5
  price?: string;               // "$24", "Rs 2,500"
  oldPrice?: string;            // struck-through price
  badge?: string;               // "20% OFF", "NEW", "LIMITED"
  cta?: string;                 // footer line: "Shop now — link in bio", "Comment A or B 👇"
  options?: ImageOption[];      // question: 2–3 choices; before-after: exactly 2
  media?: MediaRef;             // product photo / background photo (image)
  language?: string;            // per-post override of brand.brain.language
  variant?: string;             // style "persian": mihrab | toranj | tazhib | kashi | shab (default: picked from the headline)
}

// ---------- Autopilot (fully automatic weekly content, autopost agent) ----------
export interface AutopilotSettings {
  enabled: boolean;
  postsPerWeek: { reel: number; carousel: number; image: number; story: number };
  approval: "manual" | "auto";  // manual (default) = lands in "Waiting for your yes"; auto = approved without review
  leadDays: number;             // keep the next N days filled (default 7)
  pillars?: string[];           // content pillars to rotate (default: brand.brain.contentPillars)
  occasions?: boolean;          // use the built-in occasion calendar (Eid, Black Friday, …) — default true
  render?: boolean;             // render new posts right away (default true)
  lastRunAt?: string;           // ISO, set by the worker
  lastResult?: string;          // short human summary of the last run
  pillarCursor?: number;        // rotation state
}

export interface Brand {
  autopilot?: AutopilotSettings; // undefined = off
}

/** What autopilot made / what is waiting / what is scheduled (GET /api/autopilot/digest). */
export interface AutopilotDigest {
  generatedAt: string;
  brands: {
    brandId: ID;
    brandName: string;
    enabled: boolean;
    approval: "manual" | "auto";
    lastRunAt?: string;
    lastResult?: string;
    target: number;               // posts per week (all formats)
    scheduledNext7: number;       // posts with a slot in the next 7 days (not failed)
    madeToday: { id: ID; title: string; type: PostType; status: PostStatus }[];
    waiting: { id: ID; title: string; type: PostType; scheduledAt?: string; autopilot: boolean }[];
    scheduled: { id: ID; title: string; type: PostType; scheduledAt: string; status: PostStatus }[];
    upcomingOccasions: { name: string; date: string }[];
  }[];
}

export interface Post {
  autopilot?: boolean;          // created by the autopilot worker
  pillar?: string;              // content pillar it was planned for
  occasion?: string;            // occasion it was planned for (e.g. "Eid al-Adha 2027")
}

// ---------- Long video → short clips (clips agent; server/src/clips.ts) ----------
export type ClipLayout = "auto" | "fill-blur" | "center-crop" | "split";
export interface ClipWord { text: string; startMs: number; endMs: number }
export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  words?: ClipWord[];            // word timings (estimated by letter count for imported SRT)
}
export interface ClipTranscript {
  version: 1;
  language: string;             // "en" | "ur" | other whisper code
  model?: string;               // whisper model used ("base.en", "base", "small") or "import"
  source: "whisper" | "import";
  durationMs: number;
  segments: TranscriptSegment[];
  createdAt: string;
}
export interface ClipMoment {
  id: string;
  startMs: number;              // in the source video
  endMs: number;
  title: string;                // hook title shown on the clip
  why?: string;                 // why it is a good clip
  score: number;                // 0–100 virality estimate
  source: "llm" | "heuristic" | "custom";
  text?: string;                // transcript of the range (short)
  caption?: string;
  hashtags?: string[];
  postId?: string;              // the Post created for it
  status: "pending" | "rendering" | "ready" | "failed" | "deleted";
  error?: string;
}
export type ClipJobStage = "extract" | "transcribe" | "pick" | "render";
export interface ClipJobStageState {
  id: ClipJobStage;
  label: string;
  status: "pending" | "running" | "done" | "skipped" | "failed";
  progress: number;             // 0..1
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
}
export interface ClipJobOptions {
  language: "auto" | "en" | "ur";
  maxClips: number;             // default 5
  targetSec: [number, number];  // default [20, 60]
  layout: ClipLayout;           // default "auto"
  captionStyle?: string;        // CaptionStyleMeta.id (default "white-pill")
  music?: boolean;              // low background music (default false for lessons)
  showProgress?: boolean;       // progress bar on the clip (default true)
}
export interface ClipJob {
  id: string;
  brandId: string;
  status: "queued" | "running" | "waiting" | "done" | "failed" | "cancelled"; // waiting = paused for the normal render queue
  source: { assetId?: string; path: string; name: string; durationMs?: number; width?: number; height?: number };
  options: ClipJobOptions;
  stage?: ClipJobStage;
  stages: ClipJobStageState[];
  progress: number;             // 0..1 overall
  etaSec?: number;              // remaining seconds estimate for the current stage(s)
  language?: string;            // detected / used transcript language
  model?: string;               // whisper model used
  transcriptCached?: boolean;
  moments: ClipMoment[];
  pickedBy?: "llm" | "heuristic";
  metrics?: { transcribeRtf?: number; audioSec?: number; transcribeSec?: number; renderSecPerClip?: number[] };
  error?: string;
  createdAt: string;
  updatedAt: string;
}
/** Post.spec for a clip cut from a long video (engine "clip"; Post.type "reel"). Rendered by clips.ts + renderer ClipReel. */
export interface ClipReelSpec {
  engine: "clip";
  width: number;                // 1080
  height: number;               // 1920
  fps: number;                  // 30
  source: { assetId?: string; path?: string; name?: string };
  startMs: number;
  endMs: number;
  layout: Exclude<ClipLayout, "auto">;
  captionStyle?: string;        // omit = no captions
  hookTitle?: string;           // title bar text
  showProgress?: boolean;
  brand: BrandStyleRef;
  captions?: { text: string; startMs: number; endMs: number }[]; // relative to the clip start
  language?: string;
  music?: MusicRef;
  musicOff?: boolean;
  voiceover?: { src: string };  // the clip's own audio (set by the server; mastered like a voice)
}
export interface Post {
  clipSource?: { jobId?: string; assetId?: string; path?: string; startMs: number; endMs: number; score?: number; why?: string };
}

// ---------- Etsy shop → posts (etsy agent; server/src/etsy.ts, etsy-client.ts) ----------
export interface EtsyReview {
  rating: number;               // 1–5
  text: string;
  createdAt?: string;
  listingId?: string;
}
export interface EtsyShopInfo {
  name: string;                 // Etsy shop name, e.g. "MyBeadShop"
  shopId?: number;
  title?: string;               // shop headline
  url: string;
  currency?: string;
  reviewAverage?: number;
  reviewCount?: number;
  listingCount?: number;        // active listings on Etsy
}
export interface EtsyListing {
  id: ID;
  brandId: ID;
  listingId: string;            // Etsy listing id
  title: string;
  description: string;
  price?: number;               // major units (24.5)
  currency?: string;            // "USD"
  url: string;                  // clean listing URL (no tracking params)
  tags: string[];
  materials: string[];
  imageUrls: string[];          // source photos on Etsy's CDN (largest size)
  imageAssetIds: ID[];          // downloaded copies in the brand's assets (used as scene media)
  imageSources?: Record<string, ID>; // source URL → asset id (re-import reuses downloads)
  favorers?: number;            // API only
  views?: number;               // API only
  listedAt?: string;            // listing creation (API) / RSS pubDate
  reviews: EtsyReview[];        // best reviews of this listing (API only)
  source: "api" | "rss" | "manual";
  postIds: ID[];                // posts made from this listing
  importedAt: string;
  updatedAt: string;
  // GET /api/brands/:id/etsy/listings only:
  imageAssetUrls?: string[];
  posts?: { id: ID; type: PostType; status: PostStatus; title: string; thumbnailUrl?: string; renderProgress?: number }[];
}
export interface EtsyImportSummary {
  at: string;
  source: "api" | "rss";
  imported: number;             // new listings
  updated: number;              // re-imported (updated in place)
  images: number;               // photos downloaded
  reviews: number;              // shop reviews read
  warnings: string[];
}
export interface EtsyImportJob {
  running: boolean;
  step: string;
  progress: number;             // 0..1
  startedAt: string;
  error?: string;
  summary?: EtsyImportSummary;
}
/** Shop facts derived from the last import (stored on the brand; the brain gets products/keywords/CTAs merged in). */
export interface EtsyBrandFacts {
  shop: EtsyShopInfo;
  priceMin?: number;
  priceMax?: number;
  currency?: string;
  topReviews: string[];
  tagKeywords: string[];
  listingCount: number;
  updatedAt: string;
  lastImport?: EtsyImportSummary;
}
export interface EtsyStatus {
  shop?: string;                // brand.etsyShop (or parsed from brand.website)
  keySet: boolean;              // Etsy API key configured
  mode: "api" | "rss" | "manual"; // what an import will use
  info?: EtsyShopInfo;
  lastImport?: EtsyImportSummary;
  job?: EtsyImportJob;
  listingCount: number;
  facts?: EtsyBrandFacts;
}
export interface Brand {
  etsyShop?: string;            // Etsy shop name (set via PATCH /api/brands/:id {etsyShop} or PUT /api/brands/:id/etsy)
  etsy?: EtsyBrandFacts;
}
export interface Asset {
  source?: string;              // "etsy" for imported listing photos
  etsyListingId?: string;
}
export interface Post {
  etsyListingId?: string;       // made from this Etsy listing
  etsyLink?: string;            // listing URL + utm_source=instagram&utm_medium=social&utm_campaign=<post id>
}
export interface Settings {
  etsyApiKeySet: boolean;       // Etsy Open API key ("keystring:shared_secret") stored
}

// ---------- Pinterest (server/src/pinterest.ts) ----------
// The app generates pins into a queue; a separate publisher agent (e.g. Claude with Claude in Chrome) claims a due
// pin, uploads it on pinterest.com and reports the pin URL back. No Pinterest API access is needed.
export type PinStatus =
  | "rendering"   // image pin being rendered
  | "ready"       // waiting for your yes (approval "manual")
  | "queued"      // approved: a publisher agent may claim it once scheduledAt is due
  | "claimed"     // a publisher agent is uploading it (lease until claimExpiresAt)
  | "published"   // live on Pinterest (pinUrl)
  | "failed"      // render or publish failed (error)
  | "skipped";    // you skipped it
export type PinLayout = "photo" | "collage" | "text" | "persian" | "video" | "post-image";

/** 1000x1500 (2:3) Pinterest graphic, rendered by renderer renderPinImage (Remotion "PinImage" composition). */
export interface PinImageSpec {
  kind: "pin";
  width: number;                // 1000
  height: number;               // 1500
  layout: "photo" | "collage" | "text" | "persian";
  variant?: string;             // layout "persian": mihrab | toranj | tazhib | kashi | shab
  brand: BrandStyleRef;
  title: string;                // big overlay text (short, keyword-rich)
  subtitle?: string;            // one supporting line
  badge?: string;               // "INSTANT DOWNLOAD", "NEW", "20% OFF"
  price?: string;
  bullets?: string[];           // "text" layout: up to 3 short points
  footer?: string;              // website / shop name shown at the bottom
  photos: MediaRef[];           // 0-3 images
}

export interface PinterestPin {
  id: ID;
  brandId: ID;
  kind: "image" | "video";
  layout: PinLayout;
  status: PinStatus;
  title: string;                // Pinterest title, max 100 chars
  description: string;          // max 500 chars, keyword-rich, no hashtags needed
  link?: string;                // destination URL (Etsy listing / website) with utm_source=pinterest
  board: string;                // board name to pin to (created by the agent if it doesn't exist)
  altText: string;              // max 500 chars
  keywords: string[];
  sourcePostId?: ID;            // made from this post (video pins reuse the reel MP4)
  etsyListingId?: string;       // made from this Etsy listing
  spec?: PinImageSpec;          // image pins rendered by the app
  mediaPath?: string;           // absolute local file to upload (JPEG or MP4)
  mediaUrl?: string;            // same file over http (/files/...)
  thumbnailUrl?: string;
  coverPath?: string;           // video pins: cover image (optional)
  scheduledAt?: string;         // ISO: not claimable before this time
  claimedAt?: string;
  claimedBy?: string;
  claimExpiresAt?: string;
  attempts: number;
  pinUrl?: string;              // https://www.pinterest.com/pin/<id>/
  publishedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PinterestBoard {
  name: string;                 // exact board name on Pinterest
  keywords: string[];           // pins whose title/keywords match go to this board
}

export interface PinterestSettings {
  enabled: boolean;             // background worker generates pins for this brand
  approval: "auto" | "manual";  // auto (default) = generated pins go straight to the publish queue
  pinsPerDay: number;           // publish slots per day (default 5)
  leadDays: number;             // keep this many days of pins queued (default 3)
  fromPosts: boolean;           // approved / posted reels + image posts become pins (default true)
  fromEtsy: boolean;            // Etsy listings become fresh 2:3 image pins, rotating designs (default true)
  boards: PinterestBoard[];
  defaultBoard?: string;        // used when no board matches (default: brand niche / "<Brand> ideas")
  account?: string;             // Pinterest account / profile name, for the publisher agent
  chromeProfile?: string;       // which Chrome profile is signed in to that account, for the publisher agent
  activeHours?: [number, number]; // local hours for publish slots (default [8, 22])
  design?: "classic" | "persian"; // image pin look: classic photo/collage/text, or Persian art cards (mihrab, toranj, tazhib, kashi, shab)
  lastRunAt?: string;
  lastResult?: string;
}

export interface Brand {
  pinterest?: PinterestSettings; // undefined = off
}

/** GET /api/brands/:id/pinterest */
export interface PinterestStatus {
  settings: PinterestSettings;
  counts: Record<PinStatus, number>;
  due: number;                  // queued pins whose time has come
  nextDueAt?: string;
  publishedToday: number;
}

/** POST /api/pinterest/claim → the pin plus everything the publisher agent needs. */
export interface PinClaim {
  pin: PinterestPin;
  brandName: string;
  account?: string;
  chromeProfile?: string;
  instructions: string;
}

// ---------- Google Play app → brand (server/src/playstore.ts) ----------
export interface PlayStoreApp {
  packageId: string;            // com.example.app
  url: string;                  // listing URL (no tracking)
  title: string;
  summary: string;              // short description
  description: string;          // full description (plain text)
  features: { title: string; text: string }[]; // parsed from the FEATURES section when present
  category?: string;
  developer?: string;
  developerUrl?: string;
  contentRating?: string;
  free?: boolean;
  rating?: number;
  ratingCount?: number;
  updatedOn?: string;           // "Nov 11, 2026"
  whatsNew?: string;
  iconUrl?: string;             // Play CDN
  screenshotUrls: string[];     // Play CDN originals
  iconAssetId?: ID;             // downloaded copies in the brand's assets (source "playstore")
  screenshotAssetIds: ID[];
  imageSources?: Record<string, ID>;
  importedAt: string;
}
export interface Brand {
  playStore?: PlayStoreApp;
}

// ---------- Marketing research: competitors, ad libraries, strategy (server/src/research/*) ----------
export type AdPlatform = "meta" | "google" | "tiktok";
export type ResearchStep = "intake" | "keywords" | "discover" | "profile" | "social" | "ads" | "analyze" | "strategy" | "done";

export interface ResearchOptions {
  website: string;              // the brand's own site / Etsy shop / Play Store listing
  country?: string;             // ISO-2 for search + ad libraries (default "US")
  competitorCount?: number;     // default 6 (max 12)
  platforms?: AdPlatform[];     // ad libraries to read (default all)
  social?: boolean;             // read competitors' Instagram profiles (default true)
  include?: string[];           // competitor sites / @handles to always include
  exclude?: string[];           // domains to skip
  maxAdsPerCompetitor?: number; // default 60
}

export interface ResearchJob {
  id: ID;
  brandId: ID;
  status: "queued" | "running" | "done" | "failed";
  step: ResearchStep;
  progress: number;             // 0..1
  log: { at: string; text: string }[];
  options: ResearchOptions;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  reportId?: ID;
  costUsd?: number;             // Apify usage reported by the actor runs
}

export interface AdCreative {
  id: string;
  platform: AdPlatform;
  advertiser: string;
  headline?: string;
  body?: string;
  cta?: string;
  link?: string;
  landingDomain?: string;
  format: "image" | "video" | "carousel" | "text" | "unknown";
  imageUrl?: string;
  videoUrl?: string;
  previewUrl?: string;
  startDate?: string;           // ISO date
  endDate?: string;
  active?: boolean;
  daysRunning?: number;
  surfaces?: string[];          // facebook, instagram, search, youtube, ...
  reach?: number;               // EU reach / impressions lower bound when known
  spend?: string;
  countries?: string[];
}

export interface CompetitorAds {
  platform: AdPlatform;
  total: number;
  active: number;
  byFormat: Record<string, number>;
  bySurface: Record<string, number>;
  newLast30d: number;
  longestRunning: AdCreative[]; // the "winners": longest active
  samples: AdCreative[];
  hooks: string[];              // first lines of ad copy
  offers: string[];
  ctas: string[];
  error?: string;
}

export interface CompetitorSocial {
  platform: "instagram";
  username: string;
  url: string;
  followers?: number;
  follows?: number;
  posts?: number;
  verified?: boolean;
  bio?: string;
  website?: string;
  postsPerWeek?: number;
  engagementRate?: number;      // % of followers, avg over recent posts
  avgLikes?: number;
  avgComments?: number;
  formats?: Record<string, number>;
  topHashtags?: string[];
  recent?: { url: string; type: string; likes: number; comments: number; caption: string; timestamp?: string }[];
  bestPost?: { url: string; likes: number; comments: number; caption: string };
  error?: string;
}

export interface CompetitorProfile {
  title?: string;
  description?: string;
  tagline?: string;
  products: string[];
  prices: string[];
  offers: string[];
  ctas: string[];
  keywords: string[];
  colors: string[];
  socials: Partial<Record<"instagram" | "facebook" | "tiktok" | "youtube" | "pinterest" | "x", string>>;
  pages: number;
  blocked?: boolean;
  error?: string;
}

export interface Competitor {
  id: ID;
  name: string;
  website: string;
  domain: string;
  kind: "brand" | "etsy-shop" | "app" | "marketplace";
  source: "serp" | "llm" | "manual" | "playstore" | "etsy";
  why?: string;
  relevance: number;            // 0..1
  serpHits?: number;            // how many of the brand's search queries it ranks for
  profile?: CompetitorProfile;
  social?: CompetitorSocial;
  ads?: Partial<Record<AdPlatform, CompetitorAds>>;
  adsTotal: number;
  adsActive: number;
}

export interface Strategy {
  summary: string;
  positioning: { statement: string; differentiators: string[]; gaps: string[] };
  audience: { segments: { name: string; pain: string; trigger: string }[] };
  messaging: { hooks: string[]; offers: string[]; ctas: string[]; claimsToAvoid: string[] };
  content: { pillars: { name: string; why: string; formats: string[] }[]; cadence: string; plan30: { day: number; type: PostType; pillar: string; hook: string; notes?: string }[] };
  ads: { recommended: boolean; why: string; channels: { platform: string; why: string; budgetShare: number }[]; concepts: { name: string; angle: string; hook: string; format: string; cta: string; landing: string }[]; testPlan: string[] };
  seo: { keywords: string[]; notes: string[] };
  quickWins: string[];
  kpis: { name: string; target: string }[];
  risks: string[];
}

export interface ResearchReport {
  id: ID;
  brandId: ID;
  jobId: ID;
  website: string;
  createdAt: string;
  options: ResearchOptions;
  brandSnapshot: { name: string; summary: string; products: string[]; audience: string; keywords: string[]; socials: Record<string, string>; social?: CompetitorSocial; ads?: Partial<Record<AdPlatform, CompetitorAds>>; adsTotal: number };
  keywords: { query: string; intent: string }[];
  competitors: Competitor[];
  landscape: {
    serp: { query: string; topDomains: string[] }[];
    adSummary: { platform: AdPlatform; competitorsAdvertising: number; totalAds: number; activeAds: number; topFormats: string[] }[];
    commonHooks: string[];
    commonOffers: string[];
    commonCtas: string[];
    postingCadence: string;
  };
  strategy: Strategy;
  costUsd?: number;
  llm: "api" | "subscription" | "none";
}

export interface Brand {
  research?: { lastReportId?: ID; lastRunAt?: string; watch?: boolean; competitorsAdded?: string[] };
}
export interface Settings {
  apifyTokenSet?: boolean;      // Apify API token stored (ad libraries, Instagram profiles, Google search)
}
