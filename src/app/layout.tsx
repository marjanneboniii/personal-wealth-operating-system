import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Shell from "@/components/layout/Shell";
import { ProModeProvider } from "@/components/layout/ProModeProvider";
import { getCurrentUser } from "@/lib/auth";
import { getUserProMode } from "@/features/preferences/service";
import { resolveHomeMode } from "@/lib/publicEntry";

export const metadata: Metadata = {
  title: {
    default: "توازن — سیستم‌عامل ثروت شخصی",
    template: "%s — توازن",
  },
  description: "سیستم‌عامل ثروت شخصی — ارزش خالص، دارایی‌ها، بدهی‌ها و نقدینگی را در یک نمای روشن ببینید.",
  openGraph: {
    title: "توازن — تمام ثروت شما، یک تصویر روشن",
    description: "سیستم‌عامل ثروت شخصی: ارزش خالص، دارایی‌ها، بدهی‌ها و نقدینگی در یک نمای روشن.",
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
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "توازن" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F7FB" },
    { media: "(prefers-color-scheme: dark)", color: "#12131C" },
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
  let publicHome = false;
  let proMode = false;
  try {
    const user = await getCurrentUser();
    if (user) {
      authUser = {
        name: user.name,
        username: (user as any).username ?? null,
        email: (user as any).email ?? null,
        role: user.role,
      };
      // Per-user UI vocabulary preference — resolved server-side per request
      // (Directive §2). Fails safe to the SIMPLE view for anonymous users.
      proMode = await getUserProMode((user as { id?: string }).id);
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
      </head>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:right-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:px-3 focus:py-2 focus:text-[13px]"
          style={{ background: "var(--color-accent)", color: "var(--color-primary)" }}
        >
          پرش به محتوای اصلی
        </a>
        <ProModeProvider pro={proMode}>
          <Shell authUser={authUser} publicHome={publicHome}>
            {children}
          </Shell>
        </ProModeProvider>
      </body>
    </html>
  );
}
