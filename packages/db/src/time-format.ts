// A cookie-backed session client belongs to the server (see server.ts).
import 'server-only';
import {
  DEFAULT_TIME_FORMAT,
  TIME_FORMAT_COOKIE,
  TIME_FORMAT_COOKIE_MAX_AGE,
  isTimeFormat,
  parseTimeFormat,
} from '@thc/domain';
import type { TimeFormat } from '@thc/domain';
import { createClient } from './server';
import type { CookieStore } from './server';

/**
 * The clock a login reads times on (ADR-0085): 24-hour unless they chose
 * 12-hour in their settings.
 *
 * Two places hold the choice, for two different jobs:
 *
 *   `profiles.time_format`  the truth. It follows the person to a new phone
 *                           or a new browser. Read and written through
 *                           `my_time_format()` / `set_my_time_format()`.
 *   `thc-time-format`       a first-party cookie, per app host, that every
 *                           server-rendered page reads for free. Without it
 *                           each of ~50 pages would pay a database round
 *                           trip to learn a two-valued preference.
 *
 * Same split as "keep me signed in" (`session.ts`): a device cookie in front
 * of a durable record. The cookie is written when the setting is saved, and
 * HEALED when it is missing: a new device, or the cookie cleared at sign-out
 * so the next person on this phone does not inherit the last one's clock.
 */

export interface TimeFormatChoice {
  format: TimeFormat;
  /**
   * True when the cookie was missing and `format` came from the profile. The
   * page hands it to `TimeFormatProvider`, which writes the cookie from the
   * browser (a server component cannot set one), so the next request is free.
   */
  remember: boolean;
}

interface Reader {
  getAll(): { name: string; value: string }[];
  get(name: string): { value: string } | undefined;
}

/** The two verbs the session client is asked for, without the generated schema. */
interface Rpc {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** Supabase's auth cookie is `sb-<ref>-auth-token`, split into `.0`, `.1` when it is large. */
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export const TIME_FORMAT_COOKIE_OPTIONS = {
  path: '/',
  maxAge: TIME_FORMAT_COOKIE_MAX_AGE,
  sameSite: 'lax',
  secure: process.env['NODE_ENV'] === 'production',
} as const;

/**
 * The cookie if there is one; otherwise, for a signed-in person, their
 * profile; otherwise the default. Never throws: a clock preference is not
 * worth a failed page, so a lookup that errors reads as the default.
 */
export async function readTimeFormat(store: Reader & CookieStore): Promise<TimeFormatChoice> {
  const cookie = store.get(TIME_FORMAT_COOKIE)?.value;
  if (isTimeFormat(cookie)) return { format: cookie, remember: false };

  if (!store.getAll().some((c) => AUTH_COOKIE.test(c.name))) {
    return { format: DEFAULT_TIME_FORMAT, remember: false };
  }
  try {
    const { data, error } = await (createClient(store) as unknown as Rpc).rpc('my_time_format');
    if (error || !isTimeFormat(data)) return { format: DEFAULT_TIME_FORMAT, remember: false };
    return { format: data, remember: true };
  } catch {
    return { format: DEFAULT_TIME_FORMAT, remember: false };
  }
}

export type SaveTimeFormatResult = { ok: true } | { ok: false; message: string };

/** Saves the choice to the profile, then to the cookie. For a server action. */
export async function saveTimeFormat(
  store: Reader & CookieStore,
  value: unknown,
): Promise<SaveTimeFormatResult> {
  if (!isTimeFormat(value)) return { ok: false, message: 'Choose 24-hour or 12-hour.' };
  const { error } = await (createClient(store) as unknown as Rpc).rpc('set_my_time_format', {
    p_format: value,
  });
  if (error) {
    return {
      ok: false,
      message: /not_signed_in/.test(error.message)
        ? 'Your session has ended. Sign in again.'
        : "That didn't save. Try again in a moment.",
    };
  }
  store.set(TIME_FORMAT_COOKIE, parseTimeFormat(value), TIME_FORMAT_COOKIE_OPTIONS);
  return { ok: true };
}

/** At sign-out: the next login on this device reads its own profile, not this one's. */
export function clearTimeFormatCookie(store: CookieStore): void {
  store.set(TIME_FORMAT_COOKIE, '', { ...TIME_FORMAT_COOKIE_OPTIONS, maxAge: 0 });
}
