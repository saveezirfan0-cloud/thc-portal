import type { Metadata, Viewport } from 'next';
import { AppearanceScript, THEME_COLOR } from '@thc/ui';
import '@thc/ui/styles.css';

export const metadata: Metadata = {
  title: 'THC Client Portal',
  description: 'The Hospitality Company — Client Portal',
  // A private portal: nothing in it is for a search engine, the sign-in card
  // included. app/robots.ts says the same to crawlers that ask first, and
  // next.config.ts sends X-Robots-Tag on every response, files included.
  robots: { index: false, follow: false },
  // app/manifest.ts serves this; named here as well so the link is explicit
  // rather than a side effect of a file's existence (ADR-0052).
  manifest: '/manifest.webmanifest',
  applicationName: 'THC Clients',
  // iOS ignores the manifest's display mode and icons on "Add to Home
  // Screen" and reads these instead. `default`, not `black-translucent`:
  // the portal's sticky top bar (.ctop) does not pad for
  // env(safe-area-inset-top), so a translucent status bar would sit on top
  // of the brand and the account menu (ADR-0052 §4).
  appleWebApp: { capable: true, title: 'THC Clients', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The two grounds of packages/ui tokens.css, from THEME_COLOR: light
  // `--bg` (cream) and the warm-style dark `--bg` (navy). The dark value is the manifest's
  // `theme_color`; a browser that finds the two disagreeing paints the
  // installed app's title bar one colour and the splash another. This pair
  // follows the OS setting; packages/ui's syncThemeColor puts a media-less
  // theme-color first in <head> that follows the in-app switch (ADR-0052 §3).
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" data-style="warm" suppressHydrationWarning>
      <head>
        <AppearanceScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
