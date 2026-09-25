import type { IconName } from "@/components/ui/Icon";

/** The mark and tint of each kind of policy — the form's tiles and the list's rows. */
export const POLICY_KIND_VISUAL: Record<string, { icon: IconName; tone: "info" | "warning" | "negative" | "positive" | "action" }> = {
  third_party: { icon: "car", tone: "info" },
  car_body: { icon: "shield", tone: "info" },
  fire: { icon: "home", tone: "negative" },
  health: { icon: "heart", tone: "positive" },
  life: { icon: "users", tone: "action" },
  travel: { icon: "globe", tone: "warning" },
  liability: { icon: "scale", tone: "warning" },
  other: { icon: "more", tone: "action" },
};

export function policyKindStyle(kind: string): { background: string; color: string } {
  const tone = (POLICY_KIND_VISUAL[kind] ?? POLICY_KIND_VISUAL.other).tone;
  return { background: `var(--${tone}-soft)`, color: `var(--${tone})` };
}
