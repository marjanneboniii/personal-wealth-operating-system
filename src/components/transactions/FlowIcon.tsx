import Icon from "@/components/ui/Icon";

/** Direction mark of a money movement: in, out, or moved between the user's own accounts. */
export default function FlowIcon({ sign }: { sign: -1 | 0 | 1 }) {
  const icon = sign > 0 ? "arrow-up" : sign < 0 ? "arrow-down" : "swap";
  return (
    <span className={`flow-icon${sign > 0 ? " is-in" : ""}`} aria-hidden="true">
      <Icon name={icon} size={15} />
    </span>
  );
}
