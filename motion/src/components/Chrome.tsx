import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, ease } from "../design/motion";
import { color, space, type, weight } from "../design/tokens";
import { BrandLockup } from "./Brand";

/**
 * Persistent frame around every scene: brand lockup (start side), chapter
 * progress (end side) and a quiet footnote. It stays put while the camera
 * moves underneath, which is what makes a run of scenes feel like one film.
 */
export function Chrome({ chapters, footnote }: { chapters: { from: number; duration: number }[]; footnote?: string }) {
  const frame = useCurrentFrame();
  const intro = interpolate(frame, [0, 18], [0, 1], { ...clamp, easing: ease.enter });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: space.safeY - 40, insetInline: space.safeX, display: "flex", alignItems: "center", justifyContent: "space-between", opacity: intro }}>
        <BrandLockup size={64} />
        {/* Segments read right-to-left and each fills from the right. */}
        <div style={{ display: "flex", gap: 12 }}>
          {chapters.map((c, i) => {
            const p = interpolate(frame, [c.from, c.from + c.duration], [0, 1], clamp);
            const end = c.from + c.duration;
            const focus = interpolate(frame, [c.from - 8, c.from + 4, end - 4, end + 8], [0, 1, 1, 0], { ...clamp, easing: ease.inOut });
            return (
              <div key={i} style={{ width: 56 + focus * 72, height: 8, borderRadius: 8, background: "rgba(230,236,242,.14)", overflow: "hidden" }}>
                <div style={{ width: `${p * 100}%`, height: "100%", background: color.mint, boxShadow: `0 0 12px ${color.mint}` }} />
              </div>
            );
          })}
        </div>
      </div>
      {footnote && (
        <div style={{ position: "absolute", bottom: space.safeY - 64, insetInline: 0, textAlign: "center", fontSize: type.caption, color: color.text3, fontWeight: weight.medium, opacity: intro }}>
          {footnote}
        </div>
      )}
    </AbsoluteFill>
  );
}
