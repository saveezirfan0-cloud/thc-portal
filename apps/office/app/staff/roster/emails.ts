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

// ---------------------------------------------------------------------
// staff_email_records() — the rows behind one count (ADR-0144)
// ---------------------------------------------------------------------

export type EmailRecordKind = 'sent_today' | 'sent' | 'people' | 'failed' | 'queued';

/** What each count is called, for the dialog's title and its When column. */
export const RECORD_KIND_LABEL: Readonly<Record<EmailRecordKind, { title: string; when: string }>> =
  {
    sent_today: { title: 'Sent today', when: 'Sent (UK)' },
    sent: { title: 'Sent in all', when: 'Sent (UK)' },
    people: { title: 'People reached', when: 'Last sent (UK)' },
    failed: { title: 'Not delivered', when: 'Stopped (UK)' },
    queued: { title: 'Waiting to send', when: 'Due (UK)' },
  };

/** A page of records at a time. */
export const RECORDS_PAGE = 100;

export interface EmailRecord {
  email: string;
  staffId: string | null;
  name: string | null;
  at: string | null;
  /** `people`: how many of this email the address has had. */
  times: number;
  /** `failed`: why it was not delivered. */
  error: string | null;
}

export interface EmailRecordsPage {
  total: number;
  offset: number;
  rows: EmailRecord[];
}

/** Read the RPC's answer; anything missing reads as empty, never a crash. */
export function parseEmailRecords(raw: unknown): EmailRecordsPage {
  const r = obj(raw);
  const rows = Array.isArray(r.rows) ? r.rows : [];
  return {
    total: num(r.total),
    offset: num(r.offset),
    rows: rows.flatMap((item) => {
      const v = obj(item);
      const email = str(v.email);
      if (!email) return [];
      return [
        {
          email,
          staffId: str(v.staffId),
          name: str(v.name),
          at: str(v.at),
          times: num(v.times) || 1,
          error: str(v.error),
        },
      ];
    }),
  };
}

/**
 * A plain-English reason for a failed send. The outbox keeps the provider's
 * own words; the commonest ones get a sentence the office can act on, and
 * the original follows in full.
 */
export function failureReason(error: string | null): string {
  if (!error) return 'No reason recorded';
  const e = error.toLowerCase();
  if (e.includes('switched off')) return 'Cancelled: the email was switched off before it went';
  if (e.includes('invalid') && e.includes('address')) return 'The email address is not valid';
  if (e.includes('bounce')) return 'Bounced: the address does not accept mail';
  if (e.includes('suppress'))
    return 'The address had bounced or complained before, so it was not sent';
  return error;
}
