import type { NextConfig } from 'next';
import { securityHeaderRules } from '@thc/db/security-headers';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Framing, sniffing, referrer, permissions, HSTS (packages/db/src/security-headers.ts).
  headers: async () => securityHeaderRules('client'),
  transpilePackages: ['@thc/ui', '@thc/domain', '@thc/db', '@thc/notifications'],
  env: { APP_TZ: process.env.APP_TZ ?? 'Europe/London' },
};

export default nextConfig;
