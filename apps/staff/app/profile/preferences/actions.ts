'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { saveTimeFormat } from '@thc/db/time-format';
import { supabaseConfigured } from '../../db';
import type { ActionResult } from '../types';

/**
 * Profile → Preferences → Time format (ADR-0085).
 *
 * The database holds the choice (`set_my_time_format()` writes the worker's
 * own `profiles` row) and `saveTimeFormat` also sets the device cookie every
 * server page reads, so the next render is already on the new clock. A value
 * that is not exactly "24h" or "12h" is refused before it reaches either:
 * the form can only send two, so anything else is a hand-made request.
 *
 * Display only. Nothing stored changes and no rule reads it.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so nothing can be saved. See docs/04-setup-github-vercel-supabase.md.';

export async function saveTimeFormatPreference(value: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const saved = await saveTimeFormat(await cookies(), value);
  if (!saved.ok) return { ok: false, message: saved.message };

  // Every cached page was written on the old clock, not just this one.
  revalidatePath('/', 'layout');
  return {
    ok: true,
    note: `Times now show on the ${value === '12h' ? '12-hour' : '24-hour'} clock.`,
  };
}
