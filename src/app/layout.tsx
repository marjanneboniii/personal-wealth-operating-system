import type { Metadata, Viewport } from "next";
import { DISPLAY_BOOT_SCRIPT } from "@/lib/displayPrefs";
import type { ReactNode } from "react";
import "./globals.css";
import Shell from "@/components/layout/Shell";
import { ProModeProvider } from "@/components/layout/ProModeProvider";
import { getCurrentUser } from "@/lib/auth";
import { getUserProMode, hasSeenTour } from "@/features/preferences/service";
import { getSetupState } from "@/features/setup/service";
import { resolveHomeMode } from "@/lib/publicEntry";

export const metadata: Metadata = {
  title: {
    default: "توازن — پول و دارایی‌های شما، یک‌جا",
    template: "%s — توازن",
  },
  description: "ببینید چه دارید، چقدر بدهکارید و چقدر پول در دسترستان است — همه در یک صفحه.",
  openGraph: {
    title: "توازن — تمام ثروت شما، یک تصویر روشن",
    description: "ببینید چه دارید، چقدر بدهکارید و چقدر پول در دسترستان است — همه در یک صفحه.",
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
    { media: "(prefers-color-scheme: light)", color: "#edf0f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1726" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

// Theme and privacy mode before first paint — see src/lib/displayPrefs.ts.
const themeScript = DISPLAY_BOOT_SCRIPT;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Keep the account affordance visible in the shell without exposing any
  // credential fields to the client. Auth remains enforced by each protected
  // server component through ensureAuth().
  let authUser: { name: string; username: string | null; email: string | null; role: string } | null = null;
  let publicHome = false;
  let proMode = false;
  let showTour = false;
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
      // The first-run tour: after setup, until finished or skipped (per account).
      const uid = (user as { id?: string }).id;
      if (uid && !(await hasSeenTour(uid))) showTour = (await getSetupState(uid)).completed;
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
        {/*
          Fonts are self-hosted (no Google Fonts — that host is unreliable from
          Iran) but they were still discovered only AFTER the stylesheet had
          been fetched and parsed, which on a high-latency link costs a whole
          extra round trip before any Persian text is drawn in the real face.
          Preloading the two weights that every first paint needs — body 400 and
          headings/wordmark 700 — starts them in parallel with the CSS. The
          other two weights stay lazy; they are not on the critical path.
        */}
        <link
          rel="preload"
          href="/fonts/Vazirmatn-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/Vazirmatn-Bold.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:right-3 focus:top-3 focus:z-[100] focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-lg focus:px-4 focus:py-3 focus:text-[length:var(--fs-sm)]"
          style={{ background: "var(--action)", color: "var(--on-ink)" }}
        >
          پرش به محتوای اصلی
        </a>
        <ProModeProvider pro={proMode}>
          <Shell authUser={authUser} publicHome={publicHome} showTour={showTour}>
            {children}
          </Shell>
        </ProModeProvider>
      </body>
    </html>
  );
}
