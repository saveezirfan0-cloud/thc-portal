import type { Metadata, Viewport } from 'next';
import { AppearanceScript } from '@thc/ui';
import '@thc/ui/styles.css';

export const metadata: Metadata = {
  title: 'THC Client Portal',
  description: 'The Hospitality Company — Client Portal',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

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
