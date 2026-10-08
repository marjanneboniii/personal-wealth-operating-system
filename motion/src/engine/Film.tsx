import { createElement } from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Chrome } from "../components/Chrome";
import { loadBrandFonts } from "../design/fonts";
import { clamp, ease, timing } from "../design/motion";
import { canvas, font } from "../design/tokens";
import { templates } from "../scenes/registry";
import { timeline, type VideoSpec } from "./spec";

loadBrandFonts();

/** Distance between scenes on the camera strip. */
const STRIP = canvas.width + 360;

/**
 * Camera position in scenes (0 = first scene) and its speed, for a whip pan
 * centred on every boundary. Peak speed lands exactly on the cut frame.
 */
function camera(frame: number, cuts: number[]) {
  const at = (f: number) =>
    cuts.reduce((pos, cut) => pos + interpolate(f, [cut - timing.whip / 2, cut + timing.whip / 2], [0, 1], { ...clamp, easing: ease.whip }), 0);
  const pos = at(frame);
  const speed = Math.abs(pos - at(frame - 1)); // strips per frame
  return { pos, speed };
}

/**
 * Renders a VideoSpec. Scenes sit side by side on one strip (each next scene
 * further left, as Persian reads) and one camera travels across them: a whip
 * with horizontal motion blur, then a slow 1.00 → 1.04 breathe while the
 * scene holds. Brand chrome stays fixed above the moving strip.
 */
export function Film({ spec }: { spec: VideoSpec }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { scenes } = timeline(spec, fps);
  const cuts = scenes.slice(1).map((s) => s.from);
  const { pos, speed } = camera(frame, cuts);
  const current = scenes.findLast((s) => frame >= s.from) ?? scenes[0];
  const breathe = 1 + 0.04 * interpolate(frame, [current.from, current.from + current.duration], [0, 1], clamp);
  const whipDip = 1 - 0.05 * Math.sin(Math.PI * (pos % 1));
  const blur = Math.min(60, speed * STRIP * 0.12);

  return (
    <AbsoluteFill dir="rtl" lang="fa" style={{ fontFamily: font.sans, direction: "rtl" }}>
      <Backdrop />
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <filter id="whip-blur" x="-20%" y="0" width="140%" height="100%">
            <feGaussianBlur stdDeviation={`${blur.toFixed(2)} 0`} />
          </filter>
        </defs>
      </svg>
      <AbsoluteFill style={{ transform: `scale(${breathe * whipDip})`, filter: blur > 0.5 ? "url(#whip-blur)" : undefined }}>
        <AbsoluteFill style={{ transform: `translateX(${pos * STRIP}px)` }}>
          {scenes.map(({ from, duration, scene }, i) => (
            // The outgoing scene stays mounted through the second half of the whip.
            <Sequence key={i} from={from} durationInFrames={duration + (i < scenes.length - 1 ? timing.whip / 2 : 0)} layout="none">
              <AbsoluteFill style={{ left: -i * STRIP, right: i * STRIP }}>
                {createElement(templates[scene.template] as React.ComponentType<typeof scene.props>, scene.props)}
              </AbsoluteFill>
            </Sequence>
          ))}
        </AbsoluteFill>
      </AbsoluteFill>
      {spec.chrome !== false && <Chrome chapters={scenes.map(({ from, duration }) => ({ from, duration }))} footnote={spec.footnote} />}
    </AbsoluteFill>
  );
}
