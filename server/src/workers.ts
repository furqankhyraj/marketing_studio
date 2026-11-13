// Background workers: scheduler (60s) and comment-keyword poller (120s).
import { nanoid } from "nanoid";
import type { Automation } from "../../shared/types.ts";
import { nowIso } from "./config.ts";
import { listPosts, getSettings, getBrand, listBrands, listAutomations, hasComment, saveComment, getIgCreds, updatePost } from "./db.ts";
import { publishPost, refreshTokens, listRecentMedia, listMediaComments, replyToComment, privateReply, igUsername } from "./instagram.ts";

let schedulerBusy = false;
export async function schedulerTick() {
  if (schedulerBusy) return;
  schedulerBusy = true;
  try {
    if (!getSettings().autoPublish) return;
    const now = Date.now();
    const due = listPosts({ status: "approved" }).filter((p) => p.scheduledAt && Date.parse(p.scheduledAt) <= now && p.mediaUrls.length);
    for (const p of due) {
      const b = getBrand(p.brandId);
      if (!b?.igConnected || !getIgCreds(p.brandId)) {
        const msg = "Waiting: Instagram is not connected for this brand";
        if (p.error !== msg) updatePost(p.id, (x) => void (x.error = msg));
        continue;
      }
      try {
        console.log(`[scheduler] publishing post ${p.id} (${p.type})`);
        await publishPost(p.id);
      } catch (e: any) {
        console.warn(`[scheduler] publish failed for ${p.id}: ${e?.message}`);
      }
    }
  } finally {
    schedulerBusy = false;
  }
}

function matches(a: Automation, text: string): boolean {
  const kw = a.keyword.trim();
  if (!kw) return false;
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

let pollerBusy = false;
export async function commentPollTick() {
  if (pollerBusy) return;
  pollerBusy = true;
  try {
    for (const brand of listBrands()) {
      if (!brand.igConnected || !getIgCreds(brand.id)) continue;
      const autos = listAutomations(brand.id).filter((a) => a.enabled);
      if (!autos.length) continue;
      try {
        await pollBrand(brand.id, autos);
      } catch (e: any) {
        console.warn(`[comments] brand ${brand.id}: ${e?.message}`);
      }
    }
  } finally {
    pollerBusy = false;
  }
}

async function pollBrand(brandId: string, autos: Automation[]) {
  const posts = listPosts({ brandId });
  const mediaToPost = new Map(posts.filter((p) => p.igMediaId).map((p) => [p.igMediaId!, p.id]));
  const own = igUsername(brandId)?.toLowerCase();
  const media = await listRecentMedia(brandId, 10);
  // also include media of post-specific automations even if older
  const ids = new Set(media.map((m) => m.id));
  for (const a of autos) {
    const mid = a.postId ? posts.find((p) => p.id === a.postId)?.igMediaId : undefined;
    if (mid) ids.add(mid);
  }
  for (const mediaId of ids) {
    let comments: Awaited<ReturnType<typeof listMediaComments>> = [];
    try {
      comments = await listMediaComments(brandId, mediaId);
    } catch (e: any) {
      console.warn(`[comments] media ${mediaId}: ${e?.message}`);
      continue;
    }
    for (const c of comments) {
      if (hasComment(c.id)) continue;
      const username = c.username ?? c.from?.username ?? "";
      if (own && username.toLowerCase() === own) continue;
      const ts = Date.parse(c.timestamp);
      const postId = mediaToPost.get(mediaId);
      const auto = autos.find((a) => (!a.postId || a.postId === postId) && ts >= Date.parse(a.createdAt) && matches(a, c.text ?? ""));
      const log = {
        id: nanoid(12),
        brandId,
        igCommentId: c.id,
        igMediaId: mediaId,
        username,
        text: c.text ?? "",
        matchedKeyword: auto?.keyword,
        replied: false,
        dmSent: false,
        error: undefined as string | undefined,
        createdAt: nowIso(),
      };
      if (auto) {
        const errs: string[] = [];
        try {
          if (auto.replyText.trim()) {
            await replyToComment(brandId, c.id, auto.replyText.replace(/\{username\}/g, username));
            log.replied = true;
          }
        } catch (e: any) {
          errs.push(`reply: ${e?.message}`);
        }
        try {
          const dm = [auto.dmText.replace(/\{username\}/g, username), auto.link].filter(Boolean).join("\n\n");
          if (dm.trim()) {
            await privateReply(brandId, c.id, dm);
            log.dmSent = true;
          }
        } catch (e: any) {
          errs.push(`dm: ${e?.message}`);
        }
        if (errs.length) log.error = errs.join("; ");
      }
      saveComment(log);
    }
  }
}

export function startWorkers() {
  const safe = (fn: () => Promise<void>, name: string) => () => fn().catch((e) => console.warn(`[${name}]`, e?.message ?? e));
  setTimeout(safe(schedulerTick, "scheduler"), 5_000);
  setInterval(safe(schedulerTick, "scheduler"), 60_000);
  setTimeout(safe(commentPollTick, "comments"), 15_000);
  setInterval(safe(commentPollTick, "comments"), 120_000);
  setTimeout(safe(refreshTokens, "ig-refresh"), 30_000);
  setInterval(safe(refreshTokens, "ig-refresh"), 12 * 3600_000);
  void import("./autopilot.ts").then((m) => m.startAutopilot()); // weekly content autopilot
  void import("./pinterest.ts").then((m) => m.startPinterestWorker()); // Pinterest pin queue
  void import("./research/index.ts").then((m) => m.startResearchWorker()); // weekly competitor/ad refresh for watched brands
}
