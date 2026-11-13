import type { StyleDef } from "./types.ts";
import { cinematic, bold, paper, neon, magazine } from "./set1.tsx";
import { productDrop, textList, blueprint, zine, pulse } from "./set2.tsx";
import { clarity, ember, velocity, story } from "./set3.tsx";
import { persian } from "./set4.tsx";

export const STYLES: StyleDef[] = [cinematic, bold, paper, neon, magazine, productDrop, textList, blueprint, zine, pulse, clarity, ember, velocity, story, persian];

const byId = new Map(STYLES.map((s) => [s.meta.id, s]));

/** Look up a style; unknown ids fall back to "bold" so a render never fails on a typo. */
export function getStyle(id: string | undefined): StyleDef {
  if (!id) return bold;
  const k = id.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return byId.get(k) ?? byId.get(k.replace(/-?drop$/, "-drop")) ?? bold;
}
