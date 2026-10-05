import { cache } from 'react';
import { cookies } from 'next/headers';
import { DEFAULT_TIME_FORMAT } from '@thc/domain';
import type { TimeFormat } from '@thc/domain';
import { readTimeFormat } from '@thc/db/time-format';
import type { TimeFormatChoice } from '@thc/db/time-format';
import { supabaseConfigured } from '../db';

/**
 * The clock this worker reads times on (ADR-0085), read once per request.
 *
 * `StaffShell` hands the choice to `TimeFormatProvider` for the client
 * components; a server page that writes a time itself (a list card's
 * "Cancel available until", an offer's close) asks here instead. `cache`
 * means the shell and every page in one render share a single read, and the
 * cookie makes that read free after the first request on a device.
 *
 * Never throws: with no project configured, or a lookup that fails, it is
 * the 24-hour default — a clock preference is not worth a failed page.
 */
export const timeFormatChoice = cache(async (): Promise<TimeFormatChoice> => {
  if (!supabaseConfigured()) return { format: DEFAULT_TIME_FORMAT, remember: false };
  return readTimeFormat(await cookies());
});

export async function getTimeFormat(): Promise<TimeFormat> {
  return (await timeFormatChoice()).format;
}
