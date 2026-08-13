import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Shell from "@/components/layout/Shell";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: {
    default: "تراز — سیستم‌عامل ثروت شخصی",
    template: "%s — تراز",
  },
  description: "هسته مالی خصوصی برای مدیریت بلندمدت ثروت، سرمایه‌گذاری، بدهی و برنامه‌های آینده — مبتنی بر حسابداری دوطرفه و دفترکل تغییرناپذیر.",
  openGraph: {
    title: "تراز — تمام ثروت شما، یک تصویر روشن",
    description: "سیستم خصوصی مدیریت ثروت شخصی: دارایی‌ها، نقدینگی، تراکنش‌ها و ارزش خالص در یک نگاه.",
    locale: "fa_IR",
    type: "website",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "تراز" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0e12" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

const themeScript = `(function(){try{var t=localStorage.getItem('pwos-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Keep the account affordance visible in the shell without exposing any
  // credential fields to the client. Auth remains enforced by each protected
  // server component through ensureAuth().
  let authUser: { name: string; username: string | null; email: string | null; role: string } | null = null;
  try {
    const user = await getCurrentUser();
    if (user) {
      authUser = {
        name: user.name,
        username: (user as any).username ?? null,
        email: (user as any).email ?? null,
        role: user.role,
      };
    }
  } catch {
    // A protected page will surface the fail-closed auth/database error.
  }

  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:right-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:px-3 focus:py-2 focus:text-[13px]"
          style={{ background: "var(--brand)", color: "var(--on-brand)" }}
        >
          پرش به محتوای اصلی
        </a>
        <Shell authUser={authUser}>{children}</Shell>
      </body>
    </html>
  );
}
