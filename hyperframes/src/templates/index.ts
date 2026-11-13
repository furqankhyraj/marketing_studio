import type { TemplateDef } from "./common.ts";
import { kineticType } from "./kinetic-type.ts";
import { productShowcase } from "./product-showcase.ts";
import { coursePromo } from "./course-promo.ts";
import { testimonialQuote } from "./testimonial-quote.ts";
import { listicleTips } from "./listicle-tips.ts";
import { beforeAfter } from "./before-after.ts";

export const TEMPLATES: TemplateDef[] = [kineticType, productShowcase, coursePromo, testimonialQuote, listicleTips, beforeAfter];

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
