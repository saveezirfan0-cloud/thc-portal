import type { NextConfig } from 'next';
import { supabaseKeyBuildEnv } from '@thc/db/public-env';
import { securityHeaderRules } from '@thc/db/security-headers';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Framing, sniffing, referrer, permissions, HSTS (packages/db/src/security-headers.ts).
  // Plus X-Robots-Tag: the portal is private, and the header reaches what a
  // page's robots meta cannot (route handlers, redirects, files).
  headers: async () =>
    securityHeaderRules('client').map((rule) => ({
      ...rule,
      headers: [...rule.headers, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    })),
  transpilePackages: ['@thc/ui', '@thc/domain', '@thc/db', '@thc/notifications'],
  env: {
    APP_TZ: process.env.APP_TZ ?? 'Europe/London',
    // The Client Portal has no browser Supabase client (no
    // `@thc/db/browser` import anywhere in apps/client), so its auth cookies
    // are written httpOnly: a script injected into a page cannot read the
    // session. Read by the server client (packages/db/src/server.ts); the
    // middleware sets the same flag on its token refresh (ADR-0120).
    THC_AUTH_COOKIE_HTTP_ONLY: '1',
    // ADR-0165: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, when set, is what every
    // literal process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY reads (packages/db/src/public-env.ts).
    ...supabaseKeyBuildEnv(),
  },
};

export default nextConfig;
