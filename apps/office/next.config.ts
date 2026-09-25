import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@thc/ui', '@thc/domain', '@thc/db', '@thc/notifications', '@thc/pdf'],
  // §11.3's PDFs are drawn by @react-pdf/renderer in the /api/documents route
  // handlers. It ships its own reconciler, fonts and pdfkit, and must be
  // required from node_modules at runtime rather than bundled.
  serverExternalPackages: ['@react-pdf/renderer'],
  // The gov.uk check (ADR-0025) launches @sparticuz/chromium, whose
  // compressed browser is read from its bin/ folder at runtime rather than
  // imported, so file tracing cannot see it. Named here so Vercel ships it
  // with that one route and no other. (playwright-core and
  // @sparticuz/chromium are already on Next's built-in external list.)
  outputFileTracingIncludes: {
    '/api/jobs/rtw-check': ['./node_modules/@sparticuz/chromium/bin/**'],
  },
  env: { APP_TZ: process.env.APP_TZ ?? 'Europe/London' },
};

export default nextConfig;
