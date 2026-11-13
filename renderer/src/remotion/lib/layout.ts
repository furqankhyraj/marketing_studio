import { useVideoConfig } from "remotion";

/** Layout zones that respect Instagram's UI overlays (top bar, caption/actions at the bottom). */
export function useLayout() {
  const { width: W, height: H, fps } = useVideoConfig();
  const isReel = H / W > 1.5;
  const safeTop = isReel ? 300 : 90;
  // keep primary text above the caption band (~66% of the height) for reels
  const safeBottom = isReel ? 610 : 120;
  const side = isReel ? 80 : 80;
  return { W, H, fps, isReel, safeTop, safeBottom, side, innerW: W - side * 2, innerH: H - safeTop - safeBottom };
}
