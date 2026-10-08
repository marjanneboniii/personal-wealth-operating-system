import type { TemplateName, TemplateProps } from "../scenes/registry";
import { canvas } from "../design/tokens";

/** One beat of the story: a template, how long it holds, and its content. */
export type SceneSpec = {
  [K in TemplateName]: {
    template: K;
    /** On-screen time in seconds. Keep to whole beats (0.5s at 120 BPM). */
    seconds: number;
    /** Optional id the landing page can seek to. */
    chapter?: string;
    props: TemplateProps<K>;
  };
}[TemplateName];

export type VideoSpec = {
  /** Composition id: letters, digits and dashes. */
  id: string;
  title: string;
  scenes: SceneSpec[];
  /** Quiet line under every scene, e.g. that the data is fictional. */
  footnote?: string;
  /** Show brand lockup and chapter progress. Default true. */
  chrome?: boolean;
};

export const defineVideo = (spec: VideoSpec) => spec;

export function timeline(spec: VideoSpec, fps: number = canvas.fps) {
  let from = 0;
  const scenes = spec.scenes.map((scene) => {
    const duration = Math.round(scene.seconds * fps);
    const slot = { from, duration, scene };
    from += duration;
    return slot;
  });
  return { scenes, durationInFrames: from };
}
