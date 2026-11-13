import { useEffect, useState } from "react";
import { Music, Volume1, Volume2 } from "lucide-react";
import { api, type MusicTrackX } from "../lib/api";
import { mediaUrl } from "../lib/format";
import type { Post } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useToast } from "../state/toast";
import { Button, Card, Select } from "./ui";

type SpecMusic = { music?: { src: string; volume?: number; trackId?: string; auto?: boolean; credit?: string }; musicOff?: boolean };

/** Background music for a reel/story: pick a track (or none / auto), set its level, apply (re-mix ~10s). */
export function MusicPicker({ post, onChanged }: { post: Post; onChanged: (p: Post) => void }) {
  const { toast, fail } = useToast();
  const tracks = useApi(() => api.music(post.brandId), [post.brandId]);
  const spec = post.spec as unknown as SpecMusic;
  const curTrack = spec.musicOff ? "none" : spec.music?.trackId ?? (spec.music ? "custom" : "");
  const curVol = Math.round((spec.music?.volume ?? 0.3) * 100);
  const [track, setTrack] = useState(curTrack);
  const [vol, setVol] = useState(curVol);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTrack(curTrack);
    setVol(curVol);
  }, [post.id, curTrack, curVol]);

  if (post.type === "carousel" || post.type === "image") return null;
  const list: MusicTrackX[] = tracks.data ?? [];
  const selected = list.find((t) => t.id === track);
  const dirty = track !== curTrack || vol !== curVol;
  const busyPost = post.status === "rendering" || post.status === "changes_requested" || post.status === "publishing";

  const apply = async () => {
    setBusy(true);
    try {
      const body: { trackId?: string | null; volume?: number; render: boolean } = { render: true };
      if (track !== curTrack) body.trackId = track === "none" ? null : track || "auto";
      if (vol !== curVol && track !== "none") body.volume = vol / 100;
      const p = await api.setPostMusic(post.id, body);
      onChanged(p);
      toast("success", track === "none" ? "Music removed" : "Music updated", p.status === "rendering" ? "Re-rendering…" : "Audio re-mixed.");
    } catch (e) {
      fail(e, "Couldn't change the music");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
        <Music className="size-3.5" />
        Music
        {spec.music?.auto && <span className="font-normal text-zinc-400">· auto-picked</span>}
      </div>
      {tracks.error ? (
        <p className="text-xs text-zinc-500">Music library isn't available.</p>
      ) : (
        <Select value={track} onChange={(e) => setTrack(e.target.value)} aria-label="Music track" className="h-9 text-sm">
          {curTrack === "" && <option value="">Auto-pick a track</option>}
          {curTrack === "custom" && <option value="custom">Custom track</option>}
          <option value="none">No music</option>
          {list.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.mood ? ` · ${t.mood}` : ""}
              {t.source === "asset" ? " (your upload)" : ""}
            </option>
          ))}
        </Select>
      )}
      {track !== "none" && (
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          <Volume1 className="size-3.5 shrink-0" />
          <input type="range" min={5} max={100} step={5} value={vol} onChange={(e) => setVol(Number(e.target.value))} className="flex-1 accent-violet-600" aria-label="Music volume" />
          <Volume2 className="size-3.5 shrink-0" />
          <span className="w-8 text-right tabular-nums">{vol}%</span>
        </label>
      )}
      {selected && track !== curTrack && <audio src={mediaUrl(selected.url)} controls className="h-8 w-full" preload="none" />}
      {spec.music?.credit && <p className="text-[11px] text-zinc-400">Credit: {spec.music.credit}</p>}
      {dirty && (
        <Button size="sm" variant="primary" className="w-full" loading={busy} disabled={busyPost} onClick={apply} title={busyPost ? "Wait for the current render to finish" : undefined}>
          Apply music
        </Button>
      )}
    </Card>
  );
}
