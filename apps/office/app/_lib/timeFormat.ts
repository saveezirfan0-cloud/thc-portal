import { cache } from 'react';
import { cookies } from 'next/headers';
import type { TimeFormat } from '@thc/domain';
import { type TimeFormatChoice, readTimeFormat } from '@thc/db/time-format';

/**
 * The clock this operator reads times on (ADR-0085), read once per request.
 *
 * The root layout hands `format` + `remember` to `TimeFormatProvider`, and a
 * server page or view-model that WRITES a time (a window label, a stamp)
 * calls `currentTimeFormat()` and gets the same answer without a second
 * lookup, the way `officeUser()` is shared. Client components do not call
 * this: a `next/headers` import in their graph fails the build (seven screens
 * render the shell from a client component), so they use `useTimeFormat()`
 * from @thc/ui, and a server page that feeds one passes the format as a prop.
 */
export const timeFormatChoice = cache(async (): Promise<TimeFormatChoice> => {
  return readTimeFormat(await cookies());
});

export async function currentTimeFormat(): Promise<TimeFormat> {
  return (await timeFormatChoice()).format;
}
