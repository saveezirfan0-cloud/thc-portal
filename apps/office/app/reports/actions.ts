'use server';

import { revalidatePath } from 'next/cache';
import { reportsDb, supabaseConfigured } from './data';
import { explainDbError } from '../_lib/dbError';

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
          : explainDbError(error, { log: '[reports]' }),
    };
  }
  revalidatePath('/reports');
  return { ok: true };
}

/**
 * "Mark reviewed for invoicing" (ADR-0172). Every rule is in
 * `sign_off_event_invoice()`: the mandatory note, the closed check-out
 * window, no unresolved No check-out, and the fingerprint — the figures
 * the manager was looking at must still be the figures in the database.
 */
export async function signOffInvoice(
  eventId: string,
  note: string,
  fingerprint: string,
): Promise<{ error: string } | { ok: true }> {
  if (!supabaseConfigured()) return { error: 'This environment has no Supabase project.' };
  const db = await reportsDb();
  const { error } = await db.rpc('sign_off_event_invoice', {
    p_event: eventId,
    p_note: note,
    p_fingerprint: fingerprint,
  });
  if (error) {
    const known = Object.keys(SIGN_OFF_REASONS).find((key) => error.message.includes(key));
    return {
      error: known ? SIGN_OFF_REASONS[known]! : explainDbError(error, { log: '[reports]' }),
    };
  }
  revalidatePath('/reports');
  revalidatePath(`/reports/invoicing/${eventId}`);
  return { ok: true };
}

/**
 * "Send again" on an issued invoice whose email failed or never arrived
 * (ADR-0175): a fresh INV1 row with the same PDF and timesheets, to the
 * client card's addresses as they are now. `resend_invoice_email()` holds
 * every rule.
 */
export async function resendInvoice(
  invoiceId: string,
  eventId: string,
): Promise<{ error: string } | { ok: true }> {
  if (!supabaseConfigured()) return { error: 'This environment has no Supabase project.' };
  const db = await reportsDb();
  const { error } = await db.rpc('resend_invoice_email', { p_invoice: invoiceId });
  if (error) {
    const known = Object.keys(RESEND_REASONS).find((key) => error.message.includes(key));
    return {
      error: known ? RESEND_REASONS[known]! : explainDbError(error, { log: '[reports]' }),
    };
  }
  revalidatePath('/reports');
  revalidatePath(`/reports/invoicing/${eventId}`);
  return { ok: true };
}

const RESEND_REASONS: Record<string, string> = {
  email_pending:
    'The last email for this invoice is still on its way. Check back in a few minutes.',
  invoice_not_sent_yet: 'This invoice is still being prepared; it is emailed by itself.',
  switched_off:
    'Invoice emails are switched off in Settings → Notifications. Switch INV1 on, then send again.',
  invoice_has_no_recipients:
    'The client card has no invoice email or contact email. Add one, then send again.',
  not_permitted: 'Only an owner or a manager with finance can send an invoice again.',
  admins_only: 'Only a manager can send an invoice again.',
};

/** The RPC's refusals in the manager's words. */
const SIGN_OFF_REASONS: Record<string, string> = {
  note_required: 'A note is required. Say what you checked before marking the event reviewed.',
  check_out_open:
    'Workers can still check out until 4 hours after the last shift ends. Try again after that.',
  already_invoiced: 'This event has been invoiced, so there is nothing left to sign off.',
  check_out_missing:
    'A worker never checked out. Resolve the No check-out on the Check-in screen with their actual finish time first.',
  changed_since_viewed:
    'Something on this event changed while you were looking at it. The page has been refreshed: check it again, then mark it reviewed.',
  nothing_to_invoice: 'This event has no shifts to invoice.',
  event_not_found: 'This event no longer exists.',
  not_permitted: 'Only an owner or a manager can mark an event reviewed for invoicing.',
  admins_only: 'Only a manager can mark an event reviewed for invoicing.',
};
