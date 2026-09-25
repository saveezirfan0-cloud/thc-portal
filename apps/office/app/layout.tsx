import type { Metadata, Viewport } from 'next';
import { AppearanceScript } from '@thc/ui';
import { SignedInAsProvider } from './_components/SignedInAs';
import { officeUser } from './_components/officeUser';
import { NavCountsProvider } from './_components/OfficeSidebar';
import { officeNavCounts } from './_components/navCounts';
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
  // Both in one round: the name for the sidebar foot, and the menu
  // counters (§4.1) — a HEAD count, no rows.
  const [user, counts] = await Promise.all([officeUser(), officeNavCounts()]);

  return (
    <html lang="en-GB" data-style="warm" suppressHydrationWarning>
      <head>
        <AppearanceScript />
      </head>
      <body>
        <SignedInAsProvider user={user}>
          <NavCountsProvider counts={counts}>{children}</NavCountsProvider>
        </SignedInAsProvider>
      </body>
    </html>
  );
}
