import { formatDateAdded } from '../../_lib/addedBy';

/**
 * The /staff/roster report (ADR-0123): what `invite_roster_report()` returns,
 * read defensively (it is jsonb), and the few words the screen derives from
 * it. Pure, so the vitest suite can hold it.
 */

export interface RosterKpis {
  notAppliedThc: number;
  notAppliedSpudbros: number;
  appliedKept: number;
  appliedFromList: number;
  possibleMatches: number;
  sentToday: number;
  sentTotal: number;
  failedTotal: number;
  failedToday: number;
  queued: number;
  peopleReminded: number;
  appliedAfterReminder: number;
  lastSentAt: string | null;
}

export interface RosterDay {
  day: string;
  sent: number;
  failed: number;
}

export interface RosterReminder {
  sent: number;
  lastSentAt: string | null;
  lastError: string | null;
}

export interface RosterMatch {
  entryId: string;
  staffId: string;
  staffName: string;
  staffEmail: string;
  status: string;
  appliedAt: string;
}

/**
 * Why somebody who applied with the listed email has no Payroll ID yet
 * (ADR-0142, `invite_roster_kept()`), first that fits.
 */
export type KeptReason =
  | 'payroll_id_taken'
  | 'other_payroll_id'
  | 'name_differs'
  | 'already_has'
  | 'no_payroll_id'
  | 'not_applied';

export const KEPT_REASONS: readonly KeptReason[] = [
  'name_differs',
  'payroll_id_taken',
  'other_payroll_id',
  'already_has',
  'no_payroll_id',
  'not_applied',
];

/** The Reason filter's words. */
export const KEPT_REASON_LABEL: Readonly<Record<KeptReason, string>> = {
  name_differs: 'Name differs from the sheet',
  payroll_id_taken: 'Payroll ID held by someone else',
  other_payroll_id: 'Has a different Payroll ID',
  already_has: 'Already has this Payroll ID',
  no_payroll_id: 'No Payroll ID on the sheet',
  not_applied: 'Payroll ID not given yet',
};

/** One applied row the Payroll ID was held back from, and who applied. */
export interface RosterKept {
  entryId: string;
  staffId: string;
  staffName: string;
  staffEmail: string;
  status: string;
  staffPayrollId: string | null;
  reason: KeptReason;
  /** For `payroll_id_taken`: who holds the sheet's Payroll ID. */
  holderId: string | null;
  holderName: string | null;
}

/**
 * Whether Link can settle it. A Payroll ID somebody else holds, or another
 * one the applicant already carries, means one of two records is wrong: the
 * office decides which on the profile, so there is no Link.
 */
export function keptLinkable(k: RosterKept): boolean {
  return k.reason !== 'payroll_id_taken' && k.reason !== 'other_payroll_id';
}

/** The sentence under the row's status: why, in the office's words. */
export function keptExplanation(k: RosterKept, sheetPayrollId: string | null): string {
  switch (k.reason) {
    case 'name_differs':
      return `Applied as ${k.staffName || 'someone without a name'}, a different name from the sheet. Link if they are the same person.`;
    case 'payroll_id_taken':
      return `Payroll ID ${sheetPayrollId ?? ''} is already ${k.holderName || 'someone else'}’s. Check which of the two is right on the payroll sheet.`;
    case 'other_payroll_id':
      return `Already has Payroll ID ${k.staffPayrollId ?? ''}, not ${sheetPayrollId ?? ''}. Check which is right on the payroll sheet.`;
    case 'already_has':
      return 'Already has this Payroll ID. Link to take them off the list.';
    case 'no_payroll_id':
      return 'The sheet gives no Payroll ID for them. Link gives them their group and takes them off the list.';
    case 'not_applied':
      return 'Their Payroll ID was never given to them. Link gives it now.';
  }
}

export interface RosterReportData {
  today: string;
  /** `enabled`: the page's On/Off; `switchOn`: the IR1 switch on /settings → Notifications. */
  settings: { enabled: boolean; switchOn: boolean; from: string; until: string };
  kpis: RosterKpis;
  daily: RosterDay[];
  reminders: Record<string, RosterReminder>;
  /** Ids of list rows whose person has applied with the listed email (kept for their Payroll ID). */
  applied: string[];
  /** Why each of `applied` has no Payroll ID, and who applied (ADR-0142). */
  kept: RosterKept[];
  matches: RosterMatch[];
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Read the RPC's answer; anything missing reads as zero or empty, never a crash. */
export function parseRosterReport(raw: unknown): RosterReportData {
  const r = obj(raw);
  const k = obj(r.kpis);
  const s = obj(r.settings);
  const reminders: Record<string, RosterReminder> = {};
  for (const [email, value] of Object.entries(obj(r.reminders))) {
    const v = obj(value);
    reminders[email] = {
      sent: num(v.sent),
      lastSentAt: str(v.lastSentAt),
      lastError: str(v.lastError),
    };
  }
  return {
    today: str(r.today) ?? '',
    settings: {
      enabled: s.enabled !== false,
      switchOn: s.switchOn !== false,
      from: str(s.from) ?? '10:00',
      until: str(s.until) ?? '18:00',
    },
    kpis: {
      notAppliedThc: num(k.notAppliedThc),
      notAppliedSpudbros: num(k.notAppliedSpudbros),
      appliedKept: num(k.appliedKept),
      appliedFromList: num(k.appliedFromList),
      possibleMatches: num(k.possibleMatches),
      sentToday: num(k.sentToday),
      sentTotal: num(k.sentTotal),
      failedTotal: num(k.failedTotal),
      failedToday: num(k.failedToday),
      queued: num(k.queued),
      peopleReminded: num(k.peopleReminded),
      appliedAfterReminder: num(k.appliedAfterReminder),
      lastSentAt: str(k.lastSentAt),
    },
    daily: arr(r.daily).map((d) => {
      const v = obj(d);
      return { day: str(v.day) ?? '', sent: num(v.sent), failed: num(v.failed) };
    }),
    reminders,
    applied: arr(r.applied).filter((id): id is string => typeof id === 'string'),
    kept: arr(r.kept).flatMap((k) => {
      const v = obj(k);
      const reason = str(v.reason);
      const entryId = str(v.entryId);
      if (!entryId || !reason || !(KEPT_REASONS as readonly string[]).includes(reason)) return [];
      return [
        {
          entryId,
          staffId: str(v.staffId) ?? '',
          staffName: str(v.staffName) ?? '',
          staffEmail: str(v.staffEmail) ?? '',
          status: str(v.status) ?? '',
          staffPayrollId: str(v.staffPayrollId),
          reason: reason as KeptReason,
          holderId: str(v.holderId),
          holderName: str(v.holderName),
        },
      ];
    }),
    matches: arr(r.matches).map((m) => {
      const v = obj(m);
      return {
        entryId: str(v.entryId) ?? '',
        staffId: str(v.staffId) ?? '',
        staffName: str(v.staffName) ?? '',
        staffEmail: str(v.staffEmail) ?? '',
        status: str(v.status) ?? '',
        appliedAt: str(v.appliedAt) ?? '',
      };
    }),
  };
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  interview_requested: 'Interview requested',
  interview_completed: 'Interview completed',
  documents: 'Documents',
  quiz: 'Quiz',
  contract: 'Contract',
  compliant: 'Compliant',
  blocked: 'Blocked',
  inactive: 'Inactive',
  rejected: 'Rejected',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, ' ');
}

/** Whether the daily reminder actually goes: on here, and not switched off in Settings. */
export function remindersSending(settings: RosterReportData['settings']): boolean {
  return settings.enabled && settings.switchOn;
}

/** The sentence under "Daily reminders": on and when, or which switch has it off. */
export function reminderSchedule(settings: RosterReportData['settings']): string {
  if (!settings.enabled) return 'Off — nobody is being reminded. Turn it on to start again';
  if (!settings.switchOn)
    return 'Off in Settings → Notifications ("Daily reminder to apply") — turn it on there';
  return `On · daily, from ${settings.from} (UK time)`;
}

/** "3× · last 14 Oct 2026", "Not yet", for one person's reminders. */
export function reminderSummary(r: RosterReminder | undefined): string {
  if (!r || r.sent === 0) return 'Not yet';
  return r.lastSentAt ? `${r.sent}× · last ${formatDateAdded(r.lastSentAt)}` : `${r.sent}×`;
}

/** "Tue 14" under a day's bar. */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(d);
  return `${weekday} ${d.getUTCDate()}`;
}

/** Bar heights as a share of the tallest day (0–100), so an empty fortnight draws flat. */
export function barHeights(days: readonly RosterDay[]): number[] {
  const max = Math.max(0, ...days.map((d) => d.sent));
  return days.map((d) => (max === 0 ? 0 : Math.round((d.sent / max) * 100)));
}

/** A percentage of `part` in `whole`, or null when there is nothing to divide. */
export function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}
