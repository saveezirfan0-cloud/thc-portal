import type { Metadata, Viewport } from 'next';
import { AppearanceScript } from '@thc/ui';
import { SignedInAsProvider } from './_components/SignedInAs';
import { officeUser } from './_components/officeUser';
import '@thc/ui/styles.css';

export const metadata: Metadata = {
  title: 'THC Back Office',
  description: 'The Hospitality Company — Back Office Portal',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/**
 * Read once here, not per screen: the sidebar foot names the signed-in
 * operator on every Back Office page, and seven of them render the shell
 * from a client component that cannot do this lookup itself.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await officeUser();

  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <AppearanceScript />
      </head>
      <body>
        <SignedInAsProvider user={user}>{children}</SignedInAsProvider>
      </body>
    </html>
  );
}
