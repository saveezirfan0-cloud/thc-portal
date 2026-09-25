import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@thc/ui', '@thc/domain', '@thc/db', '@thc/notifications', '@thc/pdf'],
  // §11.3's PDFs are drawn by @react-pdf/renderer in the /api/documents route
  // handlers. It ships its own reconciler, fonts and pdfkit, and must be
  // required from node_modules at runtime rather than bundled.
  serverExternalPackages: ['@react-pdf/renderer', 'playwright-core', '@sparticuz/chromium'],
  // The gov.uk fallback of the right-to-work check (ADR-0025) drives a
  // serverless Chromium. @sparticuz/chromium unpacks its browser from these
  // brotli files at runtime, which file tracing cannot see, so the job route
  // is told to ship them. Confirm on the first Vercel deploy (ADR-0025).
  //
  // Only pnpm's real path, which is what the package resolves `bin/` against.
  // The symlinked `./node_modules/@sparticuz/chromium/bin/**` was listed too
  // and traced as a second 67 MB copy of the browser (148 MB function).
  outputFileTracingIncludes: {
    '/api/jobs/rtw-check': [
      '../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**',
    ],
  },
  env: { APP_TZ: process.env.APP_TZ ?? 'Europe/London' },
};

export default nextConfig;
