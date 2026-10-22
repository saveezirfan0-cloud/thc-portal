/**
 * /onboarding/reminders (ADR-0187): the daily emails that chase a candidate
 * who has stopped part-way through onboarding (ADR-0071, ADR-0169,
 * ADR-0186), and the numbers `onboarding_email_report()` gives beside them.
 * The words are never copied here: `previews.ts` renders each from the
 * register (packages/notifications) exactly as it is sent, on the server.
 * Pure, so the vitest suite can hold it.
 */

export type ReminderGroup = 'interview' | 'setup' | 'app';
export type ReminderTrack = 'interview' | 'activation' | 'app';

export interface ReminderEmail {
  /** `onboarding_email_report()`'s id: the code and the variant. */
  id: string;
  template: 'OC1' | 'OC2' | 'OC3' | 'OC4';
  variant: string;
  group: ReminderGroup;
  /** What the office calls it. */
  name: string;
  /** Who gets it, in the office's words. */
  to: string;
  /** When it goes. */
  when: string;
  /** OC3 is a push; the rest are emails. */
  channel: 'email' | 'push';
}

export const GROUPS: readonly { key: ReminderGroup; title: string; note: string }[] = [
  {
    key: 'interview',
    title: 'Waiting on their video interview',
    note: 'Sent by email until the interview is done.',
  },
  {
    key: 'setup',
    title: 'Accepted, account not set up',
    note: 'Sent by email, with a new link each day, until they set a password.',
  },
  {
    key: 'app',
    title: 'In the app, a step to do',
    note: 'Each day: the push, and the email with how to do the step. The email goes to everyone with a step to do, whether or not they have notifications on.',
  },
];

const NEW_APPLICANTS = 'New applicants who have been sent their Willo interview and not done it';
const EXISTING_STAFF =
  'Staff who already work with us (on the invite list, or with a Payroll ID) and have not done their Willo interview';
const NOT_SET_UP = 'Candidates accepted after their interview who have not set a password';
const IN_THE_APP = 'Candidates signed in to the app with a wizard step still to do';

const RUNG_WHEN = {
  first: 'A day after their last progress',
  second: 'The day after the first',
  repeat: 'Every day after that until they move on',
} as const;
const WINDOW = ', between 10:00 and 18:00 (UK time)';

const rungs = (
  template: ReminderEmail['template'],
  group: ReminderGroup,
  label: string,
  to: string,
  channel: ReminderEmail['channel'],
  prefix = '',
  firstWhen: string = RUNG_WHEN.first,
): ReminderEmail[] =>
  (
    [
      ['first', `${label} · first`, firstWhen],
      ['second', `${label} · second`, RUNG_WHEN.second],
      ['repeat', `${label} · every day after`, RUNG_WHEN.repeat],
    ] as const
  ).map(([rung, name, when]) => ({
    id: `${template}:${prefix}${rung}`,
    template,
    variant: `${prefix}${rung}`,
    group,
    name,
    to,
    when: `${when}${WINDOW}`,
    channel,
  }));

/** In `onboarding_email_report()`'s order. */
export const REMINDER_EMAILS: readonly ReminderEmail[] = [
  ...rungs(
    'OC1',
    'interview',
    'Interview reminder',
    NEW_APPLICANTS,
    'email',
    '',
    'A day after Willo sends the invitation',
  ),
  ...rungs(
    'OC1',
    'interview',
    'Interview reminder, existing staff',
    EXISTING_STAFF,
    'email',
    'existing_',
    'A day after Willo sends the invitation',
  ),
  ...rungs(
    'OC2',
    'setup',
    'Set-up reminder',
    NOT_SET_UP,
    'email',
    '',
    'A day after their activation email',
  ),
  ...rungs('OC3', 'app', 'App reminder · push', IN_THE_APP, 'push'),
  ...rungs('OC4', 'app', 'App reminder · email with instructions', IN_THE_APP, 'email'),
];

/** The wizard-step overview, in the words the reminders use. */
export const TRACK_LABEL: Readonly<Record<ReminderTrack, string>> = {
  interview: 'Waiting on their video interview',
  activation: 'Accepted, account not set up',
  app: 'In the app, a step to do',
};

// ---------------------------------------------------------------------
// onboarding_email_report()
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

export interface StageCounts {
  /** Candidates being reminded now: their next move is their own. */
  waiting: number;
  remindedToday: number;
  /** `stalledAfter` reminders and no progress: phone them. */
  stalled: number;
  /** Their latest reminder could not be delivered. */
  lastFailed: number;
  /** The app track only: a device with notifications on. */
  withPush: number;
}

export interface OnboardingEmailReport {
  today: string;
  stalledAfter: number;
  switches: Record<ReminderEmail['template'], boolean>;
  stages: Record<ReminderTrack, StageCounts>;
  steps: { step: string; n: number }[];
  /** OC4 emails sent beside a push (ADR-0186), apart from those in place of one. */
  besidePush: { sentToday: number; sentTotal: number; failedTotal: number };
  emails: Record<string, EmailCounts>;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const stage = (v: unknown): StageCounts => {
  const s = obj(v);
  return {
    waiting: num(s.waiting),
    remindedToday: num(s.remindedToday),
    stalled: num(s.stalled),
    lastFailed: num(s.lastFailed),
    withPush: num(s.withPush),
  };
};

/** Read the RPC's answer; anything missing reads as zero, never a crash. */
export function parseOnboardingEmailReport(raw: unknown): OnboardingEmailReport {
  const r = obj(raw);
  const sw = obj(r.switches);
  const st = obj(r.stages);
  const bp = obj(r.besidePush);
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
    stalledAfter: num(r.stalledAfter) || 3,
    switches: {
      OC1: sw.OC1 !== false,
      OC2: sw.OC2 !== false,
      OC3: sw.OC3 !== false,
      OC4: sw.OC4 !== false,
    },
    stages: {
      interview: stage(st.interview),
      activation: stage(st.activation),
      app: stage(st.app),
    },
    steps: (Array.isArray(r.steps) ? r.steps : []).flatMap((item) => {
      const s = obj(item);
      const step = str(s.step);
      return step ? [{ step, n: num(s.n) }] : [];
    }),
    besidePush: {
      sentToday: num(bp.sentToday),
      sentTotal: num(bp.sentTotal),
      failedTotal: num(bp.failedTotal),
    },
    emails,
  };
}

/** The counts for one email, zero when the report has no row for it. */
export function countsFor(report: OnboardingEmailReport | null, id: string): EmailCounts {
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

/** Everything sent today, by every reminder in the list. */
export function sentTodayTotal(report: OnboardingEmailReport | null): number {
  return REMINDER_EMAILS.reduce((n, e) => n + countsFor(report, e.id).sentToday, 0);
}

/** The totals the tiles show: across the three tracks. */
export function stageTotals(report: OnboardingEmailReport): StageCounts {
  const all = Object.values(report.stages);
  return {
    waiting: all.reduce((n, s) => n + s.waiting, 0),
    remindedToday: all.reduce((n, s) => n + s.remindedToday, 0),
    stalled: all.reduce((n, s) => n + s.stalled, 0),
    lastFailed: all.reduce((n, s) => n + s.lastFailed, 0),
    withPush: all.reduce((n, s) => n + s.withPush, 0),
  };
}
