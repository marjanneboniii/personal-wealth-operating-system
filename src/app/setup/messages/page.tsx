import Link from "next/link";
import Icon from "@/components/ui/Icon";
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
  <header className="space-y-3"><div className="flex items-baseline justify-between gap-3"><h1 className="text-[length:var(--fs-xl)] font-bold tracking-tight">راه‌اندازی توازن</h1><span className="muted num text-[length:var(--fs-xs)]">۹ از ۹</span></div>
   <ol className="setup-steps" aria-label="مراحل راه‌اندازی">{["شروع", "حساب‌ها", "رمزارز و طلا", "صندوق و سهام", "ملک", "خودرو", "بدهی‌ها", "تأیید", "اتصال پیامک"].map((label, index) => <li key={label} className={`setup-step ${index === 8 ? "is-current" : "is-done"}`}><button type="button" disabled aria-current={index === 8 ? "step" : undefined}><span className="setup-step-dot">{index === 8 ? "۹" : <Icon name="check" size={12} />}</span><span className="setup-step-label">{label}</span></button></li>)}</ol>
  </header>
  <div className="card setup-card space-y-4"><StepIntro title="اتصال پیامک" text="حساب‌های شما آماده‌اند. با اتصال آیفون، پیام‌های جدید به صندوق توازن می‌رسند؛ ثبت هر تراکنش با تأیید شما انجام می‌شود." />
   <div className="sms-flow"><span>۱ · بانک و کارت</span><span>۲ · اتصال آیفون</span><span>۳ · بررسی پیام‌ها</span></div>
   <p className="expense-note">این مرحله اختیاری است. موجودی اولیه را دوباره وارد نکنید؛ بعداً هم می‌توانید از بخش تراکنش‌ها اتصال را تنظیم کنید.</p>
   <details className="sms-guide"><summary>روی چه دستگاه‌هایی کار می‌کند؟</summary><p className="mt-3 muted text-sm leading-6">اتوماسیون پیام در Shortcuts آیفون را یک‌بار خودتان تنظیم می‌کنید. پیام‌های ارسال‌شده در وب و PWA هم دیده می‌شوند؛ مرورگر مستقیماً پیامک نمی‌خواند. دریافت خودکار پیامک اندروید هنوز در این نسخه آماده نیست.</p></details>
  </div>
  <BankIdentifiers accounts={moneyAccounts} identifiers={identifiers} />
  <IphoneSmsConnection endpoint={endpoint} connections={connections.map((c) => ({ ...c, createdAt: c.createdAt.toISOString(), lastReceivedAt: c.lastReceivedAt?.toISOString() ?? null }))} />
  <div className="card setup-card space-y-3"><p className="text-sm">ساخت کلید به معنی فعال‌شدن اتوماسیون نیست؛ تنظیم روی آیفون و رسیدن اولین پیام را بررسی کنید. دریافت پیام به‌تنهایی موجودی یا گزارش‌ها را تغییر نمی‌دهد.</p><div className="flex flex-wrap gap-3"><Link href="/transactions/import" className="btn btn-primary">رفتن به صندوق و بررسی اولین پیام</Link><Link href="/" className="btn btn-ghost">فعلاً رد می‌کنم؛ ورود به توازن</Link></div></div>
 </div>;
}
