/**
 * PREVIEW-ONLY login route. capture-app.sh copies this file into the THROWAWAY
 * worktree it screenshots (src/app/api/dev-preview-login/route.ts). It is never
 * part of the real app: the worktree is deleted when the capture ends.
 *
 * It refuses to do anything unless the app runs on the embedded in-memory
 * database outside production. There it loads the built-in demo data, hands
 * the ownerless demo rows to the single demo owner (the project's own legacy
 * claim helper), marks setup as done and signs that owner in.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, userSetupState } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { migrateLegacyFinancialData } from "@/db/migrate-multiuser";
import { createSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" || !(process.env.DATABASE_URL ?? "").startsWith("memory://")) {
    return new NextResponse("Not available", { status: 404 });
  }
  await seedIfEmpty();
  const [owner] = await db.select().from(users).limit(1);
  if (!owner) return new NextResponse("Demo data did not load (APP_MODE=development?)", { status: 500 });
  await migrateLegacyFinancialData();
  const [setup] = await db.select().from(userSetupState).where(eq(userSetupState.userId, owner.id)).limit(1);
  if (setup) await db.update(userSetupState).set({ completed: true }).where(eq(userSetupState.userId, owner.id));
  else await db.insert(userSetupState).values({ userId: owner.id, completed: true, currentStep: 99 });

  const { token, expiresAt } = await createSession(owner.id);
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set("pwos_session", token, { httpOnly: true, sameSite: "lax", path: "/", expires: expiresAt });
  return response;
}
