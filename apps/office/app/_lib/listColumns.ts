/* eslint-disable @typescript-eslint/no-explicit-any -- packages/db ships a
   placeholder Database type until `pnpm --filter @thc/db gen:types` runs
   against a linked project; same narrowing the other office loaders use. */

import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { normaliseColumnPrefs } from '@thc/ui';
import type { ColumnPrefs } from '@thc/ui';

/** Supabase's auth cookie is `sb-<ref>-auth-token`, split into `.0`, `.1` when it is large. */
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/**
 * The signed-in operator's column choices, every list (ADR-0139), read once
 * per request through `my_list_columns()`.
 *
 * The root layout STARTS this and hands the promise to
 * `ColumnPrefsProvider` (ADR-0109: the layout never waits), and each list
 * resolves it with `use()` — so a list's first paint already has the
 * person's columns, with no flash of the defaults. It is one small read in
 * parallel with the page's own.
 *
 * Never throws: a preference is not worth a failed page. No session, no
 * project or an error reads as "no choice" — every list's defaults.
 */
export const listColumnPrefs = cache(async (): Promise<ColumnPrefs> => {
  if (!process.env['NEXT_PUBLIC_SUPABASE_URL'] || !process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    return {};
  }
  try {
    const store = await cookies();
    if (!store.getAll().some((cookie) => AUTH_COOKIE.test(cookie.name))) return {};
    const { data, error } = await (createClient(store) as any).rpc('my_list_columns');
    if (error) return {};
    return normaliseColumnPrefs(data);
  } catch {
    return {};
  }
});
