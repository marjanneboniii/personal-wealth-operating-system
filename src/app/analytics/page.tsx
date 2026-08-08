import { redirect } from "next/navigation";

// Wealth analytics now lives inside the premium Net Worth experience.
export default function AnalyticsRedirect() {
  redirect("/net-worth");
}
