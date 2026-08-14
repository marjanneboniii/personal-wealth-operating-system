/**
 * SectionHead — the standard landing section header (kicker + title + lead).
 * Every section on the landing follows the same quiet hierarchy.
 */
export default function SectionHead({
  kicker,
  title,
  lead,
  center = false,
}: {
  kicker: string;
  title: string;
  lead?: string;
  center?: boolean;
}) {
  return (
    <header className={`ld-sec-head ${center ? "center" : ""}`}>
      <p className="sec-kicker">{kicker}</p>
      <h2 className="sec-title">{title}</h2>
      {lead && <p className="sec-lead">{lead}</p>}
    </header>
  );
}
