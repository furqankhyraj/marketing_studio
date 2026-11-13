import fs from "node:fs";

/** Encode mono float samples [-1,1] as 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), o);
    o += 2;
  }
  return buf;
}

export function writeWav(file: string, samples: Float32Array, sampleRate: number): void {
  fs.writeFileSync(file, encodeWav(samples, sampleRate));
}

/** Minimal WAV decoder (PCM 16/24/32-bit int or 32-bit float), downmixed to mono. */
export function readWav(file: string): { samples: Float32Array; sampleRate: number } {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Not a WAV file: ${file}`);
  }
  let off = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
      if (fmt.format === 0xfffe && size >= 26) fmt.format = buf.readUInt16LE(body + 24); // extensible
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV data before fmt chunk");
      if (size > buf.length - body || size === 0xffffffff) size = buf.length - body;
      const bps = fmt.bits / 8;
      const frames = Math.floor(size / (bps * fmt.channels));
      const out = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let acc = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const p = body + (f * fmt.channels + c) * bps;
          let v: number;
          if (fmt.format === 3 && fmt.bits === 32) v = buf.readFloatLE(p);
          else if (fmt.bits === 16) v = buf.readInt16LE(p) / 0x8000;
          else if (fmt.bits === 24) v = buf.readIntLE(p, 3) / 0x800000;
          else if (fmt.bits === 32) v = buf.readInt32LE(p) / 0x80000000;
          else if (fmt.bits === 8) v = (buf.readUInt8(p) - 128) / 128;
          else throw new Error(`Unsupported WAV bit depth ${fmt.bits}`);
          acc += v;
        }
        out[f] = acc / fmt.channels;
      }
      return { samples: out, sampleRate: fmt.rate };
    }
    off = body + size + (size % 2);
  }
  throw new Error(`WAV has no data chunk: ${file}`);
}

/** Linear-interpolation resampler (adequate for speech → whisper). */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const n = Math.floor(samples.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const t = x - i0;
    out[i] = samples[i0] * (1 - t) + samples[i1] * t;
  }
  return out;
}

export function wavDurationMs(file: string): number {
  const { samples, sampleRate } = readWav(file);
  return Math.round((samples.length / sampleRate) * 1000);
}
