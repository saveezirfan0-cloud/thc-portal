import type { ReactNode } from 'react';
import { TimeFormatProvider } from '@thc/ui';
import { timeFormatChoice } from '../_lib/timeFormat';

/**
 * ADR-0085: every screen under /profile writes times on the worker's clock —
 * Earnings history, Availability and its time fields — and none of them goes
 * through `StaffShell` (`ProfileShell` is their chrome). The provider lives
 * here rather than in `ProfileShell` so that chrome stays a plain, synchronous
 * component, and the choice is read once for the whole section.
 */
export default async function Layout({ children }: { children: ReactNode }) {
  const { format, remember } = await timeFormatChoice();
  return (
    <TimeFormatProvider format={format} remember={remember}>
      {children}
    </TimeFormatProvider>
  );
}
