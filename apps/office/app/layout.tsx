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
  // The clock is a cookie read: nothing to wait for. The operator (name,
  // office role) and the menu counters (§4.1) are database reads, and the
  // page below renders only after this function returns — so they are
  // started here and handed on as PROMISES. The sidebar and the read-only
  // banner resolve them behind their own Suspense (`OfficeShell`), and the
  // page's own queries start at once instead of after these two. A failed
  // lookup is "no name" / "no counters", never a broken page.
  const clock = await timeFormatChoice();
  const user = officeUser().catch(() => null);
  const counts = officeNavCounts();

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
