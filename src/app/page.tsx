import { isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import LandingPage from "@/components/landing/LandingPage";
import OverviewDashboard from "@/components/overview/OverviewDashboard";

export const dynamic = "force-dynamic";

/**
 * Public entry (`/`) is the marketing landing when a session is required
 * and the visitor is not signed in. Authenticated (and legacy single-tenant)
 * visitors continue to see the existing wealth dashboard at the same path
 * so login/register redirects and auth actions stay unchanged.
 */
export default async function HomePage() {
  let mode: "app" | "landing" = "landing";
  try {
    const user = await getCurrentUser();
    if (user) {
      mode = "app";
    } else {
      const [row] = await db.select({ id: users.id }).from(users).where(isNotNull(users.username)).limit(1);
      mode = row ? "landing" : "app";
    }
  } catch {
    mode = "landing";
  }

  if (mode === "app") return <OverviewDashboard />;
  return <LandingPage />;
}
