// Unit tests for long video → short clips: transcript import, chunk merging, sentence building, heuristic
// moment picking, range snapping and clip change-request parsing. No whisper / ffmpeg / renderer needed.
// Run: cd server && npm test   (uses a throwaway DATA_DIR in the OS temp folder)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "clips-test-"));
process.env.SERVER_URL = "http://localhost:4398";

const T = await import("../src/clips-transcribe.ts");
const P = await import("../src/clips-pick.ts");
const { parseClipChange, captionsFor } = await import("../src/clips.ts");
import type { ClipTranscript, TranscriptSegment } from "../../shared/types.ts";

const seg = (s: number, e: number, text: string): TranscriptSegment => ({ startMs: s * 1000, endMs: e * 1000, text, words: T.estimateWords(text, s * 1000, e * 1000) });

test("parseTranscript reads SRT, VTT and JSON", () => {
  const srt = "1\n00:00:01,000 --> 00:00:04,500\nHello there.\n\n2\n00:00:05,000 --> 00:00:08,000\nHow to price <i>jewelry</i>?\n";
  const a = T.parseTranscript(srt);
  assert.equal(a.length, 2);
  assert.equal(a[0].startMs, 1000);
  assert.equal(a[1].text, "How to price jewelry?");
  assert.ok(a[1].words!.length === 4 && a[1].words![0].startMs === 5000);
  const vtt = "WEBVTT\n\n00:01.000 --> 00:02.500 align:start\nکیا آپ جانتے ہیں؟\n";
  const b = T.parseTranscript(vtt);
  assert.equal(b[0].endMs, 2500);
  const c = T.parseTranscript(JSON.stringify([{ start: 1.5, end: 3, text: "One" }, { startMs: 3000, endMs: 4000, text: "Two" }]));
  assert.deepEqual([c[0].startMs, c[1].endMs], [1500, 4000]);
  assert.throws(() => T.parseTranscript("just some text"));
});

test("planChunks + mergeChunks keep one copy of segments in the overlap", () => {
  const plan = T.planChunks(650, 300);
  assert.deepEqual(plan.map((c) => [c.start, c.end]), [[0, 300], [300, 600], [600, 650]]);
  const c0 = { index: 0, startMs: 0, endMs: 300_000, segments: [seg(290, 296, "End of chunk one."), seg(297, 303, "Across the seam.")], procMs: 1, audioMs: 300_000 };
  const c1 = { index: 1, startMs: 300_000, endMs: 600_000, segments: [seg(298, 302.5, "Across the seam."), seg(303, 310, "Start of chunk two.")], procMs: 1, audioMs: 300_000 };
  const merged = T.mergeChunks([c1, c0]);
  assert.deepEqual(merged.map((s) => s.text), ["End of chunk one.", "Across the seam.", "Start of chunk two."]);
});

const LESSON: ClipTranscript = {
  version: 1,
  language: "en",
  source: "import",
  durationMs: 200_000,
  createdAt: "",
  segments: [
    seg(0, 6, "Welcome back to the course, today we talk about pricing."),
    seg(6, 12, "And honestly this is the lesson most students wish they had watched first."),
    seg(13, 18, "Let me start with a quick story about my shop."),
    seg(18, 26, "I priced a silver ring at twelve dollars and sold forty of them."),
    seg(26, 31, "I lost money on every single one."),
    seg(40, 46, "So here is the biggest mistake beginners make."),
    seg(46, 53, "They copy the lowest price they can find on Etsy."),
    seg(53, 60, "That is a race to the bottom, and nobody wins it."),
    seg(60, 66, "Why does this matter so much?"),
    seg(66, 74, "Because your price tells the buyer what your work is worth."),
    seg(80, 86, "Now let me show you the simple pricing formula."),
    seg(86, 94, "Materials plus labor, times two, gives you wholesale."),
    seg(94, 102, "Multiply wholesale by two again to get your retail price."),
    seg(102, 108, "Write this down, it changes everything."),
  ],
};

test("sentences split at punctuation and pauses", () => {
  const s = P.sentences(LESSON);
  assert.ok(s.length >= 14);
  assert.ok(s.every((x) => x.endMs > x.startMs));
  assert.match(s[0].text, /^Welcome/);
});

test("pickHeuristic returns non-overlapping, hooky, in-range clips", () => {
  const picks = P.pickHeuristic(LESSON, { maxClips: 3, minSec: 15, maxSec: 35, keywords: ["pricing", "etsy", "jewelry"] });
  assert.ok(picks.length >= 2);
  for (const m of picks) {
    const d = (m.endMs - m.startMs) / 1000;
    assert.ok(d >= 15 && d <= 35, `duration ${d}`);
    assert.ok(m.score > 0 && m.score < 100);
    assert.ok(m.title.length > 3);
  }
  for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) assert.ok(!P.overlaps(picks[i], picks[j], 0));
  // the "biggest mistake" / "why" stretch should be among the picks
  assert.ok(picks.some((m) => m.startMs <= 60_000 && m.endMs >= 46_000), JSON.stringify(picks.map((p) => [p.startMs, p.endMs, p.title])));
  // exclude → "make more" never repeats a range
  const more = P.pickHeuristic(LESSON, { maxClips: 2, minSec: 15, maxSec: 35, exclude: picks });
  for (const m of more) assert.ok(!picks.some((p) => P.overlaps(p, m)));
});

test("Urdu hook phrases score", () => {
  assert.ok(P.hookStrength("سب سے بڑی غلطی کیا ہے؟") > P.hookStrength("یہ ایک عام جملہ ہے۔"));
});

test("snapRange snaps to sentence boundaries within limits", () => {
  const s = P.sentences(LESSON);
  const r = P.snapRange(s, 41_000, 59_000, 15, 40)!;
  assert.ok(Math.abs(r.startMs - 40_000) <= 300, String(r.startMs));
  assert.ok(r.endMs >= 59_000 && r.endMs <= 61_000, String(r.endMs));
});

test("captionsFor returns clip-relative word timings", () => {
  const caps = captionsFor(LESSON, 40_000, 60_000)!;
  assert.ok(caps.length > 10);
  assert.ok(caps[0].startMs >= 0 && caps[0].startMs < 500);
  assert.ok(caps.every((c) => c.endMs <= 20_000));
});

test("parseClipChange understands trim / extend / hook requests", () => {
  assert.deepEqual(parseClipChange("extend the end by 5s"), { endDeltaMs: 5000 });
  assert.deepEqual(parseClipChange("start 3 seconds earlier"), { startDeltaMs: -3000 });
  assert.deepEqual(parseClipChange("trim the start by 2 sec"), { startDeltaMs: 2000 });
  assert.deepEqual(parseClipChange("cut the end by 4 seconds"), { endDeltaMs: -4000 });
  assert.equal(parseClipChange('hook: "Stop underpricing your rings"')?.hookTitle, "Stop underpricing your rings");
  assert.equal(parseClipChange("no captions please")?.captionStyle, null);
  assert.equal(parseClipChange("make it center crop")?.layout, "center-crop");
  assert.equal(parseClipChange("make it funnier"), undefined);
});
