import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Shell from "@/components/layout/Shell";

export const metadata: Metadata = {
  title: {
    default: "سرمایه‌ی من — سیستم‌عامل ثروت شخصی",
    template: "%s — سرمایه‌ی من",
  },
  description: "هسته مالی خصوصی برای مدیریت بلندمدت ثروت، سرمایه‌گذاری، بدهی و برنامه‌های آینده — مبتنی بر حسابداری دوطرفه و دفترکل تغییرناپذیر.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "سرمایه‌ی من" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0e12" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const themeScript = `(function(){try{var t=localStorage.getItem('pwos-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
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
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
