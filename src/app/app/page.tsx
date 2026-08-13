import { redirect } from "next/navigation";
import { ensureAuth } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

/** Alias for the authenticated application home (existing destination remains `/`). */
export default async function AppAliasPage() {
  await ensureAuth();
  redirect("/");
}
