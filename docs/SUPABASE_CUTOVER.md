# راهنمای مهاجرت امن به Supabase

این پروژه از Supabase برای Auth و PostgreSQL/RLS استفاده می‌کند. Drizzle فقط لایهٔ دسترسی سرور به همان PostgreSQL است؛ کلاینت مرورگر برای داده‌های مالی مستقیماً از secret key استفاده نمی‌کند. Redis پایگاه دادهٔ مالی نیست و فقط شمارندهٔ کوتاه‌عمر rate limit مشترک میان instanceهای Vercel را نگه می‌دارد.

## ۱. ساخت پروژه و کلیدها

1. در Supabase یک پروژهٔ production جدید بسازید و رمز دیتابیس را در password manager ذخیره کنید.
2. از **Project Settings → Connect** دو URL بگیرید:
   - Transaction pooler برای `DATABASE_URL` در Vercel.
   - Direct connection یا Session pooler برای `MIGRATION_DATABASE_URL` روی دستگاه اپراتور.
3. از **Project Settings → API Keys** مقدارهای زیر را بگیرید:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Secret key → `SUPABASE_SECRET_KEY` (فقط سرور)
4. `PWOS_BOOTSTRAP_OWNER_EMAIL` را برابر ایمیل خودتان و `NEXT_PUBLIC_SITE_URL` را برابر `https://tavazon.vercel.app` قرار دهید.

تنها `NEXT_PUBLIC_SUPABASE_URL` و `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` عمومی‌اند. `DATABASE_URL`، `MIGRATION_DATABASE_URL`، `SUPABASE_SECRET_KEY`، `REDIS_URL` و `FIELD_ENCRYPTION_KEY` نباید در Git، خروجی build یا مرورگر ظاهر شوند.

## ۲. Auth، Google و ضدربات

1. در **Authentication → URL Configuration**:
   - Site URL: `https://tavazon.vercel.app`
   - Redirect URL: `https://tavazon.vercel.app/auth/callback`
   - برای preview فقط دامنه‌های دقیق و موردنیاز را اضافه کنید؛ wildcard عمومی نگذارید.
2. تأیید ایمیل را روشن نگه دارید. نقش owner فقط پس از callback تأییدشده و تطبیق با `PWOS_BOOTSTRAP_OWNER_EMAIL` اعطا می‌شود.
3. برای Google، provider را در **Authentication → Providers** فعال و Client ID/Secret گوگل را همان‌جا ثبت کنید؛ این secretها در Vercel لازم نیستند.
4. یک Cloudflare Turnstile widget برای دامنهٔ production بسازید:
   - site key → `NEXT_PUBLIC_TURNSTILE_SITE_KEY` در Vercel
   - secret key → بخش **Authentication → Bot and Abuse Protection** در Supabase، نه Vercel و نه Git
5. پیش از جذب کاربر، SMTP اختصاصی را برای ایمیل تأیید/بازیابی تنظیم و تحویل ایمیل را آزمایش کنید.

## ۳. اسرار و Vercel

در Vercel، متغیرهای زیر را حداقل برای Production و در صورت نیاز Preview تنظیم کنید:

```text
DATABASE_URL
REDIS_URL
FIELD_ENCRYPTION_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
PWOS_BOOTSTRAP_OWNER_EMAIL
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_TURNSTILE_SITE_KEY
APP_MODE=personal
```

`FIELD_ENCRYPTION_KEY` را یک‌بار با `openssl rand -base64 32` بسازید و فقط در secret store نگه دارید. برای Redis می‌توان از یک سرویس سازگار با Redis/Valkey با TLS استفاده کرد. نبود Redis در production عمداً fail-closed است تا rate limit با چند instance قابل دورزدن نباشد.

## ۴. ساخت دیتابیس خالی و RLS

از یک محیط اپراتوری امن، نه در build زمان Vercel:

```bash
MIGRATION_DATABASE_URL='postgresql://…' npm run db:migrate
```

سپس در SQL Editor کنترل کنید:

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Migration شمارهٔ `0017` نشست‌ها و hashهای قدیمی برنامه را بازنشسته می‌کند، پروفایل را به `auth.users` متصل می‌کند، دسترسی `anon` را می‌بندد و policyهای `auth.uid()` را ایجاد می‌کند.

## ۵. آزمون cutover

1. deployment جدید را باز کنید و با ایمیل مالک ثبت‌نام و ایمیل را تأیید کنید.
2. بررسی کنید `/admin` فقط برای owner باز است.
3. یک حساب آزمایشی عادی بسازید و با هر دو حساب چند رکورد متفاوت ثبت کنید.
4. با حساب دوم URL/شناسه رکورد حساب اول را در APIهای خواندن، ویرایش و حذف امتحان کنید؛ پاسخ باید 401/403/404 باشد و داده نباید نمایش داده شود.
5. reset password، logout، Google OAuth، تعلیق/رفع تعلیق کاربر و audit log را آزمایش کنید.
6. در DevTools مرورگر و خروجی build جست‌وجو کنید که secret key، connection string یا کلید رمزنگاری وجود نداشته باشد.
7. health check و backup یک tenant را بگیرید و بازیابی را فقط در محیط staging آزمایش کنید.

## ۶. حذف Neon قدیمی — آخرین مرحله

چون دادهٔ واقعی وجود ندارد، انتقال داده لازم نیست. با این حال حذف برگشت‌ناپذیر است:

1. ابتدا یک export نهایی رمزگذاری‌شده بگیرید و نام Project ID دقیق Neon را ثبت کنید.
2. مطمئن شوید deployment production حداقل ۲۴ ساعت فقط به Supabase متصل بوده و مراحل بخش ۵ سبز است.
3. `DATABASE_URL` قدیمی را از Vercel/لوکال/CI حذف و deployment مجدد انجام دهید.
4. فقط همان پروژه/branch تأییدشدهٔ Neon را از داشبورد Neon حذف کنید.
5. رمز قدیمی را revoke و export موقت را پس از پایان دورهٔ نگهداری امن پاک کنید.

حذف Neon نباید پیش از دسترسی به پروژهٔ Supabase و تأیید deployment انجام شود؛ در غیر این صورت rollback ممکن نیست.
