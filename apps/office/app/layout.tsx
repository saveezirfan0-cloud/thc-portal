import type { Metadata, Viewport } from 'next';
import { AppearanceScript } from '@thc/ui';
import { ChromeProvider } from './_components/ChromeContext';
import { loadChrome } from './_components/chrome';
import '@thc/ui/styles.css';

export const metadata: Metadata = {
  title: 'THC Back Office',
  description: 'The Hospitality Company — Back Office Portal',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/**
 * The one place the chrome's own data is read (§4.1's menu counter, the
 * sidebar foot's operator): every screen renders `OfficeShell` under this
 * layout, so one read here reaches the badge on all of them. The cookie
 * read makes the tree dynamic, which it is already — the middleware gates
 * every route on a session and the screens query as the signed-in manager.
 * Outside a session (`/login`) it costs nothing: no claims, no query.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const chrome = await loadChrome();
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <AppearanceScript />
      </head>
      <body>
        <ChromeProvider value={chrome}>{children}</ChromeProvider>
      </body>
    </html>
  );
}
