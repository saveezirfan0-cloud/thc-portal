/**
 * Send priority — which outbox rows the drain claims first (ADR-0158).
 *
 * `claim_outbox_batch()` orders by `priority, send_after`, so a burst of a
 * thousand onboarding chasers no longer holds a "Time to check in" push or
 * an N6b release notice for twenty minutes behind it. The number is stored
 * on the row (`notification_outbox.priority`), set at insert by a trigger
 * from the SQL function `notification_priority(template)`; this file is
 * the source that function is checked against.
 *
 * Every code the drain can send has a class here — the register (TEMPLATES)
 * and the document emails — and the type makes that exhaustive: a code
 * added to either cannot compile without one. `__tests__/priority.test.ts`
 * then holds the latest migration's SQL mapping to exactly this table, and
 * `supabase/tests/856_notify_drain_priority.sql` holds the database to it.
 *
 *   urgent  about a shift that is close or a booking that just changed:
 *           invitations, the day-before / on-the-day / check-in reminders,
 *           releases, withdrawals, cancellations, time changes, offers, the
 *           office's line-up messages, and the office emails that ask for
 *           cover now. Late is the same as never for these.
 *   normal  everything else: account, compliance and office emails, the
 *           customer's line-up emails, the document emails. An unknown code
 *           is normal too, so a row is never stuck for want of a class.
 *   bulk    daily sweeps that go to hundreds at once and are just as good
 *           an hour later: the onboarding chasers, the invite-list reminder,
 *           the document-expiry countdown and the right-to-work countdown.
 */

import type { DocumentEmailCode } from './documents.ts';
import type { TemplateCode } from './templates.ts';

export const PRIORITY = { urgent: 0, normal: 1, bulk: 2 } as const;
export type PriorityClass = keyof typeof PRIORITY;
export type SendPriority = (typeof PRIORITY)[PriorityClass];

/** Every code that can be a `notification_outbox.template`. */
export type OutboxCode = TemplateCode | DocumentEmailCode;

const { urgent, normal, bulk } = PRIORITY;

/**
 * One class per code. A mapped type over `OutboxCode`, so a new register
 * code or document email is a type error here until it is given one.
 */
export const SEND_PRIORITY: { readonly [C in OutboxCode]: SendPriority } = {
  // Document expiry ladder (§4.2): a month / two weeks / a week out are the
  // daily sweep; the expiry itself blocks the worker, so it is not bulk.
  N1: bulk,
  N2: bulk,
  N3: bulk,
  N4: normal,
  // The booking lifecycle (§3.5, §5).
  N5: urgent,
  N6: urgent,
  N6b: urgent,
  N7: urgent,
  N8: normal,
  N9: urgent,
  N9b: urgent,
  N13: urgent,
  N10: urgent,
  N10b: urgent,
  N10d: urgent,
  N10e: urgent,
  N10c: urgent,
  N11: urgent,
  N11b: urgent,
  N12: urgent,
  N14: normal,
  N15: normal,
  // ADR-0180: the office asks for more detail on a criminal declaration.
  DR1: normal,
  // Emails (§8).
  E1: normal,
  E2: normal,
  E2b: normal,
  E3: normal,
  E4: normal,
  E5: normal,
  E5b: normal,
  E6: normal,
  E7: normal,
  E8: normal,
  E9: normal,
  // A self-cancel leaves a hole in a line-up the office has to fill.
  E10: urgent,
  E11: normal,
  E12: normal,
  // The completion-letter requirement. CL4 is the daily RTW countdown.
  CL1: normal,
  CL2: normal,
  CL3: normal,
  CL4: bulk,
  CL5: normal,
  CL6: normal,
  // Staff App additions (ADR-0045).
  RC1: normal,
  RC2: normal,
  RC3: normal,
  RC5: normal,
  RC4: normal,
  // Offers and cover: a shift changing hands, against its expiry.
  OF1: urgent,
  OF2: urgent,
  OF3: urgent,
  OF4: urgent,
  OF5: urgent,
  OF6: urgent,
  // Client requirements (ADR-0110). CR2 is the kit message on the morning.
  CR1: normal,
  CR2: urgent,
  CR3: normal,
  // ADR-0184: bring ID to a security-cleared event — about a shift days or hours away.
  SC1: urgent,
  // The office's messages from the event board: last-minute by nature.
  OM1: urgent,
  OM2: urgent,
  // The daily chasers (ADR-0071, ADR-0122).
  OC1: bulk,
  OC2: bulk,
  OC3: bulk,
  OC4: bulk,
  IR1: bulk,
  // Client Portal (ADR-0135).
  CP1: normal,
  CP2: normal,
  CP3: normal,
  // Document emails (documents.ts).
  BG08: normal,
  NS1: normal,
  D1: normal,
  D2: normal,
  // ADR-0176: an invoice is a document email like D2.
  INV1: normal,
};

/** The class for a row's template; an unknown code is `normal`, as in SQL. */
export function sendPriority(template: string): SendPriority {
  return Object.prototype.hasOwnProperty.call(SEND_PRIORITY, template)
    ? SEND_PRIORITY[template as OutboxCode]
    : normal;
}

/**
 * The `values` rows `notification_priorities()` must hold, one per line in
 * code order — what to paste into a migration when the table above changes.
 * The test prints it on a mismatch.
 */
export function priorityValuesSql(): string {
  return Object.entries(SEND_PRIORITY)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([code, p]) => `    ('${code}', ${p})`)
    .join(',\n');
}
