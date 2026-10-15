/**
 * /staff/roster "Emails staff receive" (ADR-0141): the emails THC's own
 * staff get while moving onto the new app, and the numbers
 * `staff_email_report()` gives beside them. The words are never copied here:
 * `email-previews.ts` renders each from the register (packages/notifications)
 * exactly as it is sent, on the server. Pure, so the vitest suite can hold it.
 */

export interface StaffEmail {
  /** `staff_email_report()`'s id: the code, and for OC1 the variant. */
  id: string;
  template: 'IR1' | 'OC1';
  variant: string;
  /** What the office calls it. */
  name: string;
  /** Who gets it, in the office's words. */
  to: string;
  /** When it goes. */
  when: string;
}

const INTERVIEW_TO =
  'Staff who already work with us, have registered on the new app and have not done their Willo interview';

export const STAFF_EMAILS: readonly StaffEmail[] = [
  {
    id: 'IR1',
    template: 'IR1',
    variant: 'named',
    name: 'Daily reminder to register',
    to: 'Everyone in the THC group on this list who has not applied yet',
    when: 'Once a day from 10:00 (UK time), until they apply',
  },
  {
    id: 'OC1:existing_first',
    template: 'OC1',
    variant: 'existing_first',
    name: 'Interview reminder · first',
    to: INTERVIEW_TO,
    when: 'A day after Willo sends their interview invitation',
  },
  {
    id: 'OC1:existing_second',
    template: 'OC1',
    variant: 'existing_second',
    name: 'Interview reminder · second',
    to: INTERVIEW_TO,
    when: 'The day after the first',
  },
  {
    id: 'OC1:existing_repeat',
    template: 'OC1',
    variant: 'existing_repeat',
    name: 'Interview reminder · every day after',
    to: INTERVIEW_TO,
    when: 'Every day after that until they do it, between 10:00 and 18:00 (UK time)',
  },
  {
    id: 'OC1:existing_notice',
    template: 'OC1',
    variant: 'existing_notice',
    name: 'One-off interview notice',
    to: INTERVIEW_TO,
    when: 'Once, to everyone waiting on their interview on 14 October 2026; sent from 10:00 (UK time) on 15 October',
  },
];

// ---------------------------------------------------------------------
// staff_email_report()
// ---------------------------------------------------------------------

export interface EmailCounts {
  id: string;
  sentToday: number;
  sentTotal: number;
  failedTotal: number;
  queued: number;
  people: number;
  lastSentAt: string | null;
  nextAt: string | null;
}

export interface StaffEmailReport {
  today: string;
  /** Existing staff waiting on their Willo interview now. */
  interviewWaiting: number;
  /** Each code switched on: its own switch and the job's. */
  switches: { IR1: boolean; OC1: boolean };
  emails: Record<string, EmailCounts>;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Read the RPC's answer; anything missing reads as zero, never a crash. */
export function parseStaffEmailReport(raw: unknown): StaffEmailReport {
  const r = obj(raw);
  const s = obj(r.switches);
  const emails: Record<string, EmailCounts> = {};
  for (const item of Array.isArray(r.emails) ? r.emails : []) {
    const e = obj(item);
    const id = str(e.id);
    if (!id) continue;
    emails[id] = {
      id,
      sentToday: num(e.sentToday),
      sentTotal: num(e.sentTotal),
      failedTotal: num(e.failedTotal),
      queued: num(e.queued),
      people: num(e.people),
      lastSentAt: str(e.lastSentAt),
      nextAt: str(e.nextAt),
    };
  }
  return {
    today: str(r.today) ?? '',
    interviewWaiting: num(r.interviewWaiting),
    switches: { IR1: s.IR1 !== false, OC1: s.OC1 !== false },
    emails,
  };
}

/** The counts for one email, zero when the report has no row for it. */
export function countsFor(report: StaffEmailReport | null, id: string): EmailCounts {
  return (
    report?.emails[id] ?? {
      id,
      sentToday: 0,
      sentTotal: 0,
      failedTotal: 0,
      queued: 0,
      people: 0,
      lastSentAt: null,
      nextAt: null,
    }
  );
}
