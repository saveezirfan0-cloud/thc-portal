'use server';

import { revalidatePath } from 'next/cache';
import { reportsDb, supabaseConfigured } from './data';

/**
 * "Retry send" on a failed BG-08 run (§9.9). The run's CSVs are already in
 * the `reports` bucket and its lines already stamped, so a retry is only a
 * fresh outbox row for the same attachments — `retry_finance_report()`
 * refuses anything that is not actually failed.
 */
export async function retryFinanceSend(sendId: number): Promise<{ error: string } | { ok: true }> {
  if (!supabaseConfigured()) return { error: 'This environment has no Supabase project.' };
  const db = await reportsDb();
  const { error } = await db.rpc('retry_finance_report', { p_send: sendId });
  if (error) {
    return {
      error: error.message.includes('not_failed')
        ? 'That report is not in a failed state, so there is nothing to retry.'
        : error.message.includes('admins_only')
          ? 'Only a manager can retry a report.'
          : error.message,
    };
  }
  revalidatePath('/reports');
  return { ok: true };
}
