import type { ReactNode } from "react";

/** Short, numbered instructions shared by the SMS setup and inbox. */
export default function SmsGuideSteps({ steps }: { steps: { title: string; content: ReactNode }[] }) {
  return <ol className="sms-guide-steps">{steps.map((step, index) => <li key={step.title}>
    <span className="sms-step-number" aria-hidden="true">{(index + 1).toLocaleString("fa-IR")}</span>
    <div className="sms-step-content"><h3>{step.title}</h3><div>{step.content}</div></div>
  </li>)}</ol>;
}
