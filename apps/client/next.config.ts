import type { NextConfig } from 'next';
import { securityHeaderRules } from '@thc/db/security-headers';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Framing, sniffing, referrer, permissions, HSTS (packages/db/src/security-headers.ts).
  headers: async () => securityHeaderRules('client'),
  transpilePackages: ['@thc/ui', '@thc/domain', '@thc/db', '@thc/notifications'],
  env: {
    APP_TZ: process.env.APP_TZ ?? 'Europe/London',
    // The Client Portal has no browser Supabase client (no
    // `@thc/db/browser` import anywhere in apps/client), so its auth cookies
    // are written httpOnly: a script injected into a page cannot read the
    // session. Read by the server client (packages/db/src/server.ts); the
    // middleware sets the same flag on its token refresh (ADR-0120).
    THC_AUTH_COOKIE_HTTP_ONLY: '1',
  },
};

export default nextConfig;
