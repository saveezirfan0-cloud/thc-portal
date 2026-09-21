import type { Metadata, Viewport } from 'next';
import { AppearanceScript } from '@thc/ui';
import '@thc/ui/styles.css';

export const metadata: Metadata = {
  title: 'THC Back Office',
  description: 'The Hospitality Company — Back Office Portal',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

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
