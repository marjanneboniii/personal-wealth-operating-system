import Link from "next/link";
import StepIntro from "@/components/setup/StepIntro";
import { redirect } from "next/navigation";
import { ensureAuth } from "@/lib/authGuard";
import { getSetupState } from "@/features/setup/service";
import { listBankIdentifiers, listSmsBankAccounts } from "@/features/bankImport/identifiers";
import SmsProgress from "@/components/transactions/SmsProgress";
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
  listSmsBankAccounts(user.id),
  listBankIdentifiers(user.id),
  listSmsConnections(user.id),
 ]);
 let endpoint: string | null = null;
 try { const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || ""); if (url.protocol === "https:") endpoint = new URL("/api/bank-messages", url.origin).href; } catch {}
 return <div className="mx-auto max-w-2xl space-y-5 py-4">
  <header className="space-y-3"><h1 className="text-[length:var(--fs-xl)] font-bold tracking-tight">تکمیل اتصال پیامک</h1><p className="muted text-sm">راه‌اندازی اولیه ثبت شده؛ اکنون دریافت پیام روی آیفون را تنظیم کنید.</p></header>
  <div className="card setup-card space-y-4"><StepIntro title="اتصال پیامک" text="پیامک‌های بانک خودشان به تراکنش پیشنهادی تبدیل می‌شوند؛ شما فقط بررسی و تأیید می‌کنید. این مرحله اختیاری است و بعداً هم از «تراکنش‌ها» در دسترس است." />
   <SmsProgress cards={identifiers.length} iphones={connections.length} waiting={0} />
   <details className="sms-guide"><summary>روی چه دستگاه‌هایی کار می‌کند؟</summary><p className="mt-3 muted text-sm leading-6">ارسال پیامک فقط از آیفون (برنامهٔ Shortcuts). دیدن و تأیید پیام‌ها در وب و نسخهٔ نصبی (PWA) با همین حساب. اندروید هنوز پشتیبانی نمی‌شود.</p></details>
  </div>
  <BankIdentifiers accounts={moneyAccounts} identifiers={identifiers} />
  <IphoneSmsConnection endpoint={endpoint} connections={connections.map((c) => ({ ...c, createdAt: c.createdAt.toISOString(), lastReceivedAt: c.lastReceivedAt?.toISOString() ?? null }))} />
  <div className="card setup-card space-y-3"><p className="text-sm leading-7">۳ · بعد از تنظیم آیفون، اولین پیامک بانکی تازه در صندوق توازن می‌نشیند. تا تأییدش نکنید، موجودی تغییر نمی‌کند.</p><div className="flex flex-wrap gap-3"><Link href="/transactions/import#sms-inbox" className="btn btn-primary">رفتن به صندوق پیام‌ها</Link><Link href="/" className="btn btn-ghost">فعلاً رد می‌کنم؛ ورود به توازن</Link></div></div>
 </div>;
}
