import OnboardingChecklist from "@/components/onboarding/OnboardingChecklist";
import { ensureAuth } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

export const metadata = { title: "چک‌لیست دارایی‌ها — توازن" };

export default async function OnboardingPage() {
  await ensureAuth();
  return <OnboardingChecklist />;
}
