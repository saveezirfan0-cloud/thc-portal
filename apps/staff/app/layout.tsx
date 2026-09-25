import type { Metadata, Viewport } from 'next';
import { AppearanceScript } from '@thc/ui';
import '@thc/ui/styles.css';
import './tap.css';
import { ServiceWorkerRegistrar } from './_components/ServiceWorkerRegistrar';

export const metadata: Metadata = {
  title: 'THC Staff',
  description: 'The Hospitality Company — Staff App',
  manifest: '/manifest.webmanifest',
  // iOS reads these, not the manifest, when a page is added to the home
  // screen: without them the installed app opens in a browser chrome and
  // never becomes eligible for Web Push (§10.5, iOS 16.4+).
  appleWebApp: { capable: true, title: 'THC Staff', statusBarStyle: 'default' },
  applicationName: 'THC Staff',
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // No maximumScale: WCAG 1.4.4 and the wizard's own "Pinch to zoom" copy
  // both want the page zoomable; iOS stopped honouring the lock anyway.
  viewportFit: 'cover',
  // The same value as `theme_color` in app/manifest.ts. A browser that finds
  // the two disagreeing paints the installed app's status bar one colour and
  // the splash another.
  themeColor: '#04080F',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <AppearanceScript />
      </head>
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
