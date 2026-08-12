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
 *  - accounts.google.com sources cover the Google Identity Services button.
 */
const isProd = process.env.NODE_ENV === "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  // CoinGecko catalog logos are public identity metadata; API calls and keys
  // remain server-side. Only the two documented image CDNs are allowlisted.
  "img-src 'self' data: blob: https://assets.coingecko.com https://coin-images.coingecko.com",
  "font-src 'self' data:",
  "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com",
  "frame-src https://accounts.google.com",
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
