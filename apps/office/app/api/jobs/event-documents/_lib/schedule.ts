import { ukInstant } from '@thc/domain';

/**
 * When the Allocation Timesheet (D1) and the Completed Allocation Timesheet
 * (D2) go out on their own — ADR-0074, agreed with THC on 29.09.2026.
 *
 * Pure: the facts come from `event_documents_due()` and the settings row
 * `document_autosend`; the answer is one verdict. The SQL twin is
 * `document_autosend_verdict()` (20261002100000; its default time
 * 16:00 since 20261002114000), check for check and in the
 * same order, and the route sends only where BOTH say `due`. Change one,
 * change the other: pgTAP 760 and schedule.test.ts hold the same cases.
 *
 *   D1 · the day before the event at `allocation.time` (16:00 UK since
 *        02.10.2026; it was 14:00) — after the 12:00 "I'm ready" deadline
 *        and the 12:05 release — and any run
 *        after that until the first shift starts (an event created or
 *        filled late still gets one). Skipped if a manager queued a D1
 *        since 00:00 UK the day before.
 *   D2 · SWITCHED OFF since ADR-0083 (02.10.2026): the Completed Timesheet
 *        goes with the invoice, from Reports › Financial. The rule stays,
 *        for the day THC turns it back on in `document_autosend`:
 *        the morning after at `completed.time` (10:00) UK, never before the
 *        last shift's end + 4 h (every check-out window closed). Held while
 *        any row is still undetermined — an unresolved No check-out prints
 *        blank Finish and Hours (RULE-02) — and given up `hold_days` (14)
 *        after that morning. Skipped if a D2 was queued after the event
 *        ended. Never for an event whose D2 time is before `not_before`
 *        (when the feature was switched on).
 *   Both · not for a cancelled event (§3.3), one with nobody confirmed, or
 *        a client card with no contact emails; at most once per event.
 *   Update (`allocation_update`, ADR-0084; SQL twin
 *        `document_update_verdict()`, 20261002115000) · an Allocation
 *        Timesheet re-sent when what it prints has changed since the last
 *        copy anyone queued — not before an hour (`update.gap_minutes`)
 *        after that copy, and never once the first shift has started. It
 *        only ever follows a copy queued since 00:00 UK the day before, so
 *        it never goes in the same run as D1. Not for nobody confirmed or
 *        no contact emails; eight failed claims per change, then gave_up.
 */

export type DocumentKind = 'allocation' | 'signout';

/** What the job sends: the two documents, and the re-send of a changed D1. */
export type JobKind = DocumentKind | 'allocation_update';

export type AutosendVerdict =
  | 'due'
  | 'disabled'
  | 'already_sent'
  | 'cancelled'
  | 'not_yet'
  | 'too_late'
  | 'before_activation'
  | 'hold_expired'
  | 'no_confirmed_staff'
  | 'no_contact_emails'
  | 'manual_sent'
  | 'held_no_checkout'
  | 'gave_up'
  // allocation_update only (ADR-0084):
  | 'not_sent_yet'
  | 'no_baseline'
  | 'unchanged'
  | 'too_soon';

/**
 * Claims the job may spend on one event and kind (a claim = one attempt to
 * draw, store and queue). After this many the verdict is `gave_up` and the
 * office sends it by hand — a Storage or database fault never retries for
 * ever. The SQL claim holds the same ceiling.
 */
export const MAX_CLAIMS = 8;

export interface AutosendConfig {
  allocation: { enabled: boolean; time: string };
  completed: { enabled: boolean; time: string; holdDays: number; notBefore: string | null };
  /** ADR-0084: re-send a changed Allocation Timesheet, at most every `gapMinutes`. */
  update: { enabled: boolean; gapMinutes: number };
}

export const DEFAULT_TIMES = {
  allocation: '16:00',
  completed: '10:00',
  holdDays: 14,
  updateGapMinutes: 60,
} as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clock(value: unknown, fallback: string): string {
  return typeof value === 'string' && HHMM.test(value) ? value : fallback;
}

/**
 * The settings row, as `document_autosend_config()` returns it. Anything
 * missing takes the default the SQL takes; a missing ROW is handled in SQL
 * (both kinds off), so here an empty object means "defaults, on".
 */
export function parseAutosendConfig(raw: unknown): AutosendConfig {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const allocation = (value.allocation ?? {}) as Record<string, unknown>;
  const completed = (value.completed ?? {}) as Record<string, unknown>;
  const update = (value.update ?? {}) as Record<string, unknown>;
  // A JSON number, a whole one, 15–1440 (a quarter-hour to a day).
  const gap = typeof update.gap_minutes === 'number' ? update.gap_minutes : NaN;
  // A JSON number, a whole one, 0–9999 — what the SQL twin accepts.
  const hold = typeof completed.hold_days === 'number' ? completed.hold_days : NaN;
  const notBefore =
    typeof completed.not_before === 'string' && !Number.isNaN(Date.parse(completed.not_before))
      ? completed.not_before
      : null;
  return {
    allocation: {
      enabled: flag(allocation.enabled, true),
      time: clock(allocation.time, DEFAULT_TIMES.allocation),
    },
    completed: {
      enabled: flag(completed.enabled, true),
      time: clock(completed.time, DEFAULT_TIMES.completed),
      holdDays: Number.isInteger(hold) && hold >= 0 && hold <= 9999 ? hold : DEFAULT_TIMES.holdDays,
      notBefore,
    },
    update: {
      enabled: flag(update.enabled, true),
      gapMinutes:
        Number.isInteger(gap) && gap >= 15 && gap <= 1440 ? gap : DEFAULT_TIMES.updateGapMinutes,
    },
  };
}

/** One candidate, as a row of `event_documents_due()`. */
export interface AutosendFacts {
  kind: JobKind;
  /** The event's UK calendar date, "2026-09-19". */
  eventDate: string;
  /** Earliest role start / latest role end (RULE-18), or null: no sections. */
  firstStart: string | null;
  lastEnd: string | null;
  cancelled: boolean;
  /** Confirmed + worked bookings: the rows of the sheet. */
  confirmed: number;
  /** Contact emails on the client card. */
  contacts: number;
  /** Rows whose Finish/Hours would print blank (unresolved No check-out). */
  undetermined: number;
  /** Latest D1 a MANAGER queued (automatic copies excluded). */
  manualAllocationAt: string | null;
  /** Latest D2 queued by anyone. */
  signoutQueuedAt: string | null;
  /** When this kind's automatic send was queued, if it has been. */
  autoQueuedAt: string | null;
  /** Claims already spent on it (a live one not counted). */
  attempts?: number;
  /** allocation_update: the latest Allocation Timesheet anyone queued. */
  allocationSentAt?: string | null;
  /** allocation_update: does the sheet print differently now? null = no baseline. */
  changed?: boolean | null;
}

/** "2026-09-19" ± days, as a calendar date (no zone involved). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const FOUR_HOURS = 4 * 60 * 60 * 1000;

/** The instant this kind's automatic send becomes due. */
export function autosendDueAt(
  kind: DocumentKind,
  facts: Pick<AutosendFacts, 'eventDate' | 'lastEnd'>,
  config: AutosendConfig,
): Date {
  if (kind === 'allocation') return ukInstant(addDays(facts.eventDate, -1), config.allocation.time);
  const morning = ukInstant(addDays(facts.eventDate, 1), config.completed.time);
  if (!facts.lastEnd) return morning;
  const windowsClosed = new Date(new Date(facts.lastEnd).getTime() + FOUR_HOURS);
  return windowsClosed > morning ? windowsClosed : morning;
}

/** After this the job stops trying a D2 (the button still works). */
export function completedStopAt(eventDate: string, config: AutosendConfig): Date {
  return ukInstant(addDays(eventDate, 1 + config.completed.holdDays), config.completed.time);
}

const at = (iso: string | null): number | null => (iso ? new Date(iso).getTime() : null);

/** The re-send of a changed Allocation Timesheet (ADR-0084). */
function updateVerdict(facts: AutosendFacts, t: number, config: AutosendConfig): AutosendVerdict {
  const firstStart = at(facts.firstStart);
  const sentAt = at(facts.allocationSentAt ?? null);
  // 00:00 UK the day before: the same freshness line as manual_sent.
  const fresh = ukInstant(addDays(facts.eventDate, -1), '00:00').getTime();
  if (!config.update.enabled) return 'disabled';
  if (facts.cancelled) return 'cancelled';
  if (firstStart !== null && t >= firstStart) return 'too_late';
  if (sentAt === null || sentAt < fresh) return 'not_sent_yet';
  if (facts.changed === null || facts.changed === undefined) return 'no_baseline';
  if (!facts.changed) return 'unchanged';
  if (facts.confirmed === 0) return 'no_confirmed_staff';
  if (facts.contacts === 0) return 'no_contact_emails';
  if (t < sentAt + config.update.gapMinutes * 60_000) return 'too_soon';
  if ((facts.attempts ?? 0) >= MAX_CLAIMS) return 'gave_up';
  return 'due';
}

export function autosendVerdict(
  facts: AutosendFacts,
  now: Date,
  config: AutosendConfig,
): AutosendVerdict {
  const t = now.getTime();
  if (facts.kind === 'allocation_update') return updateVerdict(facts, t, config);
  const dueAt = autosendDueAt(facts.kind, facts, config).getTime();

  if (facts.kind === 'allocation') {
    const firstStart = at(facts.firstStart);
    const manual = at(facts.manualAllocationAt);
    const dayBefore = ukInstant(addDays(facts.eventDate, -1), '00:00').getTime();
    if (!config.allocation.enabled) return 'disabled';
    if (facts.autoQueuedAt) return 'already_sent';
    if (facts.cancelled) return 'cancelled';
    if (t < dueAt) return 'not_yet';
    if (firstStart !== null && t >= firstStart) return 'too_late';
    if (facts.confirmed === 0) return 'no_confirmed_staff';
    if (facts.contacts === 0) return 'no_contact_emails';
    if (manual !== null && manual >= dayBefore) return 'manual_sent';
    if ((facts.attempts ?? 0) >= MAX_CLAIMS) return 'gave_up';
    return 'due';
  }

  const lastEnd = at(facts.lastEnd);
  const queued = at(facts.signoutQueuedAt);
  const notBefore = at(config.completed.notBefore);
  if (!config.completed.enabled) return 'disabled';
  if (facts.autoQueuedAt) return 'already_sent';
  if (facts.cancelled) return 'cancelled';
  if (t < dueAt) return 'not_yet';
  if (notBefore !== null && dueAt < notBefore) return 'before_activation';
  if (t >= completedStopAt(facts.eventDate, config).getTime()) return 'hold_expired';
  if (facts.confirmed === 0) return 'no_confirmed_staff';
  if (facts.contacts === 0) return 'no_contact_emails';
  if (queued !== null && lastEnd !== null && queued >= lastEnd) return 'manual_sent';
  if (facts.undetermined > 0) return 'held_no_checkout';
  if ((facts.attempts ?? 0) >= MAX_CLAIMS) return 'gave_up';
  return 'due';
}

/** The verdicts worth a log line: a send the office might have expected. */
export const NOTEWORTHY: ReadonlySet<AutosendVerdict> = new Set([
  'cancelled',
  'no_confirmed_staff',
  'no_contact_emails',
  'manual_sent',
  'held_no_checkout',
  'gave_up',
]);

const UK_STAMP = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "28/09 14:00", UK — an audit-style stamp (§1.8). */
export function ukShortStamp(iso: string): string {
  return UK_STAMP.format(new Date(iso)).replace(',', '');
}

/** ADR-0083: where the Completed Timesheet goes from while D2 is off. */
export const COMPLETED_WITH_INVOICE =
  'Completed Timesheet goes to the client with the invoice (Reports › Financial)';

/**
 * The line under the event page's document buttons: when the automatic
 * send happens, or when it happened. Null when there is nothing to say
 * (switched off, or the moment has passed without one).
 *
 * The Completed Timesheet (ADR-0083): `sentAt` is the automatic send;
 * `queuedAt` / `deliveredAt` the latest copy anyone queued, and when its
 * email went. While D2 is switched off it goes with the invoice, from
 * Reports › Financial, and the line says so.
 */
export function autosendHint(
  kind: DocumentKind,
  config: AutosendConfig,
  state: {
    sentAt: string | null;
    started: boolean;
    ended: boolean;
    queuedAt?: string | null;
    deliveredAt?: string | null;
    /** ADR-0084: the latest automatic update of the Allocation Timesheet. */
    updatedAt?: string | null;
  },
): string | null {
  if (kind === 'allocation') {
    const base = state.sentAt
      ? `Allocation Timesheet sent automatically ${ukShortStamp(state.sentAt)}`
      : !config.allocation.enabled || state.started
        ? null
        : `Sent automatically the day before at ${config.allocation.time} (UK time)`;
    const update = state.updatedAt
      ? `updated automatically ${ukShortStamp(state.updatedAt)}`
      : config.update.enabled && !state.started
        ? 'and again if the line-up or times change (at most hourly)'
        : null;
    if (base && update) return `${base} · ${update}`;
    if (state.updatedAt) return `Allocation Timesheet ${update}`;
    return base;
  }
  if (state.sentAt) return `Completed Timesheet sent automatically ${ukShortStamp(state.sentAt)}`;
  if (state.deliveredAt)
    return `Completed Timesheet sent to the client ${ukShortStamp(state.deliveredAt)}`;
  if (state.queuedAt)
    return `Completed Timesheet queued for the client ${ukShortStamp(state.queuedAt)}`;
  if (!config.completed.enabled) return COMPLETED_WITH_INVOICE;
  return `Sent automatically the morning after at ${config.completed.time} (UK time), once every check-out is resolved`;
}
