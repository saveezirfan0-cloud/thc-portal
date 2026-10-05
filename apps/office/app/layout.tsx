import type { Metadata, Viewport } from 'next';
import { AppearanceScript, TimeFormatProvider } from '@thc/ui';
import { SignedInAsProvider } from './_components/SignedInAs';
import { officeUser } from './_components/officeUser';
import { NavCountsProvider } from './_components/OfficeSidebar';
import { officeNavCounts } from './_components/navCounts';
import { timeFormatChoice } from './_lib/timeFormat';
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
  // All in one round: the name for the sidebar foot, the menu counters
  // (§4.1) — a HEAD count, no rows — and the clock this operator reads
  // times on (ADR-0085: the cookie, else their profile).
  const [user, counts, clock] = await Promise.all([
    officeUser(),
    officeNavCounts(),
    timeFormatChoice(),
  ]);

  return (
    <html lang="en-GB" data-style="warm" suppressHydrationWarning>
      <head>
        <AppearanceScript />
      </head>
      <body>
        <TimeFormatProvider format={clock.format} remember={clock.remember}>
          <SignedInAsProvider user={user}>
            <NavCountsProvider counts={counts}>{children}</NavCountsProvider>
          </SignedInAsProvider>
        </TimeFormatProvider>
      </body>
    </html>
  );
}
