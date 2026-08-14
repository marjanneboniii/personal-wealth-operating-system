import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Shell from "@/components/layout/Shell";
import { getCurrentUser } from "@/lib/auth";
import { resolveHomeMode } from "@/lib/publicEntry";

export const metadata: Metadata = {
  title: {
    default: "تراز — سیستم‌عامل ثروت شخصی",
    template: "%s — تراز",
  },
  description:
    "درآمد، هزینه، دارایی، بدهی، سرمایه‌گذاری، بودجه و جریان نقدی خود را در یک سیستم منسجم مدیریت کنید — بفهمید پول‌تان کجا می‌رود و واقعاً چقدر ثروت دارید.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "تراز — تمام ثروت، درآمد و هزینه‌هایتان در یک نگاه",
    description:
      "سیستم‌عامل ثروت شخصی: از هر تراکنش تا تصویر کامل ثروت. دارایی‌ها، بدهی‌ها، جریان نقدی و ارزش خالص در یک سیستم یکپارچه.",
    locale: "fa_IR",
    type: "website",
    siteName: "تراز",
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

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "تراز",
  alternateName: "Taraz",
  description:
    "سیستم‌عامل ثروت شخصی: درآمد، هزینه، دارایی، بدهی، سرمایه‌گذاری، بودجه و جریان نقدی در یک سیستم منسجم — مبتنی بر حسابداری دوطرفه و دفترکل قابل بررسی.",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web, PWA",
  inLanguage: "fa-IR",
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

const themeScript = `(function(){try{var t=localStorage.getItem('pwos-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}}());document.documentElement.classList.add('js');`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Keep the account affordance visible in the shell without exposing any
  // credential fields to the client. Auth remains enforced by each protected
  // server component through ensureAuth().
  let authUser: { name: string; username: string | null; email: string | null; role: string } | null = null;
  let publicHome = false;
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
    publicHome = (await resolveHomeMode(user)) === "landing";
  } catch {
    // Fail-open to public chrome so a broken session never paints app nav
    // over the marketing landing. Protected pages still fail closed.
    publicHome = true;
  }

  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        {/* Self-hosted Vazirmatn — preload the weights used above the fold */}
        <link rel="preload" href="/fonts/Vazirmatn-Regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/Vazirmatn-Bold.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:right-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:px-3 focus:py-2 focus:text-[13px]"
          style={{ background: "var(--brand)", color: "var(--on-brand)" }}
        >
          پرش به محتوای اصلی
        </a>
        <Shell authUser={authUser} publicHome={publicHome}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
