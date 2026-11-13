import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** voice/ package root */
export const PKG_ROOT = path.resolve(here, "..");

export interface VoiceConfig {
  pexelsApiKey?: string;
  pixabayApiKey?: string;
  dataDir?: string;
}

const state: VoiceConfig = {};

/** Called by the server with keys from settings. Undefined fields are left unchanged; empty string clears. */
export function configure(cfg: VoiceConfig): void {
  for (const k of ["pexelsApiKey", "pixabayApiKey", "dataDir"] as const) {
    if (cfg[k] !== undefined) state[k] = cfg[k] || undefined;
  }
}

export function dataDir(): string {
  return path.resolve(state.dataDir || process.env.DATA_DIR || path.join(PKG_ROOT, "..", "data"));
}

export function modelsDir(): string {
  return path.join(dataDir(), "models");
}

export function whisperDir(): string {
  return path.join(dataDir(), "whisper");
}

export function pexelsKey(): string | undefined {
  return state.pexelsApiKey || process.env.PEXELS_API_KEY || undefined;
}

export function pixabayKey(): string | undefined {
  return state.pixabayApiKey || process.env.PIXABAY_API_KEY || undefined;
}
