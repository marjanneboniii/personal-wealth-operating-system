/**
 * Money templates: the product's core stories (a figure, a limit, an action,
 * a change, a mix). Copy and numbers come from the video spec; timing and
 * look come from the design system, so every video moves the same way.
 */
import { interpolate, useCurrentFrame } from "remotion";
import { Body, Eyebrow, Headline } from "../components/Text";
import { Counter } from "../components/Counter";
import { GlassCard, Row } from "../components/Card";
import { Donut, Legend, Meter, type Segment } from "../components/Data";
import { CheckBurst, Chip, PressButton } from "../components/Feedback";
import { Icon, type IconName } from "../components/Icon";
import { clamp, ease, stagger, timing } from "../design/motion";
import { faNumber } from "../design/persian";
import { color, toneColor, type Tone, type, weight } from "../design/tokens";
import { Split } from "./Layout";

export type Copy = { eyebrow: string; headline: string; body?: string };
type Amount = { label: string; amount: number; unit?: string; tone?: Tone };

const L = timing.lead;

function CopyBlock({ copy }: { copy: Copy }) {
  return (
    <>
      <Eyebrow delay={L}>{copy.eyebrow}</Eyebrow>
      <Headline text={copy.headline} delay={L + 4} />
      {copy.body && <Body delay={L + 16}>{copy.body}</Body>}
    </>
  );
}

function CardTitle({ icon, children }: { icon?: IconName; children: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, color: color.text2, fontSize: type.label, fontWeight: weight.medium }}>
      {icon && (
        <span style={{ display: "flex", padding: 14, borderRadius: 18, background: "rgba(49,242,191,.10)", color: color.mint }}>
          <Icon name={icon} size={44} />
        </span>
      )}
      {children}
    </div>
  );
}

// ─── stat: one hero figure and the parts that make it ─────────────────────
export type StatProps = { copy: Copy; hero: Amount & { icon?: IconName }; rows?: Amount[]; note?: string };

export function StatScene({ copy, hero, rows = [], note }: StatProps) {
  const card = L + 8;
  return (
    <Split
      copy={<CopyBlock copy={copy} />}
      visual={
        <GlassCard delay={card} width={770}>
          <CardTitle icon={hero.icon}>{hero.label}</CardTitle>
          <Counter to={hero.amount} unit={hero.unit} delay={card + 6} size={150} glow={color.mint} />
          {rows.map((row, i) => (
            <Row key={row.label} label={row.label} delay={card + 18 + stagger(i, 4)}>
              <Counter to={row.amount} unit={row.unit} delay={card + 20 + stagger(i, 4)} size={60} tint={toneColor(row.tone)} />
            </Row>
          ))}
          {note && <Chip icon="check" delay={card + 34}>{note}</Chip>}
        </GlassCard>
      }
    />
  );
}

// ─── meter: progress toward a limit or goal ───────────────────────────────
export type MeterProps = { copy: Copy; title: string; icon?: IconName; used: number; limit: number; unit: string; usedLabel: string; remaining: string; tone?: Tone };

export function MeterScene({ copy, title, icon, used, limit, unit, usedLabel, remaining, tone = "mint" }: MeterProps) {
  const card = L + 8;
  return (
    <Split
      copy={<CopyBlock copy={copy} />}
      visual={
        <GlassCard delay={card} width={770}>
          <CardTitle icon={icon}>{title}</CardTitle>
          <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
            <Counter to={used} delay={card + 8} size={150} glow={toneColor(tone)} />
            <span style={{ fontSize: type.h2 * 0.8, color: color.text2, fontWeight: weight.medium }}>
              از {faNumber(limit)} {unit}
            </span>
          </div>
          <span style={{ fontSize: type.label, color: color.text3, marginTop: -16 }}>{usedLabel}</span>
          <Meter value={used / limit} delay={card + 10} tone={tone} />
          <Chip icon="check" tone={tone} delay={card + 44}>{remaining}</Chip>
        </GlassCard>
      }
    />
  );
}

// ─── action: a short form that gets submitted ─────────────────────────────
export type ActionProps = { copy: Copy; title: string; icon?: IconName; fields: { label: string; value: string }[]; button: string; note?: string };

export function ActionScene({ copy, title, icon, fields, button, note }: ActionProps) {
  const card = L + 8;
  const pressAt = card + 52;
  return (
    <Split
      copy={<CopyBlock copy={copy} />}
      visual={
        <GlassCard delay={card} width={770}>
          <CardTitle icon={icon}>{title}</CardTitle>
          {fields.map((f, i) => (
            <Row key={f.label} label={f.label} delay={card + 10 + stagger(i, 4)}>
              <span style={{ fontSize: type.body, fontWeight: weight.semibold, color: color.text, whiteSpace: "nowrap" }}>{f.value}</span>
            </Row>
          ))}
          <PressButton label={button} delay={card + 22} pressAt={pressAt} />
          {note && <Body delay={pressAt + 8} size={type.caption + 4} tint={color.text3}>{note}</Body>}
        </GlassCard>
      }
    />
  );
}

// ─── delta: what changed after an action, and what stayed the same ────────
export type DeltaProps = { copy: Copy; badge: string; rows: { label: string; from: number; to: number; unit?: string; tone?: Tone }[]; steady?: Amount };

export function DeltaScene({ copy, badge, rows, steady }: DeltaProps) {
  const frame = useCurrentFrame();
  const card = L + 8;
  const change = card + 26;
  return (
    <Split
      copy={<CopyBlock copy={copy} />}
      visual={
        <GlassCard delay={card} width={770}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <CheckBurst delay={card + 6} size={104} />
            <span style={{ fontSize: type.title, fontWeight: weight.bold, color: color.positive }}>{badge}</span>
          </div>
          {rows.map((row, i) => {
            const at = change + stagger(i, 5);
            const old = interpolate(frame, [at, at + 14], [0, 1], { ...clamp, easing: ease.enter });
            return (
              <Row key={row.label} label={row.label} delay={card + 12 + stagger(i, 4)} highlight={frame > at ? toneColor(row.tone ?? "mint") : undefined}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
                  {/* The old value slides to the end side and dims, struck through. */}
                  <span style={{ position: "relative", fontSize: type.label, color: color.text3, opacity: old * 0.9, transform: `translateX(${(1 - old) * 30}px)`, whiteSpace: "nowrap" }}>
                    {faNumber(row.from)}
                    <span style={{ position: "absolute", insetInline: 0, top: "52%", height: 3, background: color.text3, transform: `scaleX(${old})`, transformOrigin: "right" }} />
                  </span>
                  <Counter from={row.from} to={row.to} delay={at} duration={30} size={60} unit={row.unit} tint={toneColor(row.tone)} />
                </div>
              </Row>
            );
          })}
          {steady && (
            <Chip icon="shield" tone="mint" delay={change + 30}>
              {steady.label}: {faNumber(steady.amount)} {steady.unit}
            </Chip>
          )}
        </GlassCard>
      }
    />
  );
}

// ─── mix: how a total is split ─────────────────────────────────────────────
export type MixProps = { copy: Copy; total: Amount; segments: Segment[]; highlight?: Amount };

export function MixScene({ copy, total, segments, highlight }: MixProps) {
  const card = L + 8;
  return (
    <Split
      copy={<CopyBlock copy={copy} />}
      visual={
        <GlassCard delay={card} width={770} padding={48}>
          <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
            <div style={{ position: "relative", width: 330, height: 330, flexShrink: 0 }}>
              <Donut segments={segments} delay={card + 8} size={330} thickness={36} />
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <Counter to={total.amount} delay={card + 8} size={92} glow={color.mint} />
                <span style={{ fontSize: type.caption, color: color.text2 }}>{total.unit}</span>
              </div>
            </div>
            <Legend segments={segments} delay={card + 16} />
          </div>
          <div style={{ fontSize: type.label, color: color.text2, marginTop: -8 }}>{total.label}</div>
          {highlight && (
            <Chip icon="trend-up" tone={highlight.tone ?? "positive"} delay={card + 40}>
              {highlight.label}: {faNumber(highlight.amount)} {highlight.unit}
            </Chip>
          )}
        </GlassCard>
      }
    />
  );
}
