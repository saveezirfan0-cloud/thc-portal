/**
 * §3.6 / §3.4 / §10.4: who may reopen an ended booking row (D33,
 * ADR-0037). Re-exported by `state.ts`; kept in a module with NO imports
 * so `autoAssign.ts` can reach it from the Deno Edge Function
 * (`supabase/functions/auto-staffing`) with an explicit `.ts` specifier.
 */

/**
 * Who may reopen an ended booking row on the same section (§3.6, §3.4,
 * §10.4; ADR-0037). `booking_reopenable_by()` in SQL is the same table.
 *
 *   never   self_cancel (RULE-04), handed_over (ADR-0046: the same bar,
 *           since offering a shift up is leaving it), event_cancelled,
 *           gdpr / gdpr_invite
 *   anyone  ended by circumstance — slot_taken, overlap_auto_withdraw, a
 *           block or leave cascade: an auto-assign round may invite again
 *   person  ended by a decision — declined, withdrawn_by_worker,
 *           office_withdraw, ready_cutoff: only the office's manual invite
 *           or the worker's own Radar application reopens it
 *
 * Null for a live row (invited, applied, confirmed, worked, turned_away):
 * that is `already_has_booking`, not something to reopen.
 */
export type Reopener = 'never' | 'anyone' | 'person';

const NEVER_REOPENED: readonly string[] = [
  'self_cancel',
  'handed_over',
  'event_cancelled',
  'gdpr',
  'gdpr_invite',
];
const REOPENED_BY_ANYONE: readonly string[] = [
  'slot_taken',
  'overlap_auto_withdraw',
  'blocked',
  'blocked_invite',
  'left',
  'left_invite',
];

export function bookingReopenableBy(status: string, cause: string | null): Reopener | null {
  if (status !== 'cancelled' && status !== 'closed') return null;
  const c = cause ?? '';
  if (status === 'closed') return c === 'slot_taken' ? 'anyone' : 'person';
  if (NEVER_REOPENED.includes(c)) return 'never';
  if (REOPENED_BY_ANYONE.includes(c)) return 'anyone';
  return 'person';
}
