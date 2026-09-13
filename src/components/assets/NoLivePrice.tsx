/**
 * The marker for «no live price» — a small muted icon, never a sentence.
 *
 * A market list shows many rows without a price (Tehran-exchange funds and
 * stocks until a live feed exists, a coin with no trade today). Writing the
 * reason out on every row made the list long and noisy, so the reason lives in
 * the tooltip and the accessible label; the row itself carries only the icon.
 */
import Icon from "@/components/ui/Icon";

const LABEL = "قیمت زنده ندارد";

export default function NoLivePrice({ size = 14 }: { size?: number }) {
  return (
    <span className="muted inline-flex items-center" role="img" aria-label={LABEL} title={LABEL}>
      <Icon name="clock" size={size} />
    </span>
  );
}
