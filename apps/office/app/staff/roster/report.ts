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

export interface RosterReportData {
  today: string;
  /** `enabled`: the page's On/Off; `switchOn`: the IR1 switch on /settings → Notifications. */
  settings: { enabled: boolean; switchOn: boolean; from: string; until: string };
  kpis: RosterKpis;
  daily: RosterDay[];
  reminders: Record<string, RosterReminder>;
  /** Ids of list rows whose person has applied with the listed email (kept for their Payroll ID). */
  applied: string[];
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
