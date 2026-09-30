import type { NextConfig } from 'next';

const PDFKIT_FILES = [
  '../../node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/standard-fonts/**',
  '../../node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/data/**',
];

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
  //
  // The same for pdfkit under @react-pdf/renderer: it loads each standard font
  // through the package's `#standard-fonts/*` subpath import, which file
  // tracing does not follow, so on Vercel every PDF failed with "Cannot find
  // module …/pdfkit/js/standard-fonts/Helvetica.cjs" (the event-documents job
  // gave up on the first event after eight tries, ADR-0074). About 0.8 MB.
  outputFileTracingIncludes: {
    '/api/jobs/rtw-check': [
      '../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**',
    ],
    '/api/jobs/event-documents': PDFKIT_FILES,
    '/api/documents/**': PDFKIT_FILES,
  },
  env: { APP_TZ: process.env.APP_TZ ?? 'Europe/London' },
};

export default nextConfig;
