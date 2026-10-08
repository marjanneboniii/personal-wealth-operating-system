/** Brand templates: title cards, statements and the closing call to action. */
import { interpolate, useCurrentFrame } from "remotion";
import { BrandGlyph } from "../components/Brand";
import { PressButton } from "../components/Feedback";
import { Body, Eyebrow, Headline } from "../components/Text";
import { clamp, ease, timing, useEnter } from "../design/motion";
import { color, type, weight } from "../design/tokens";
import { Center } from "./Layout";

const L = timing.lead;

// ─── logo: the scale glyph draws itself, then the wordmark ────────────────
export type LogoProps = { tagline?: string };

export function LogoScene({ tagline }: LogoProps) {
  const frame = useCurrentFrame();
  const halo = interpolate(frame, [L + 10, L + 40], [0, 1], { ...clamp, easing: ease.enter });
  const word = useEnter(L + 24, 24);
  return (
    <Center>
      <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
        <div style={{ position: "absolute", inset: -120, borderRadius: "50%", background: `radial-gradient(circle, ${color.mint}33, transparent 65%)`, opacity: halo, transform: `scale(${0.8 + halo * 0.2})` }} />
        <BrandGlyph size={260} tint={color.text} draw={{ start: L }} />
      </div>
      <div style={{ fontSize: type.display, fontWeight: weight.bold, color: color.text, lineHeight: 1.4, ...word.style }}>توازن</div>
      {tagline && <Body delay={L + 34} size={type.h2 * 0.75} tint={color.text2}>{tagline}</Body>}
    </Center>
  );
}

// ─── statement: one big line ───────────────────────────────────────────────
export type StatementProps = { eyebrow?: string; headline: string; body?: string };

export function StatementScene({ eyebrow, headline, body }: StatementProps) {
  return (
    <Center>
      {eyebrow && <Eyebrow delay={L}>{eyebrow}</Eyebrow>}
      <Headline text={headline} delay={L + 4} size={type.hero} style={{ justifyContent: "center" }} />
      {body && <Body delay={L + 18} size={type.title * 0.8}>{body}</Body>}
    </Center>
  );
}

// ─── cta: closing card with the primary action ─────────────────────────────
export type CtaProps = { headline: string; button: string; note?: string };

export function CtaScene({ headline, button, note }: CtaProps) {
  return (
    <Center>
      <BrandGlyph size={150} tint={color.mint} draw={{ start: L }} />
      <Headline text={headline} delay={L + 10} size={type.h1} style={{ justifyContent: "center" }} />
      <div style={{ width: 640 }}>
        <PressButton label={button} delay={L + 22} pressAt={L + 60} />
      </div>
      {note && <Body delay={L + 30} size={type.label} tint={color.text3}>{note}</Body>}
    </Center>
  );
}
