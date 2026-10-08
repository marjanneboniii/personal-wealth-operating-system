import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { color } from "../design/tokens";

/**
 * Global stage: deep ink, a ledger grid receding into the floor and two slow
 * light fields. Every motion completes whole cycles over the video, so a
 * looping player never shows a seam.
 */
export function Backdrop({ accent = color.mint }: { accent?: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const turn = (frame / durationInFrames) * Math.PI * 2;
  const orbA = { x: 24 + Math.sin(turn) * 7, y: 30 + Math.cos(turn) * 8 };
  const orbB = { x: 78 + Math.cos(turn) * 6, y: 72 + Math.sin(turn * 2) * 5 };
  const cell = 96;
  const gridShift = ((frame / durationInFrames) * cell * 5) % cell;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 90% at 50% 0%, ${color.ink800} 0%, ${color.ink900} 45%, ${color.ink950} 100%)`, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: `radial-gradient(40% 45% at ${orbA.x}% ${orbA.y}%, ${accent}24 0%, transparent 70%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(38% 42% at ${orbB.x}% ${orbB.y}%, ${color.sky}1c 0%, transparent 70%)` }} />
      <AbsoluteFill style={{ perspective: 900, perspectiveOrigin: "50% 0%" }}>
        <div
          style={{
            position: "absolute",
            left: "-50%",
            right: "-50%",
            top: "56%",
            height: "120%",
            transform: "rotateX(72deg)",
            transformOrigin: "top",
            backgroundImage: `linear-gradient(${color.lineStrong} 1px, transparent 1px), linear-gradient(90deg, ${color.lineStrong} 1px, transparent 1px)`,
            backgroundSize: `${cell}px ${cell}px`,
            backgroundPosition: `0 ${gridShift}px`,
            maskImage: "linear-gradient(to bottom, rgba(0,0,0,.5), transparent 70%)",
            WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,.5), transparent 70%)",
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "radial-gradient(90% 80% at 50% 50%, transparent 55%, rgba(2,5,10,.65) 100%)" }} />
    </AbsoluteFill>
  );
}
