// Offline procedural music generator (pure TypeScript, no dependencies).
// Renders gentle, loopable background beds (44.1 kHz stereo 16-bit WAV) for a handful of moods.
// The output is generated on this machine, so it is free of any licence.
//
// Design: every track is a cyclic loop of N bars. Notes that run past the loop end wrap to the start, and the
// reverb / tone filters are run over two cycles (keeping the second), so the WAV loops without a seam.
import fs from "node:fs";

export const SR = 44100;

export type Keys = "rhodes" | "bell" | "pluck" | "piano" | "marimba" | "none";
export type Drums = "none" | "lofi" | "pop" | "soft" | "focus" | "playful" | "brush" | "cinematic";

export interface MoodDef {
  id: string;
  name: string;
  description: string;
  energy: number;               // 1–5
  bpm: number;
  root: number;                 // MIDI note of the key centre (e.g. 57 = A3)
  minor: boolean;
  prog: number[];               // chord roots as scale degrees (0-based)
  barsPerChord: number;
  sevenths: boolean;
  bars: number;                 // loop length in bars (multiple of prog.length * barsPerChord)
  pad: number;                  // pad level 0..1
  keys: Keys;
  keysLevel: number;
  keysPattern: "stabs" | "arp8" | "arp16" | "sparse" | "quarters" | "none";
  bass: "sustain" | "pulse8" | "bounce" | "roots";
  bassLevel: number;
  drums: Drums;
  drumsLevel: number;
  swing: number;                // 0..0.33 of a 16th
  brightness: number;           // master low-pass cutoff in Hz
  reverb: number;               // send level 0..1
  crackle?: boolean;
}

export const MOODS: MoodDef[] = [
  {
    id: "calm", name: "Calm Ambient", description: "Soft evolving pads and distant bells. Wellness, nature, slow product shots.",
    energy: 1, bpm: 68, root: 57, minor: false, prog: [0, 3, 5, 3], barsPerChord: 2, sevenths: true, bars: 24,
    pad: 0.9, keys: "bell", keysLevel: 0.28, keysPattern: "sparse", bass: "sustain", bassLevel: 0.45,
    drums: "none", drumsLevel: 0, swing: 0, brightness: 3200, reverb: 0.55,
  },
  {
    id: "lofi", name: "Lofi Chill", description: "Dusty Rhodes chords, laid-back swung beat and vinyl crackle. Handmade, cosy, behind-the-scenes.",
    energy: 2, bpm: 78, root: 50, minor: false, prog: [1, 4, 0, 5], barsPerChord: 1, sevenths: true, bars: 24,
    pad: 0.35, keys: "rhodes", keysLevel: 0.55, keysPattern: "stabs", bass: "roots", bassLevel: 0.6,
    drums: "lofi", drumsLevel: 0.7, swing: 0.22, brightness: 3800, reverb: 0.3, crackle: true,
  },
  {
    id: "upbeat", name: "Upbeat Pop", description: "Bright plucks, driving bass and a clean pop beat. Launches, sales, energetic reels.",
    energy: 5, bpm: 112, root: 55, minor: false, prog: [0, 4, 5, 3], barsPerChord: 1, sevenths: false, bars: 36,
    pad: 0.35, keys: "pluck", keysLevel: 0.42, keysPattern: "arp8", bass: "pulse8", bassLevel: 0.55,
    drums: "pop", drumsLevel: 0.75, swing: 0, brightness: 7000, reverb: 0.22,
  },
  {
    id: "inspiring", name: "Inspiring Corporate", description: "Piano arpeggios over warm pads with a steady clap. Tips, success stories, brand values.",
    energy: 4, bpm: 100, root: 52, minor: false, prog: [5, 3, 0, 4], barsPerChord: 1, sevenths: false, bars: 32,
    pad: 0.55, keys: "piano", keysLevel: 0.45, keysPattern: "arp8", bass: "pulse8", bassLevel: 0.45,
    drums: "soft", drumsLevel: 0.55, swing: 0, brightness: 6000, reverb: 0.35,
  },
  {
    id: "cinematic", name: "Cinematic", description: "Wide dark pads, deep booms and slow-moving minor harmony. Storytelling, reveals, transformations.",
    energy: 3, bpm: 72, root: 50, minor: true, prog: [0, 5, 2, 6], barsPerChord: 2, sevenths: false, bars: 24,
    pad: 1, keys: "piano", keysLevel: 0.28, keysPattern: "quarters", bass: "sustain", bassLevel: 0.6,
    drums: "cinematic", drumsLevel: 0.7, swing: 0, brightness: 4200, reverb: 0.6,
  },
  {
    id: "playful", name: "Playful", description: "Bouncy marimba, staccato bass and shakers. Kids, pets, fun how-tos.",
    energy: 4, bpm: 118, root: 60, minor: false, prog: [0, 3, 4, 3], barsPerChord: 1, sevenths: false, bars: 36,
    pad: 0.2, keys: "marimba", keysLevel: 0.5, keysPattern: "arp8", bass: "bounce", bassLevel: 0.55,
    drums: "playful", drumsLevel: 0.6, swing: 0.12, brightness: 6500, reverb: 0.2,
  },
  {
    id: "elegant", name: "Elegant Luxury", description: "Silky major-seventh chords, glassy bells and soft brushes. Jewellery, fashion, premium products.",
    energy: 2, bpm: 76, root: 53, minor: false, prog: [0, 2, 5, 3], barsPerChord: 1, sevenths: true, bars: 24,
    pad: 0.7, keys: "bell", keysLevel: 0.36, keysPattern: "arp8", bass: "sustain", bassLevel: 0.45,
    drums: "brush", drumsLevel: 0.45, swing: 0.1, brightness: 5200, reverb: 0.5,
  },
  {
    id: "focus", name: "Focus / Education", description: "Gentle 16th-note arpeggios and a light pulse that stays out of the way. Lessons, courses, explainers.",
    energy: 3, bpm: 90, root: 57, minor: true, prog: [0, 5, 2, 6], barsPerChord: 1, sevenths: true, bars: 28,
    pad: 0.5, keys: "pluck", keysLevel: 0.3, keysPattern: "arp16", bass: "roots", bassLevel: 0.45,
    drums: "focus", drumsLevel: 0.5, swing: 0, brightness: 4800, reverb: 0.35,
  },
];

export const getMood = (id: string) => MOODS.find((m) => m.id === id);
export const moodDurationSec = (m: MoodDef) => (m.bars * 4 * 60) / m.bpm;

// ---------------------------------------------------------------- helpers
const TABLE_SIZE = 4096;
const SINE = new Float32Array(TABLE_SIZE + 1);
for (let i = 0; i <= TABLE_SIZE; i++) SINE[i] = Math.sin((2 * Math.PI * i) / TABLE_SIZE);
/** sine of phase given in cycles */
function sin1(ph: number): number {
  const x = (ph - Math.floor(ph)) * TABLE_SIZE;
  const i = x | 0;
  const f = x - i;
  return SINE[i] + (SINE[i + 1] - SINE[i]) * f;
}
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

class Bus {
  L: Float32Array;
  R: Float32Array;
  constructor(public n: number) {
    this.L = new Float32Array(n);
    this.R = new Float32Array(n);
  }
  /** Add a voice. fn(t) returns a sample; t is seconds since note start. Writes wrap around the loop. */
  add(startSec: number, lenSec: number, pan: number, gain: number, fn: (t: number) => number) {
    const start = Math.round(startSec * SR);
    const len = Math.round(lenSec * SR);
    const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
    const n = this.n;
    for (let i = 0; i < len; i++) {
      const v = fn(i / SR);
      const k = (start + i) % n;
      this.L[k] += v * gl;
      this.R[k] += v * gr;
    }
  }
  mixInto(dst: Bus, g: number) {
    for (let i = 0; i < this.n; i++) {
      dst.L[i] += this.L[i] * g;
      dst.R[i] += this.R[i] * g;
    }
  }
}

/** ADSR-ish envelope: linear attack, exponential-ish release at the end of `len`. */
function env(t: number, len: number, a: number, r: number): number {
  if (t < a) return t / a;
  const rel = len - r;
  if (t > rel) return Math.max(0, 1 - (t - rel) / r);
  return 1;
}

// ---------------------------------------------------------------- instruments
function padVoice(f: number, len: number, detune: number, phase0: number) {
  const f1 = f * Math.pow(2, detune / 1200);
  return (t: number) => {
    const e = env(t, len, Math.min(0.4, len * 0.2), Math.min(1.0, len * 0.35));
    let s = 0;
    for (let h = 1; h <= 5; h++) s += sin1(f1 * h * t + phase0 * h) / Math.pow(h, 1.7);
    const lfo = 0.85 + 0.15 * sin1(0.21 * t + phase0);
    return s * e * lfo * 0.5;
  };
}
function keysVoice(kind: Keys, f: number, len: number) {
  switch (kind) {
    case "rhodes":
      return (t: number) => {
        const idx = 1.4 * Math.exp(-t * 2.5);
        const m = sin1(f * t) * idx;
        const a = Math.min(1, t / 0.004) * Math.exp(-t * 1.1) * env(t, len, 0.004, 0.12);
        return (sin1(f * t + m * 0.16) + 0.18 * sin1(f * 2 * t) * Math.exp(-t * 4)) * a;
      };
    case "bell":
      return (t: number) => {
        const idx = 2.2 * Math.exp(-t * 2.2);
        const m = sin1(f * 3.5 * t) * idx;
        const a = Math.min(1, t / 0.003) * Math.exp(-t * 1.4) * env(t, len, 0.003, 0.2);
        return (sin1(f * t + m * 0.16) * 0.8 + 0.2 * sin1(f * 2 * t) * Math.exp(-t * 3)) * a;
      };
    case "pluck":
      return (t: number) => {
        let s = 0;
        for (let h = 1; h <= 6; h++) s += (sin1(f * h * t) / h) * Math.exp(-t * (3 + h * 2.2));
        return s * Math.min(1, t / 0.002) * env(t, len, 0.002, 0.08);
      };
    case "piano":
      return (t: number) => {
        let s = 0;
        for (let h = 1; h <= 6; h++) s += (sin1(f * h * t * (1 + 0.0004 * h * h)) / Math.pow(h, 1.3)) * Math.exp(-t * (0.9 + h * 0.7));
        return s * Math.min(1, t / 0.003) * env(t, len, 0.003, 0.15) * 0.8;
      };
    case "marimba":
      return (t: number) => (sin1(f * t) + 0.25 * sin1(f * 3.93 * t) * Math.exp(-t * 18)) * Math.exp(-t * 7) * Math.min(1, t / 0.002);
    default:
      return () => 0;
  }
}
function bassVoice(f: number, len: number, pluck: boolean) {
  return (t: number) => {
    const e = pluck ? Math.min(1, t / 0.005) * Math.exp(-t * 3.5) * env(t, len, 0.005, 0.05) : env(t, len, 0.02, Math.min(0.3, len * 0.3));
    return (sin1(f * t) + 0.22 * sin1(2 * f * t) + 0.06 * sin1(3 * f * t)) * e;
  };
}

// noise source with a fixed seed so tracks are reproducible
function noiseGen(seed: number) {
  const r = prng(seed);
  return () => r() * 2 - 1;
}

function kick(gain: number) {
  return (t: number) => {
    const f = 45 + 85 * Math.exp(-t * 28);
    // integrate frequency for phase: ∫(45 + 85e^{-28t}) = 45t + 85/28 (1 - e^{-28t})
    const ph = 45 * t + (85 / 28) * (1 - Math.exp(-28 * t));
    void f;
    return (sin1(ph) * Math.exp(-t * 7) + 0.15 * Math.exp(-t * 200)) * gain;
  };
}
function snare(seed: number, tone = 185, decay = 16) {
  const nz = noiseGen(seed);
  let lp1 = 0, lp2 = 0;
  return (t: number) => {
    const n = nz();
    lp1 += 0.45 * (n - lp1);
    lp2 += 0.08 * (lp1 - lp2);
    const band = lp1 - lp2;
    return band * 1.6 * Math.exp(-t * decay) + 0.35 * sin1(tone * t) * Math.exp(-t * 22);
  };
}
function clap(seed: number) {
  const nz = noiseGen(seed);
  let lp1 = 0, lp2 = 0;
  return (t: number) => {
    const n = nz();
    lp1 += 0.5 * (n - lp1);
    lp2 += 0.1 * (lp1 - lp2);
    const band = lp1 - lp2;
    const bursts = t < 0.03 ? 0.6 + 0.4 * Math.sin(t * 2 * Math.PI * 100) : 1;
    return band * 1.8 * bursts * Math.exp(-t * 14);
  };
}
function hat(seed: number, decay: number) {
  const nz = noiseGen(seed);
  let lp = 0;
  return (t: number) => {
    const n = nz();
    lp += 0.25 * (n - lp);
    return (n - lp) * Math.exp(-t * decay) * 0.6;
  };
}
function shaker(seed: number) {
  const nz = noiseGen(seed);
  let lp = 0;
  return (t: number) => {
    const n = nz();
    lp += 0.35 * (n - lp);
    const e = t < 0.012 ? t / 0.012 : Math.exp(-(t - 0.012) * 45);
    return (n - lp) * e * 0.5;
  };
}
function boom() {
  return (t: number) => {
    const ph = 38 * t + (40 / 6) * (1 - Math.exp(-6 * t));
    return sin1(ph) * Math.exp(-t * 1.6) * Math.min(1, t / 0.01);
  };
}

// ---------------------------------------------------------------- effects
function reverbCycle(bus: Bus, mix: number, out: Bus) {
  const n = bus.n;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491];
  const aps = [556, 441, 341];
  for (const [ch, src, dst, spread] of [
    [0, bus.L, out.L, 0],
    [1, bus.R, out.R, 23],
  ] as const) {
    void ch;
    const cb = combs.map((d) => ({ buf: new Float32Array(d + spread), i: 0, lp: 0 }));
    const ab = aps.map((d) => ({ buf: new Float32Array(d + spread), i: 0 }));
    const fb = 0.8;
    const damp = 0.35;
    // two passes over the loop: the first fills the tails, the second (kept) is cyclic
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < n; k++) {
        const x = src[k] * 0.015;
        let y = 0;
        for (const c of cb) {
          const o = c.buf[c.i];
          c.lp = o * (1 - damp) + c.lp * damp;
          c.buf[c.i] = x + c.lp * fb;
          c.i = (c.i + 1) % c.buf.length;
          y += o;
        }
        for (const a of ab) {
          const o = a.buf[a.i];
          const v = y + o * 0.5;
          a.buf[a.i] = v;
          a.i = (a.i + 1) % a.buf.length;
          y = o - v * 0.5;
        }
        if (pass === 1) dst[k] += y * mix;
      }
    }
  }
}
function lowpassCycle(bus: Bus, cutoff: number) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
  for (const ch of [bus.L, bus.R]) {
    let y1 = 0, y2 = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < ch.length; k++) {
        y1 += a * (ch[k] - y1);
        y2 += a * (y1 - y2);
        if (pass === 1) ch[k] = y2;
      }
    }
  }
}
/** Remove DC / sub rumble below ~30 Hz (cyclic). */
function highpassCycle(bus: Bus, cutoff: number) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
  for (const ch of [bus.L, bus.R]) {
    let lp = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < ch.length; k++) {
        lp += a * (ch[k] - lp);
        if (pass === 1) ch[k] = ch[k] - lp;
      }
    }
  }
}

// ---------------------------------------------------------------- composition
function chordNotes(m: MoodDef, degree: number): number[] {
  const scale = m.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const tone = (d: number) => scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const steps = m.sevenths ? [0, 2, 4, 6] : [0, 2, 4];
  // voice the chord close to the key centre + 7 semitones (smooth voice leading)
  const centre = m.root + 7;
  return steps.map((s) => {
    let n = m.root + tone(degree + s);
    while (n < centre - 6) n += 12;
    while (n > centre + 6) n -= 12;
    return n;
  }).sort((a, b) => a - b);
}

export function renderMood(m: MoodDef): { L: Float32Array; R: Float32Array } {
  const beat = 60 / m.bpm;
  const bar = beat * 4;
  const six = beat / 4;
  const total = m.bars * bar;
  const n = Math.round(total * SR);
  const rnd = prng(hashStr(m.id));
  const dry = new Bus(n);       // drums, bass (little reverb)
  const wet = new Bus(n);       // pads, keys (reverb send)
  const chordLen = m.barsPerChord * bar;
  const chords = Math.round(m.bars / m.barsPerChord);

  for (let c = 0; c < chords; c++) {
    const deg = m.prog[c % m.prog.length];
    const notes = chordNotes(m, deg);
    const t0 = c * chordLen;
    const barIdx = c * m.barsPerChord;
    // pad (overlaps into the next chord for a legato feel)
    if (m.pad > 0) {
      notes.forEach((nt, i) => {
        const f = mtof(nt);
        const pan = (i / Math.max(1, notes.length - 1)) * 1.2 - 0.6;
        wet.add(t0, chordLen + 0.6, pan, 0.075 * m.pad, padVoice(f, chordLen + 0.6, -7, rnd()));
        wet.add(t0, chordLen + 0.6, -pan, 0.075 * m.pad, padVoice(f, chordLen + 0.6, +7, rnd()));
      });
    }
    // bass
    const scale = m.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    let bassNote = m.root - 12 + scale[deg % 7];
    if (bassNote > m.root - 5) bassNote -= 12; // keep the bass well below the chords
    const bf = mtof(bassNote);
    const bl = 0.32 * m.bassLevel;
    if (m.bass === "sustain") dry.add(t0, chordLen, 0, bl, bassVoice(bf, chordLen, false));
    else {
      for (let b = 0; b < m.barsPerChord; b++) {
        const tb = t0 + b * bar;
        if (m.bass === "roots") {
          dry.add(tb, beat * 2.5, 0, bl, bassVoice(bf, beat * 2.5, false));
          dry.add(tb + beat * 2.5, beat * 1.4, 0, bl * 0.8, bassVoice(rnd() < 0.5 ? bf : bf * 1.5, beat * 1.4, false));
        } else if (m.bass === "pulse8") {
          for (let k = 0; k < 8; k++) dry.add(tb + k * beat * 0.5, beat * 0.45, 0, bl * (k % 2 ? 0.75 : 1), bassVoice(bf, beat * 0.45, true));
        } else {
          const pat = [0, 3, 6, 8, 11, 14];
          pat.forEach((s, k) => dry.add(tb + s * six, six * 1.6, 0, bl, bassVoice(k === 3 ? bf * 1.5 : k === 5 ? bf * 2 : bf, six * 1.6, true)));
        }
      }
    }
    // keys
    const kl = 0.2 * m.keysLevel;
    const upper = notes.map((x) => x + 12);
    const arpNotes = [...notes, upper[0], upper[1]];
    for (let b = 0; b < m.barsPerChord; b++) {
      const tb = t0 + b * bar;
      const bi = barIdx + b;
      switch (m.keysPattern) {
        case "stabs": {
          const hits = bi % 2 === 0 ? [0, 6] : [0, 7, 10];
          hits.forEach((s, k) =>
            notes.forEach((nt, i) => {
              const sw = s % 2 ? m.swing * six : 0;
              const len = k === 0 ? beat * 1.4 : beat * 0.8;
              wet.add(tb + s * six + sw + i * 0.012, len, (i - 1.5) * 0.25, kl * (k === 0 ? 1 : 0.7), keysVoice(m.keys, mtof(nt), len));
            }),
          );
          break;
        }
        case "arp8":
        case "arp16": {
          const per = m.keysPattern === "arp8" ? 8 : 16;
          const stepLen = bar / per;
          const shape = [0, 1, 2, 3, 4, 3, 2, 1];
          for (let k = 0; k < per; k++) {
            const nt = arpNotes[shape[k % shape.length] % arpNotes.length];
            const sw = k % 2 ? m.swing * stepLen : 0;
            const vel = (k % 4 === 0 ? 1 : 0.72) * (0.9 + 0.2 * rnd());
            const len = stepLen * (m.keys === "bell" ? 3 : 1.8);
            wet.add(tb + k * stepLen + sw, len, Math.sin(k * 1.3) * 0.45, kl * vel * (per === 16 ? 0.75 : 1), keysVoice(m.keys, mtof(nt), len));
          }
          break;
        }
        case "quarters": {
          for (let k = 0; k < 4; k++) {
            const nt = upper[(k + bi) % upper.length];
            wet.add(tb + k * beat, beat * 2, (k % 2 ? 0.3 : -0.3), kl * (k === 0 ? 1 : 0.65), keysVoice(m.keys, mtof(nt), beat * 2));
          }
          break;
        }
        case "sparse": {
          for (let k = 0; k < 4; k++) {
            if (rnd() < 0.55) {
              const nt = upper[Math.floor(rnd() * upper.length)] + (rnd() < 0.3 ? 12 : 0);
              wet.add(tb + k * beat + rnd() * 0.05, beat * 3, rnd() * 1.2 - 0.6, kl * (0.6 + 0.4 * rnd()), keysVoice(m.keys, mtof(nt), beat * 3));
            }
          }
          break;
        }
      }
    }
  }

  // drums — first two bars stay sparse so the loop has a gentle "breath" each cycle
  if (m.drums !== "none") {
    const dl = m.drumsLevel;
    let seed = 1000;
    for (let b = 0; b < m.bars; b++) {
      const tb = b * bar;
      const intro = b < 2;
      const at = (s: number) => tb + s * six + (s % 2 ? m.swing * six : 0) + (rnd() - 0.5) * 0.006;
      const K = (s: number, g = 1) => dry.add(at(s), 0.5, 0, 0.5 * dl * g, kick(1));
      const S = (s: number, g = 1) => dry.add(at(s), 0.35, 0.05, 0.28 * dl * g, snare(seed++));
      const C = (s: number, g = 1) => dry.add(at(s), 0.35, -0.05, 0.3 * dl * g, clap(seed++));
      const H = (s: number, g = 1, d = 55) => dry.add(at(s), 0.2, 0.3, 0.16 * dl * g * (0.85 + 0.3 * rnd()), hat(seed++, d));
      const Sh = (s: number, g = 1) => dry.add(at(s), 0.15, -0.35, 0.14 * dl * g * (0.8 + 0.4 * rnd()), shaker(seed++));
      switch (m.drums) {
        case "lofi":
          if (!intro) {
            K(0); K(7, 0.6); K(10, 0.85);
            S(4, 0.9); S(12, 0.9);
          }
          for (let s = 0; s < 16; s += 2) H(s, s % 4 ? 0.6 : 0.9, 40);
          break;
        case "pop":
          if (!intro) {
            [0, 4, 8, 12].forEach((s) => K(s));
            C(4); C(12);
            for (let s = 0; s < 16; s++) H(s, s % 4 === 2 ? 1 : 0.45, s % 4 === 2 ? 30 : 70);
          } else for (let s = 2; s < 16; s += 4) H(s, 0.7, 40);
          break;
        case "soft":
          if (!intro) {
            K(0); K(8, 0.8); K(10, 0.5);
            C(4, 0.8); C(12, 0.8);
          }
          for (let s = 0; s < 16; s += 2) H(s, 0.5, 60);
          break;
        case "focus":
          if (!intro) { K(0, 0.8); K(8, 0.7); S(12, 0.35); }
          for (let s = 0; s < 16; s += 2) H(s, 0.4, 70);
          for (let s = 1; s < 16; s += 2) Sh(s, 0.35);
          break;
        case "playful":
          if (!intro) { K(0); K(6, 0.6); K(8, 0.9); S(4, 0.6); S(12, 0.6); }
          for (let s = 0; s < 16; s++) Sh(s, s % 2 ? 0.5 : 0.8);
          break;
        case "brush":
          if (!intro) { K(0, 0.45); K(8, 0.3); }
          for (let s = 0; s < 16; s += 2) Sh(s, s % 4 ? 0.45 : 0.7);
          if (!intro) S(12, 0.22);
          break;
        case "cinematic":
          if (b % 2 === 0) dry.add(tb, 2.5, 0, 0.55 * dl, boom());
          if (!intro && b % 2 === 1) { dry.add(at(12), 2, 0, 0.3 * dl, boom()); S(14, 0.35); }
          break;
      }
    }
  }

  // vinyl crackle + hiss
  if (m.crackle) {
    const r = prng(7);
    let lp = 0;
    for (let k = 0; k < n; k++) {
      const hiss = r() * 2 - 1;
      lp += 0.05 * (hiss - lp);
      let v = lp * 0.012;
      if (r() < 0.00025) v += (r() * 2 - 1) * 0.08;
      dry.L[k] += v;
      dry.R[k] += v * 0.9;
    }
  }

  // master
  const master = new Bus(n);
  wet.mixInto(master, 1);
  dry.mixInto(master, 1);
  reverbCycle(wet, m.reverb, master);
  const drySend = new Bus(n);
  dry.mixInto(drySend, 0.25);
  reverbCycle(drySend, m.reverb * 0.6, master);
  highpassCycle(master, 30);
  lowpassCycle(master, m.brightness);

  // loudness: RMS → about -18 dBFS, gentle tanh limiter keeps peaks under -1 dBFS
  let sum = 0;
  for (let k = 0; k < n; k++) sum += master.L[k] * master.L[k] + master.R[k] * master.R[k];
  const rms = Math.sqrt(sum / (2 * n)) || 1e-9;
  const g = Math.pow(10, -18 / 20) / rms;
  const ceil = 0.89;
  for (const ch of [master.L, master.R]) for (let k = 0; k < n; k++) ch[k] = ceil * Math.tanh((ch[k] * g) / ceil);
  return { L: master.L, R: master.R };
}

export function encodeWavStereo(L: Float32Array, R: Float32Array): Buffer {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), o);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), o + 2);
  }
  return buf;
}

/** Render a mood to a WAV file (atomic write). */
export function writeMoodWav(m: MoodDef, file: string): void {
  const { L, R } = renderMood(m);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, encodeWavStereo(L, R));
  fs.renameSync(tmp, file);
}

// CLI (used by music.ts to render in a child process so the API never blocks):
//   tsx musicgen.ts <moodId> <outFile>
import { fileURLToPath as __f } from "node:url";
import __path from "node:path";
if (process.argv[1] && __path.resolve(process.argv[1]) === __path.resolve(__f(import.meta.url))) {
  const [moodId, out] = process.argv.slice(2);
  const m = moodId ? getMood(moodId) : undefined;
  if (!m || !out) {
    console.error("usage: musicgen.ts <moodId> <outFile>");
    process.exit(2);
  }
  writeMoodWav(m, out);
}
