"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAuth, isAdminOrOwner } from "@/lib/authGuard";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAuditEvent } from "@/lib/audit";

export async function manageUserAction(formData: FormData) {
  const actor = await ensureAuth();
  if (!isAdminOrOwner(actor)) throw new Error("Forbidden");
  const targetId = String(formData.get("userId") || "");
  const action = String(formData.get("action") || "");
  if (!/^[0-9a-f-]{36}$/i.test(targetId) || targetId === actor.id) throw new Error("Invalid target");
  const admin = createAdminClient();
  const [targetProfile] = await db.select({ role: users.role }).from(users).where(eq(users.id, targetId)).limit(1);
  if (!targetProfile) throw new Error("Unknown target");
  if (targetProfile.role === "owner") throw new Error("Owner accounts cannot be changed here");

  if (action === "suspend" || action === "restore") {
    const { error } = await admin.auth.admin.updateUserById(targetId, {
      ban_duration: action === "suspend" ? "876000h" : "none",
    });
    if (error) throw error;
  } else if (action === "make-admin" || action === "make-user") {
    if (actor.role !== "owner") throw new Error("Only owner can change roles");
    await db.update(users).set({ role: action === "make-admin" ? "admin" : "user", updatedAt: new Date() } as any).where(eq(users.id, targetId));
  } else {
    throw new Error("Invalid action");
  }

  await recordAuditEvent({ action: `ADMIN_USER_${action.toUpperCase()}`, entityType: "user", entityId: targetId, userId: actor.id, result: "SUCCESS" });
  revalidatePath("/admin");
}
