'use client';

import { AppearanceScript } from '@thc/ui';
import '@thc/ui/styles.css';
import RouteError from './error';

/**
 * The last-resort boundary (Next.js `global-error.tsx`): an error in the
 * root layout itself, which `error.tsx` cannot catch because it renders
 * inside that layout. It replaces the layout, so it brings its own `<html>`
 * and `<body>`, the design system's stylesheet and the appearance script —
 * and then the same branded card `error.tsx` draws: never the exception's
 * text, the digest to quote, the office address, "Try again".
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-GB" data-style="warm" suppressHydrationWarning>
      <head>
        <title>Something went wrong · THC Client Portal</title>
        <meta name="robots" content="noindex, nofollow" />
        <AppearanceScript />
      </head>
      <body>
        <RouteError error={error} reset={reset} />
      </body>
    </html>
  );
}
