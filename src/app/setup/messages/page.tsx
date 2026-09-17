import Link from "next/link";
import StepIntro from "@/components/setup/StepIntro";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import { ensureAuth } from "@/lib/authGuard";
import { getSetupState } from "@/features/setup/service";
import { listBankIdentifiers } from "@/features/bankImport/identifiers";
import { listSmsConnections } from "@/features/bankImport/sms";
import BankIdentifiers from "@/components/transactions/BankIdentifiers";
import IphoneSmsConnection from "@/components/transactions/IphoneSmsConnection";

export const dynamic = "force-dynamic";
export const metadata = { title: "راه‌اندازی توازن — اتصال پیامک" };

export default async function SetupMessagesPage() {
 const user = await ensureAuth();
 // Financial setup commits exactly once before credentials or card mappings can be created.
 if (!(await getSetupState(user.id)).completed) redirect("/setup");
 const [moneyAccounts, identifiers, connections] = await Promise.all([
  db.select({ id: accounts.id, name: accounts.name }).from(accounts).innerJoin(assets, eq(accounts.assetId, assets.id))
   .where(and(eq(accounts.userId, user.id), eq(accounts.type, "asset"), eq(accounts.isActive, true), eq(assets.symbol, "IRT"), isNull(accounts.deletedAt), isNull(assets.deletedAt))).orderBy(asc(accounts.name)),
  listBankIdentifiers(user.id),
  listSmsConnections(user.id),
 ]);
 let endpoint: string | null = null;
 try { const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || ""); if (url.protocol === "https:") endpoint = new URL("/api/bank-messages", url.origin).href; } catch {}
 return <div className="mx-auto max-w-2xl space-y-5 py-4">
  <header className="space-y-3"><h1 className="text-[length:var(--fs-xl)] font-bold tracking-tight">تکمیل اتصال پیامک</h1><p className="muted text-sm">راه‌اندازی اولیه ثبت شده؛ اکنون دریافت پیام روی آیفون را تنظیم کنید.</p></header>
  <div className="card setup-card space-y-4"><StepIntro title="اتصال پیامک" text="حساب‌های شما آماده‌اند. با اتصال آیفون، پیام‌های جدید به صندوق توازن می‌رسند؛ ثبت هر تراکنش با تأیید شما انجام می‌شود." />
   <div className="sms-flow"><span>۱ · بانک و کارت</span><span>۲ · ساخت کلید</span><span>۳ · تنظیم آیفون</span><span>۴ · تأیید پیام‌ها</span></div>
   <p className="expense-note">این مرحله اختیاری است. موجودی اولیه را دوباره وارد نکنید؛ بعداً هم می‌توانید از بخش تراکنش‌ها اتصال را تنظیم کنید.</p>
   <details className="sms-guide"><summary>روی چه دستگاه‌هایی کار می‌کند؟</summary><p className="mt-3 muted text-sm leading-6">آیفون: دریافت پیام را با راهنمای پایین، در Shortcuts تنظیم کنید. وب و PWA: با همین حساب وارد شوید تا پیام‌های فرستاده‌شده از آیفون را ببینید. مرورگر خودش پیامک نمی‌خواند. دریافت خودکار در اندروید هنوز آماده نیست.</p></details>
  </div>
  <BankIdentifiers accounts={moneyAccounts} identifiers={identifiers} />
  <IphoneSmsConnection endpoint={endpoint} connections={connections.map((c) => ({ ...c, createdAt: c.createdAt.toISOString(), lastReceivedAt: c.lastReceivedAt?.toISOString() ?? null }))} />
  <div className="card setup-card space-y-3"><p className="text-sm">قدم چهارم · بعد از تنظیم آیفون، اولین پیام را در صندوق توازن بررسی کنید. ساخت کلید به‌تنهایی اتصال را فعال نمی‌کند؛ تا پیام نرسد و شما آن را تأیید نکنید، موجودی تغییر نمی‌کند.</p><div className="flex flex-wrap gap-3"><Link href="/transactions/import" className="btn btn-primary">رفتن به صندوق و بررسی اولین پیام</Link><Link href="/" className="btn btn-ghost">فعلاً رد می‌کنم؛ ورود به توازن</Link></div></div>
 </div>;
}
