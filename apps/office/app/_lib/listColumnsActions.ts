'use server';

/* eslint-disable @typescript-eslint/no-explicit-any -- see listColumns.ts */

import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { LIST_KEY_PATTERN, normaliseColumnPref } from '@thc/ui';

export type SaveListColumnsResult = { ok: true } | { ok: false; message: string };

/**
 * Saves one list's column choice for the signed-in operator (ADR-0139);
 * `null` puts the list back to its default. Called by `ColumnPrefsProvider`
 * a moment after the last change, never on every click.
 *
 * The database checks the shape again and writes only the caller's own
 * row; this refuses early what it would refuse, without a round trip.
 * There is nothing to revalidate: the choice is already on screen, and the
 * provider keeps it for the rest of the visit.
 */
export async function saveListColumns(
  listKey: string,
  pref: unknown,
): Promise<SaveListColumnsResult> {
  if (typeof listKey !== 'string' || !LIST_KEY_PATTERN.test(listKey)) {
    return { ok: false, message: 'Unknown list.' };
  }
  const clean = pref === null ? null : normaliseColumnPref(pref);
  if (pref !== null && !clean) return { ok: false, message: 'Unknown columns.' };

  const { error } = await (createClient(await cookies()) as any).rpc('set_my_list_columns', {
    p_list: listKey,
    p_columns: clean,
  });
  if (error) {
    return {
      ok: false,
      message: /not_signed_in/.test(String(error.message))
        ? 'Your session has ended. Sign in again.'
        : "Your columns didn't save. They are kept on this page and sent again shortly.",
    };
  }
  return { ok: true };
}
