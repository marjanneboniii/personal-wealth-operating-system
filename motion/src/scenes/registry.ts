import type { ComponentType } from "react";
import { ActionScene, DeltaScene, MeterScene, MixScene, StatScene } from "./money";
import { CtaScene, LogoScene, StatementScene } from "./brand";

/**
 * Every scene a video can use. A spec names a template and passes its props;
 * adding a new kind of scene means adding one component here.
 */
export const templates = {
  logo: LogoScene,
  statement: StatementScene,
  stat: StatScene,
  meter: MeterScene,
  action: ActionScene,
  delta: DeltaScene,
  mix: MixScene,
  cta: CtaScene,
} as const;

export type TemplateName = keyof typeof templates;
export type TemplateProps<K extends TemplateName> = (typeof templates)[K] extends ComponentType<infer P> ? P : never;
