import Icon from "@/components/ui/Icon";
import { faCount } from "@/lib/format";

/**
 * The three steps of «اتصال پیامک», each saying where the user stands —
 * so the page answers «what is left to do?» before any explanation.
 */
export default function SmsProgress({ cards, iphones, waiting }: { cards: number; iphones: number; waiting: number }) {
  const steps = [
    { href: "#sms-cards", title: "کارت‌ها", done: cards > 0, status: cards > 0 ? `${faCount(cards)} مورد وصل است` : "هنوز وصل نشده" },
    { href: "#sms-iphone", title: "آیفون", done: iphones > 0, status: iphones > 0 ? "وصل است" : "هنوز وصل نشده" },
    { href: "#sms-inbox", title: "تأیید پیام‌ها", done: false, status: waiting > 0 ? `${faCount(waiting)} پیام منتظر شماست` : "پیامی منتظر نیست" },
  ];
  return (
    <ol className="sms-progress" aria-label="مراحل اتصال پیامک">
      {steps.map((s, i) => (
        <li key={s.href}>
          <a href={s.href} data-done={s.done || undefined} data-waiting={(i === 2 && waiting > 0) || undefined}>
            <span className="sms-step-number" aria-hidden="true">
              {s.done ? <Icon name="check" size={14} strokeWidth={3} /> : faCount(i + 1)}
            </span>
            <span className="min-w-0">
              <b>{s.title}</b>
              <small>{s.status}</small>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}
