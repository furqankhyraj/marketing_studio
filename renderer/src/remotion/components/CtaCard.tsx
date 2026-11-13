import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { BrandStyleRef, ReelSpec } from "../../../../shared/types.ts";
import type { Palette } from "../lib/color.ts";
import type { CtaTheme } from "../styles/types.ts";
import { BrandMark } from "./Brand.tsx";
import { fitText } from "../lib/text.ts";

/** End card: "Comment KEYWORD" with brand mark, handle and CTA line. */
export const CtaCard: React.FC<{ cta: ReelSpec["cta"]; brand: BrandStyleRef; pal: Palette; theme: CtaTheme }> = ({ cta, brand, pal, theme }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const s1 = spring({ frame, fps, config: { damping: 14 } });
  const s2 = spring({ frame: frame - 8, fps, config: { damping: 10, mass: 0.7 } });
  const s3 = spring({ frame: frame - 16, fps, config: { damping: 200 } });
  const beat = 1 + Math.max(0, Math.sin((frame / fps) * Math.PI * 2 * 1.2)) * 0.035;
  const keyword = cta?.keyword?.trim().toUpperCase();
  const line = cta?.text?.trim() || (keyword ? "" : `Follow ${brand.handle || brand.name}`);
  const kwSize = keyword ? fitText(keyword, { maxW: width - 260, maxH: 220, max: 180, min: 60, charW: 0.62, uppercase: true }) : 0;
  const lineSize = fitText(line, { maxW: width - 200, maxH: keyword ? 260 : 520, max: keyword ? 64 : 110, min: 36, charW: 0.55 });
  const { Decor } = theme;

  return (
    <AbsoluteFill style={{ background: theme.background, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {Decor ? <Decor pal={pal} /> : null}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 46, padding: "0 90px", textAlign: "center", zIndex: 2 }}>
        <div style={{ transform: `scale(${s1})` }}>
          <BrandMark brand={brand} pal={pal} size={190} />
        </div>
        {keyword ? (
          <>
            <div style={{ fontFamily: theme.bodyFont, fontWeight: 700, fontSize: 54, color: theme.fg, opacity: s1, letterSpacing: 6, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 18 }}>
              <svg width="58" height="58" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 20.5l1.4-4.6A8.4 8.4 0 0 1 3 11.5 8.6 8.6 0 0 1 12 3a8.6 8.6 0 0 1 9 8.5z"
                  stroke={theme.fg}
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
              Comment
            </div>
            <div
              style={{
                background: theme.keywordBg,
                color: theme.keywordFg,
                fontFamily: theme.headingFont,
                fontWeight: 900,
                fontSize: kwSize,
                lineHeight: 1,
                padding: `${kwSize * 0.22}px ${kwSize * 0.38}px`,
                borderRadius: theme.radius,
                transform: `scale(${interpolate(s2, [0, 1], [0.4, 1]) * beat}) rotate(${interpolate(s2, [0, 1], [-8, -2])}deg)`,
                boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
                letterSpacing: 2,
              }}
            >
              {keyword}
            </div>
          </>
        ) : null}
        {line ? (
          <div
            style={{
              fontFamily: keyword ? theme.bodyFont : theme.headingFont,
              fontWeight: keyword ? 600 : 800,
              fontSize: lineSize,
              color: theme.fg,
              lineHeight: 1.2,
              opacity: s3,
              transform: `translateY(${(1 - s3) * 30}px)`,
              textTransform: !keyword && theme.uppercase ? "uppercase" : "none",
              maxWidth: width - 180,
            }}
          >
            {line}
          </div>
        ) : null}
        {brand.handle ? (
          <div style={{ fontFamily: theme.bodyFont, fontWeight: 600, fontSize: 40, color: theme.fg, opacity: s3 * 0.8 }}>{brand.handle}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
