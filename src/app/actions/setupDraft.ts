"use server";
import { getCurrentUser } from "@/lib/auth";
import { isSetupRequired } from "@/lib/setupGate";
import { saveSetupDraft } from "@/features/setup/workflow";
export async function saveSetupDraftAction(draft: unknown) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "ابتدا وارد شوید." };
  if (!(await isSetupRequired(user.id))) return { ok: true, message: "راه‌اندازی تکمیل شده است." };
  try { await saveSetupDraft(user.id, draft); return { ok: true, message: "پیش‌نویس ذخیره شد." }; }
  catch { return { ok: false, message: "پیش‌نویس ذخیره نشد؛ پیش از خروج دوباره تلاش کنید." }; }
}

export async function confirmExistingSetupAction(reviewed: unknown) {
  const user = await getCurrentUser();
  if (!user) return {ok:false,message:"ابتدا وارد شوید."};
  if (!Array.isArray(reviewed) || reviewed.length !== 9 || reviewed.some(v => v !== true)) return {ok:false,message:"بررسی همه مراحل الزامی است."};
  const {db} = await import("@/db");
  const {accounts,userSetupState,setupSessions} = await import("@/db/schema");
  const {eq,and,isNull} = await import("drizzle-orm");
  try {
    await db.transaction(async tx => {
      const [session] = await tx.select().from(setupSessions).where(eq(setupSessions.userId,user.id)).for("update");
      if ((session?.progress as {base?:string} | undefined)?.base || session?.leaseToken) throw new Error("ثبت نیمه‌تمام را از همان پیش‌نویس تکمیل کنید.");
      const owned = await tx.select({id:accounts.id}).from(accounts).where(and(eq(accounts.userId,user.id),eq(accounts.type,"asset"),isNull(accounts.deletedAt))).limit(1);
      if (!owned.length) throw new Error("ابتدا راه‌اندازی اولیه را تکمیل کنید.");
      const rows=await tx.update(userSetupState).set({completed:true,currentStep:9,updatedAt:new Date()}).where(eq(userSetupState.userId,user.id)).returning({id:userSetupState.id});
      if (!rows.length) await tx.insert(userSetupState).values({userId:user.id,completed:true,currentStep:9});
    });
    const {invalidateTenantStateCache} = await import("@/lib/tenantState");
    invalidateTenantStateCache();
    return {ok:true,message:"بررسی اطلاعات قبلی تکمیل شد؛ موجودی تازه‌ای ثبت نشد."};
  } catch(e) {return {ok:false,message:e instanceof Error ? e.message : "تأیید انجام نشد."};}
}
