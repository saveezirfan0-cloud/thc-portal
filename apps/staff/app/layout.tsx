import type { Metadata, Viewport } from 'next';
import { AppearanceScript } from '@thc/ui';
import '@thc/ui/styles.css';

export const metadata: Metadata = {
  title: 'THC Staff',
  description: 'The Hospitality Company — Staff App',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'THC Staff', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <AppearanceScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
