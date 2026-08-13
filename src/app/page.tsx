import LandingPage from "@/components/landing/LandingPage";
import OverviewDashboard from "@/components/overview/OverviewDashboard";
import { resolveHomeMode } from "@/lib/publicEntry";

export const dynamic = "force-dynamic";

/**
 * Public entry (`/`) is the marketing landing when a session is required
 * and the visitor is not signed in. Authenticated (and legacy single-tenant)
 * visitors continue to see the existing wealth dashboard at the same path
 * so login/register redirects and auth actions stay unchanged.
 */
export default async function HomePage() {
  const mode = await resolveHomeMode();
  if (mode === "app") return <OverviewDashboard />;
  return <LandingPage />;
}
