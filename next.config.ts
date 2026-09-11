import type { NextConfig } from "next";

/**
 * SECURITY (L-01): HTTP security headers.
 *
 * Applied to every response. Framing protections (X-Frame-Options /
 * CSP frame-ancestors) and HSTS are PRODUCTION-only:
 *  - in development the app is often embedded (dev tooling / preview
 *    sandboxes render it inside an iframe), so framing must stay allowed;
 *  - HSTS must never leak onto http://localhost or a preview origin.
 *
 * CSP notes:
 *  - script/style 'unsafe-inline' is required by the inline theme bootstrap
 *    in app/layout.tsx (dangerouslySetInnerHTML) and Next inline payloads;
 *  - authentication is handled by Supabase; only its HTTPS API endpoint is
 *    reachable from browser code. OAuth provider pages are top-level redirects.
 */
const isProd = process.env.NODE_ENV === "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  // CoinGecko catalog logos are public identity metadata; API calls and keys
  // remain server-side. Only documented image hosts are allowlisted.
  //
  // api.wallex.ir is here because the Wallex provider's catalogue returns
  // `baseAsset_svg_icon` URLs on that host. Nothing renders them yet — but the
  // moment a picker does, CSP would block them SILENTLY, with no error the
  // developer would connect to this file. Allowlisting it with the code that
  // produces the URLs is cheaper than debugging invisible images later. It is
  // also the better host for this audience: an Iranian origin rather than a
  // CDN that is slow or unreachable from Iran.
  "img-src 'self' data: blob: https://assets.coingecko.com https://coin-images.coingecko.com https://api.wallex.ir",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  ...(isProd ? ["frame-ancestors 'self'"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isProd
    ? [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      ]
    : []),
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Preview sandboxes serve the dev server through proxied origins.
  allowedDevOrigins: ["*.e2b.app"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
