import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { canvas, space } from "../design/tokens";

/**
 * Standard two-column scene. In RTL the first child (`copy`) sits on the
 * right, where reading starts; `visual` takes the left. `align` lets a scene
 * pin the copy to the top when the visual is tall.
 */
export function Split({ copy, visual, copyWidth = 820 }: { copy: ReactNode; visual: ReactNode; copyWidth?: number }) {
  return (
    <AbsoluteFill style={{ padding: `${space.safeY + 80}px ${space.safeX}px ${space.safeY}px`, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.xl }}>
      <div style={{ width: copyWidth, display: "flex", flexDirection: "column", gap: 36 }}>{copy}</div>
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>{visual}</div>
    </AbsoluteFill>
  );
}

export function Center({ children }: { children: ReactNode }) {
  return (
    <AbsoluteFill style={{ padding: `${space.safeY}px ${space.safeX}px`, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div style={{ maxWidth: canvas.width - space.safeX * 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 40 }}>{children}</div>
    </AbsoluteFill>
  );
}
