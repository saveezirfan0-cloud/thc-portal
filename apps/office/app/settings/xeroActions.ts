'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { READ_ONLY_MESSAGE } from '../_lib/sessionRole';
import { settingsDb } from './db';
import { supabaseConfigured } from './data';
import type { ActionResult } from './types';

/**
 * ADR-0211: the Xero tab's per-invoice "Try again". xero_retry() asserts a
 * finance caller that may write and puts a failed or mismatched row back to
 * pending; the next 15-minute run (or "Sync now") pushes it.
 */
export async function retryXeroInvoice(invoiceId: string): Promise<ActionResult> {
  if (typeof invoiceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(invoiceId)) {
    return { ok: false, message: 'Nothing to retry.' };
  }
  if (!supabaseConfigured()) {
    return { ok: false, message: 'This environment has no Supabase project.' };
  }
  const supabase = settingsDb(await cookies());
  const { error } = await supabase.rpc('xero_retry', { p_invoice: invoiceId });
  if (error) {
    if (/read_only|not_permitted/.test(error.message))
      return { ok: false, message: READ_ONLY_MESSAGE };
    if (/xero_nothing_to_retry/.test(error.message)) {
      return { ok: false, message: 'That invoice has nothing to retry.' };
    }
    console.error('[settings] xero_retry failed', { code: error.code });
    return { ok: false, message: 'That could not be retried. Try again, or ask an owner.' };
  }
  revalidatePath('/settings');
  return { ok: true };
}
