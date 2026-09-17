import Link from "next/link";
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
  <header className="space-y-3"><p className="muted text-sm">راه‌اندازی توازن · مرحلهٔ ۹ از ۹</p><h1 className="text-[length:var(--fs-xl)] font-bold">اتصال پیامک بانکی</h1>
   <p className="text-sm">حساب‌ها و موجودی اولیهٔ شما ثبت شدند. حالا می‌توانید دریافت پیامک‌های جدید را تنظیم کنید؛ موجودی افتتاحیه را دوباره وارد نکنید. این مرحله اختیاری است و بعداً هم از بخش تراکنش‌ها در دسترس خواهد بود.</p>
  </header>
  <div className="card space-y-3 text-sm"><h2 className="font-semibold">قدم‌به‌قدم برای آیفون</h2><ol className="list-decimal space-y-2 ps-5"><li>در بخش اول، بانک و رقم‌های پایانی کارت یا حساب را به حساب خود در توازن وصل کنید. برای کارت‌های دیگر تکرار کنید.</li><li>در بخش دوم، رضایت ارسال پیامک را انتخاب و کلید اتصال آیفون را بسازید.</li><li>با راهنمای همان بخش، اتوماسیون دریافت پیام را در Shortcuts آیفون تنظیم کنید. توازن نمی‌تواند آن را به‌جای شما روی گوشی فعال کند.</li><li>پس از رسیدن پیام جدید، به صندوق بازبینی بروید، نوع و دسته را انتخاب کنید و ثبت نهایی را تأیید کنید.</li></ol>
   <p>در وب و PWA، پیامک مستقیم از مرورگر خوانده نمی‌شود؛ صندوق پیام‌های ارسال‌شده از آیفون در هر دو مشترک است. دریافت خودکار پیامک اندروید در این نسخه پیاده‌سازی نشده است.</p>
  </div>
  <BankIdentifiers accounts={moneyAccounts} identifiers={identifiers} />
  <IphoneSmsConnection endpoint={endpoint} connections={connections.map((c) => ({ ...c, createdAt: c.createdAt.toISOString(), lastReceivedAt: c.lastReceivedAt?.toISOString() ?? null }))} />
  <div className="card space-y-3"><p className="text-sm">ساخت کلید به معنی فعال‌شدن اتوماسیون نیست؛ تنظیم روی آیفون و رسیدن اولین پیام را بررسی کنید. دریافت پیام به‌تنهایی موجودی یا گزارش‌ها را تغییر نمی‌دهد.</p><div className="flex flex-wrap gap-3"><Link href="/transactions/import" className="btn btn-primary">رفتن به صندوق و بررسی اولین پیام</Link><Link href="/" className="btn btn-ghost">فعلاً رد می‌کنم؛ ورود به توازن</Link></div></div>
 </div>;
}
