import { cookies } from 'next/headers';
import { DEFAULT_TIME_FORMAT, TIME_FORMAT_COOKIE, isTimeFormat } from '@thc/domain';
import type { TimeFormat } from '@thc/domain';
import { staffDb } from '../../db';

/**
 * What the Preferences form starts on (ADR-0085).
 *
 * The PROFILE is the truth, so it is asked first (`my_time_format()`, the
 * worker's own row through their session): a new phone, or a change made on
 * another device, shows the right choice here even where this device's
 * cookie is missing or stale. The cookie is the fallback when the read
 * fails, then the default. `cookie` comes back too, so the page can heal a
 * stale one.
 */
export async function loadSavedTimeFormat(): Promise<{
  format: TimeFormat;
  cookie: TimeFormat | null;
}> {
  const store = await cookies();
  const raw = store.get(TIME_FORMAT_COOKIE)?.value;
  const cookie = isTimeFormat(raw) ? raw : null;
  try {
    const { data, error } = await staffDb(store).rpc('my_time_format');
    if (!error && isTimeFormat(data)) return { format: data, cookie };
  } catch {
    /* fall through to the cookie: a clock preference is not worth a failed page */
  }
  return { format: cookie ?? DEFAULT_TIME_FORMAT, cookie };
}
