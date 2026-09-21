import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@thc/ui', '@thc/domain', '@thc/db', '@thc/notifications'],
  env: { APP_TZ: process.env.APP_TZ ?? 'Europe/London' },
};

export default nextConfig;
