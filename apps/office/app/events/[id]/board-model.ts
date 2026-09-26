/**
 * The event board's view-model — Scope §3.3, §3.4, §6.
 *
 * Pure, so the rules the manager reads off the board can be tested without
 * a database or a browser. Nothing here re-derives a rule: the gates and
 * the five factor inputs come from `auto_assign_candidates` (SQL), the
 * ranking from `rankCandidateRows` (the engine's own), the rates from
 * `finalHourlyPence` / `marginPerHourPence`. This module only decides what
 * each list shows and in what words.
 */

import {
  ACCEPT_APPLICATION_REFUSAL_COPY,
  CALENDAR_GATE,
  type CandidateRow,
  type ScoreBreakdown,
  type ScoreInput,
  type ScoreWeights,
  UK_ZONE,
  type Wave,
  bookingReopenableBy,
  candidateInput,
  finalHourlyPence,
  formatDateIn,
  formatTimeIn,
  marginPerHourPence,
  rankCandidateRows,
  roundMayInvite,
} from '@thc/domain';

// ---------------------------------------------------------------------
// People
// ---------------------------------------------------------------------

export interface BoardPersonName {
  staffId: string;
  /** "Grace L." — Avatar derives the initials, including the GDPR case. */
  name: string;
  /** Roles this worker is signed off for, for the row's second line. */
  roles: string[];
}

/**
 * "Grace L."; a GDPR-removed worker is "Deleted account #1042" and keeps
 * their row, so the headcount is not skewed (§1.7).
 */
export function shortName(person: {
  first: string;
  last: string;
  removed: boolean;
  employeeId: number | string | null;
}): string {
  if (person.removed) {
    return person.employeeId === null ? 'Deleted account' : `Deleted account #${person.employeeId}`;
  }
  const initial = person.last.trim().charAt(0);
  return initial ? `${person.first} ${initial}.` : person.first;
}

function personFor(people: ReadonlyMap<string, BoardPersonName>, staffId: string) {
  return people.get(staffId) ?? { staffId, name: 'Deleted account', roles: [] };
}

// ---------------------------------------------------------------------
// Potential pool (§3.3)
// ---------------------------------------------------------------------

export interface PoolEntry extends BoardPersonName {
  /** 1-based position in the engine's order: wave 1 first, then by score. */
  rank: number;
  wave: Wave;
  /** Qualified at THIS client and THIS role — the "Qualified" chip. */
  qualified: boolean;
  breakdown: ScoreBreakdown;
  /** The figures the score was computed from, as the engine read them. */
  input: ScoreInput;
  /** Set for a pending Radar application: the "Applied" marker (§3.3). */
  appliedAt: string | null;
  /** The `applied` booking a manager takes forward (N10); null otherwise. */
  applicationId: string | null;
  /**
   * How this worker's earlier booking on the section ended, when it did —
   * "Declined", "Withdrawn", "Slot taken" (CAUSE_COPY). §3.6 bars only a
   * self-cancel, so they are invitable again (D33); the line says why they
   * are here, and whether a round would reach them.
   */
  endedLabel: string | null;
  /** False for a person-decided end: only the manager's Invite reopens it. */
  autoInvitable: boolean;
}

export interface PendingApplication {
  staffId: string;
  bookingId: string;
  appliedAt: string | null;
  createdAt: string;
}

/**
 * Whether the manager's Invite can reopen this ended booking (§3.6, D33):
 * any end but a self-cancel, an event cancellation or a GDPR removal
 * (`bookingReopenableBy` → 'anyone' | 'person'), and never a row that
 * carries check-in history or a violation — that belongs to the booking
 * that ended (`invite_worker`, 20260930110100).
 */
export function officeMayReopen(booking: EndedBooking): boolean {
  if (booking.hasHistory) return false;
  const by = bookingReopenableBy(booking.status, booking.cancelCause);
  return by === 'anyone' || by === 'person';
}

export interface PoolOptions {
  /** This section's cancelled and closed bookings (D33: most are invitable again). */
  ended?: readonly EndedBooking[];
  /**
   * Same-day escalation (§3.4): once the section has started, "proximity to
   * the venue matters more than the match score" — nearest first within
   * each wave, as the escalation job invites (`selectInvitees`).
   */
  proximityFirst?: boolean;
  /**
   * ADR-0042: staff marked unavailable for this section
   * (`auto_assign_unavailable`). The engine never invites them, so they
   * are not in the ranked pool either — they sit under Unavailable with
   * "Invite anyway". A Radar applicant stays: applying was their choice.
   */
  unavailable?: ReadonlySet<string>;
}

/**
 * The ranked Potential pool for one role section.
 *
 * In the pool: every candidate with no gate and no live booking on this
 * section, plus the pending Radar applicants (§3.3: "Anyone who
 * self-applied via Radar … carries an 'Applied' marker in the Potential
 * pool"), plus anyone whose earlier booking here ended in a way the
 * manager may reopen (D33 — §3.6 bars only a self-cancel). An invited
 * worker who also applied stays in Invited only — their booking is
 * `invited`, so they never reach here (confirmed 04.09.2026).
 */
export function buildPool(
  rows: readonly CandidateRow[],
  people: ReadonlyMap<string, BoardPersonName>,
  applications: readonly PendingApplication[],
  weights: ScoreWeights,
  { ended = [], proximityFirst = false, unavailable = new Set() }: PoolOptions = {},
): PoolEntry[] {
  const applied = new Map(applications.map((a) => [a.staffId, a]));
  const endedByStaff = new Map(ended.map((b) => [b.staffId, b]));
  const eligible = rows.filter((row) => {
    if (row.gate !== null) return false;
    if (row.booking_status === 'applied') return applied.has(row.staff_id);
    // ADR-0042: the calendar-unavailable sit under Unavailable instead.
    if (unavailable.has(row.staff_id)) return false;
    if (row.booking_status === null) return true;
    const end = endedByStaff.get(row.staff_id);
    return end !== undefined && officeMayReopen(end);
  });

  const ranked = rankCandidateRows(eligible, weights);
  if (proximityFirst) {
    // Array.prototype.sort is stable: equal distances keep the score order.
    ranked.sort((a, b) =>
      a.wave !== b.wave
        ? a.wave - b.wave
        : candidateInput(a.subject).distanceKm - candidateInput(b.subject).distanceKm,
    );
  }

  return ranked.map((entry, index) => {
    const row = entry.subject;
    const application = applied.get(row.staff_id) ?? null;
    const end = row.booking_status === 'applied' ? undefined : endedByStaff.get(row.staff_id);
    return {
      ...personFor(people, row.staff_id),
      rank: index + 1,
      wave: entry.wave,
      qualified: row.qualified,
      breakdown: entry.breakdown,
      input: candidateInput(row),
      appliedAt: application ? (application.appliedAt ?? application.createdAt) : null,
      applicationId: application?.bookingId ?? null,
      endedLabel: end ? (CAUSE_COPY[end.cancelCause ?? '']?.label ?? UNKNOWN_CAUSE.label) : null,
      autoInvitable: roundMayInvite(row),
    };
  });
}

export type PoolFilter = 'all' | 'applied' | 'not_applied';
export type PoolSort = 'score' | 'applied' | 'name';

export interface PoolQuery {
  q: string;
  filter: PoolFilter;
  sort: PoolSort;
}

/**
 * §3.3: "the manager can sort/filter the pool by application status; the
 * pool's existing ranking and search stay intact alongside this". The rank
 * number is the engine's and never renumbers — a search or a re-sort
 * changes what is shown, not who auto-assign would invite next.
 */
export function queryPool(entries: readonly PoolEntry[], query: PoolQuery): PoolEntry[] {
  const needle = query.q.trim().toLowerCase();
  const shown = entries.filter((entry) => {
    if (query.filter === 'applied' && !entry.appliedAt) return false;
    if (query.filter === 'not_applied' && entry.appliedAt) return false;
    if (!needle) return true;
    return [entry.name, ...entry.roles].join(' ').toLowerCase().includes(needle);
  });

  if (query.sort === 'name') {
    return [...shown].sort((a, b) => a.name.localeCompare(b.name, 'en-GB') || a.rank - b.rank);
  }
  if (query.sort === 'applied') {
    // Applicants first, oldest application first; the rest in rank order.
    return [...shown].sort((a, b) => {
      if (a.appliedAt && b.appliedAt) return a.appliedAt.localeCompare(b.appliedAt);
      if (a.appliedAt) return -1;
      if (b.appliedAt) return 1;
      return a.rank - b.rank;
    });
  }
  return [...shown].sort((a, b) => a.rank - b.rank);
}

/** One factor chip: what it shows, and the hover line "show-rate 99% → 90". */
export interface FactorChip {
  label: string;
  title: string;
}

function trimNumber(value: number, digits = 1): string {
  return Number(value.toFixed(digits)).toString();
}

/** The five chips on a pool row, in the §6 order (wireframe event-board). */
export function factorChips(entry: Pick<PoolEntry, 'input' | 'breakdown'>): FactorChip[] {
  const { input, breakdown } = entry;
  const round = (n: number) => Math.round(n);
  // 1,000 km is the engine's "no usable home address" stand-in (autoAssign.ts).
  const noAddress = input.distanceKm >= 1_000;
  return [
    {
      label: `show ${trimNumber(input.reliability)}%`,
      title: `show-rate ${trimNumber(input.reliability)}% → ${round(breakdown.show)}`,
    },
    {
      label: `${trimNumber(input.rating)}★`,
      title: `rating ${trimNumber(input.rating)} → ${round(breakdown.rating)}`,
    },
    {
      label: noAddress ? 'no address' : `${trimNumber(input.distanceKm)} km`,
      title: noAddress
        ? 'no usable home address → 0'
        : `${trimNumber(input.distanceKm)} km → ${round(breakdown.proximity)}`,
    },
    {
      label: `${input.futureShifts} future`,
      title: `${input.futureShifts} future shift${input.futureShifts === 1 ? '' : 's'} → ${round(breakdown.fair)}`,
    },
    {
      label: `${input.venueTimes} visit${input.venueTimes === 1 ? '' : 's'}`,
      title: `${input.venueTimes} visit${input.venueTimes === 1 ? '' : 's'} → ${round(breakdown.venue)}`,
    },
  ];
}

/**
 * The hover breakdown on a score (§3.3, §6), one line per factor, in the
 * wireframe's form: "show-rate 99% → 90 × 0.30 = 27.0".
 */
export function scoreBreakdownLines(
  entry: Pick<PoolEntry, 'input' | 'breakdown'>,
  weights: ScoreWeights,
): string[] {
  const { input, breakdown } = entry;
  const line = (label: string, factor: number, weight: number) =>
    `${label} → ${Math.round(factor)} × ${weight.toFixed(2)} = ${(factor * weight).toFixed(1)}`;
  const noAddress = input.distanceKm >= 1_000;
  return [
    line(`show-rate ${trimNumber(input.reliability)}%`, breakdown.show, weights.show),
    line(`rating ${trimNumber(input.rating)}`, breakdown.rating, weights.rating),
    line(
      noAddress ? 'proximity (no address)' : `proximity ${trimNumber(input.distanceKm)} km`,
      breakdown.proximity,
      weights.proximity,
    ),
    line(`fair rotation ${input.futureShifts} future`, breakdown.fair, weights.fair),
    line(`venue history ${Math.min(input.venueTimes, 10)} of 10`, breakdown.venue, weights.venue),
    `total ${breakdown.total.toFixed(1)} ≈ ${Math.round(breakdown.total)}`,
  ];
}

/** "30%" for the legend, from the weights actually in `settings`. */
export function weightPercent(weight: number): string {
  return `${Math.round(weight * 100)}%`;
}

// ---------------------------------------------------------------------
// Unavailable (§3.3, §3.4, §6, §9.6)
// ---------------------------------------------------------------------

export type UnavailableTone = 'coral' | 'amber' | 'neutral';

export interface UnavailableEntry extends BoardPersonName {
  /**
   * A live gate from auto_assign_candidates, `unavailable` for a calendar
   * entry (ADR-0042), or the booking's cancel_cause.
   */
  reason: string;
  label: string;
  detail: string;
  tone: UnavailableTone;
  appliedAt: string | null;
  /**
   * ADR-0042: the one row the manager may still invite from — the worker
   * passes every hard gate and holds no booking here; only their calendar
   * keeps the machine away. The board asks before it sends.
   */
  inviteAnyway: boolean;
}

interface ReasonCopy {
  label: string;
  detail: string;
  tone: UnavailableTone;
}

/**
 * The live hard gates, as §3.3 names them. `wrong_role` is absent on
 * purpose: it never produces a row on the board (§6).
 */
export const GATE_COPY: Readonly<Record<string, ReasonCopy>> = {
  blocked: {
    label: 'Blocked — compliance',
    detail: 'not compliant, so not invitable',
    tone: 'coral',
  },
  booked_elsewhere: {
    label: 'Booked elsewhere',
    detail: 'confirmed on an overlapping shift, or at a different venue less than 2 h apart',
    tone: 'amber',
  },
  hours_limit: {
    label: 'Hours limit reached',
    detail: 'this shift would take them over their weekly hours limit',
    tone: 'amber',
  },
  rtw_expired: {
    label: 'Right to work expired',
    detail: 'this shift is past their right-to-work expiry',
    tone: 'coral',
  },
  self_cancelled: {
    label: 'Rejected — self-cancelled',
    detail:
      'cancelled a confirmed booking more than 72 h before the shift · permanently excluded from this event: no auto-assign, no Radar, no manual invite',
    tone: 'coral',
  },
  do_not_return: {
    label: 'Do not return',
    detail: 'marked Do not return at this client',
    tone: 'coral',
  },
  // ADR-0042. The label carries the window (`unavailableLabel`); this is
  // the fallback when the window could not be read.
  [CALENDAR_GATE]: {
    label: 'Marked unavailable',
    detail:
      'marked themselves unavailable for this time — auto-assign skips them; you can still invite by hand',
    tone: 'amber',
  },
  // Only once the section has started: the board reads the escalation pool
  // then, as the 10-minute job does (§3.4).
  outside_radius: {
    label: 'Outside the escalation radius',
    detail:
      'the shift has started: the same-day escalation invites only within the radius of the venue set in Settings',
    tone: 'neutral',
  },
};

/**
 * Why a booking on THIS section left the live states — `bookings.cancel_cause`
 * (CANCEL_CAUSES in packages/domain/src/state.ts). Used only when the worker
 * carries no live gate: a gate is the more current reason.
 */
export const CAUSE_COPY: Readonly<Record<string, ReasonCopy>> = {
  office_withdraw: {
    label: 'Withdrawn',
    detail: 'withdrawn from this shift by the office',
    tone: 'neutral',
  },
  ready_cutoff: {
    label: 'Released at the cutoff',
    detail: 'no "I\'m ready" by 12:00 the day before — released at 12:05',
    tone: 'amber',
  },
  self_cancel: GATE_COPY['self_cancelled']!,
  // ADR-0045: offered the shift up and a confirmed replacement took it.
  // Barred from the event like a self-cancel (Q15), but not the same act.
  handed_over: {
    label: 'Handed over',
    detail:
      'offered this shift up and another worker took it · excluded from this event, as after a self-cancel',
    tone: 'neutral',
  },
  // §3.4: overlapping invitations withdrawn at an Accept "move to
  // Unavailable → Booked elsewhere on the event board".
  overlap_auto_withdraw: {
    label: 'Booked elsewhere',
    detail: 'accepted an overlapping shift, so this invitation was withdrawn automatically',
    tone: 'amber',
  },
  event_cancelled: {
    label: 'Event cancelled',
    detail: 'booking cancelled with the event (N12)',
    tone: 'neutral',
  },
  blocked: {
    label: 'Blocked — compliance',
    detail: 'booking cancelled when the worker was blocked',
    tone: 'coral',
  },
  blocked_invite: {
    label: 'Blocked — compliance',
    detail: 'invitation withdrawn when the worker was blocked',
    tone: 'coral',
  },
  left: { label: 'Left THC', detail: 'booking cancelled when they left', tone: 'neutral' },
  left_invite: {
    label: 'Left THC',
    detail: 'invitation withdrawn when they left',
    tone: 'neutral',
  },
  gdpr: { label: 'Account deleted', detail: 'removed at their request', tone: 'neutral' },
  gdpr_invite: {
    label: 'Account deleted',
    detail: 'removed at their request',
    tone: 'neutral',
  },
  slot_taken: {
    label: 'Slot taken',
    detail: 'someone confirmed first, so the invitation closed',
    tone: 'neutral',
  },
  declined: { label: 'Declined', detail: 'declined the invitation', tone: 'neutral' },
  withdrawn_by_worker: {
    label: 'Application withdrawn',
    detail: 'withdrew their Radar application',
    tone: 'neutral',
  },
};

const UNKNOWN_CAUSE: ReasonCopy = {
  label: 'Cancelled',
  detail: 'this booking was cancelled',
  tone: 'neutral',
};

/** Structural reasons first, the way §3.3 lists them; then the booking causes. */
const REASON_ORDER = [
  'blocked',
  'booked_elsewhere',
  'hours_limit',
  'rtw_expired',
  'self_cancelled',
  'do_not_return',
  'outside_radius',
  CALENDAR_GATE,
];

/** One availability entry overlapping the section (`auto_assign_unavailable`). */
export interface UnavailableWindow {
  startsAt: string;
  endsAt: string;
}

function isUkMidnight(instant: Date): boolean {
  return formatTimeIn(instant, UK_ZONE) === '00:00';
}

/**
 * One entry in UK time (§1.8 — the office reads UK): "Thu 12 Oct · all day",
 * "Thu 12 Oct – Sat 14 Oct · all day", "Thu 12 Oct 06:00–09:00 UK",
 * "Thu 12 Oct 22:00 – Fri 13 Oct 02:00 UK". The range is half-open, so an
 * all-day entry's last day is the day before its end.
 */
export function ukWindowLabel(window: UnavailableWindow): string {
  const start = new Date(window.startsAt);
  const end = new Date(window.endsAt);
  const day = (d: Date) => formatDateIn(d, UK_ZONE, { weekday: 'short' });
  if (isUkMidnight(start) && isUkMidnight(end)) {
    const last = new Date(end.getTime() - 1);
    const first = day(start);
    const final = day(last);
    return first === final ? `${first} · all day` : `${first} – ${final} · all day`;
  }
  const from = formatTimeIn(start, UK_ZONE);
  const to = formatTimeIn(end, UK_ZONE);
  return day(start) === day(end)
    ? `${day(start)} ${from}–${to} UK`
    : `${day(start)} ${from} – ${day(end)} ${to} UK`;
}

/** "Marked unavailable · Thu 12 Oct 06:00–09:00 UK" (ADR-0042, docs/19 §1). */
export function unavailableLabel(windows: readonly UnavailableWindow[]): string {
  if (windows.length === 0) return GATE_COPY[CALENDAR_GATE]!.label;
  const sorted = [...windows].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return `Marked unavailable · ${sorted.map(ukWindowLabel).join('; ')}`;
}

/** The confirm in front of Invite anyway, in the spirit of RULE-17's override. */
export function inviteAnywayPrompt(name: string): string {
  return `${name} marked themselves unavailable for this time. Invite anyway?`;
}

export interface EndedBooking {
  staffId: string;
  status: string;
  cancelCause: string | null;
  appliedAt: string | null;
  /** Check-in history or a violation on it: it is never reopened. */
  hasHistory?: boolean;
}

/**
 * The Unavailable list for one role section, computed fresh (§3.4: "not a
 * cached snapshot").
 *
 * Two sources, one row per worker:
 *   * the live hard gates from `auto_assign_candidates` — blocked,
 *     booked elsewhere, hours limit, right to work, self-cancelled, do not
 *     return. `wrong_role` never produces a row (§6).
 *   * this section's cancelled and closed bookings that CANNOT be reopened
 *     — a self-cancel, an event cancellation, a GDPR removal, or a row
 *     with history — labelled by `cancel_cause`, when the worker carries
 *     no live gate. Every other ended booking is invitable again and sits
 *     in the Potential pool with its cause on the row (D33, `buildPool`);
 *     when the pool could not be computed they stay listed here, so
 *     nobody silently disappears.
 *
 * Anyone holding a live booking here (confirmed, invited, worked, turned
 * away, applied) is listed in its own section and is skipped.
 */
export function buildUnavailable(
  rows: readonly CandidateRow[] | null,
  ended: readonly EndedBooking[],
  people: ReadonlyMap<string, BoardPersonName>,
  listedElsewhere: ReadonlySet<string>,
  /** ADR-0042: `auto_assign_unavailable(section)`, by worker. */
  away: ReadonlyMap<string, readonly UnavailableWindow[]> = new Map(),
): UnavailableEntry[] {
  const out = new Map<string, UnavailableEntry>();
  const endedByStaff = new Map(ended.map((b) => [b.staffId, b]));

  for (const row of rows ?? []) {
    if (!row.gate || row.gate === 'wrong_role') continue;
    if (listedElsewhere.has(row.staff_id)) continue;
    // A completed hand-over sets the same event-wide bar as a self-cancel
    // (ADR-0045); where this section's booking says so, say what happened.
    const handedOver =
      row.gate === 'self_cancelled' &&
      endedByStaff.get(row.staff_id)?.cancelCause === 'handed_over';
    const copy = handedOver
      ? CAUSE_COPY['handed_over']!
      : (GATE_COPY[row.gate] ?? { label: row.gate, detail: '', tone: 'neutral' as const });
    out.set(row.staff_id, {
      ...personFor(people, row.staff_id),
      reason: handedOver ? 'handed_over' : row.gate,
      ...copy,
      appliedAt: endedByStaff.get(row.staff_id)?.appliedAt ?? null,
      inviteAnyway: false,
    });
  }

  // ADR-0042: ungated, unbooked (or with an ended booking the office may
  // reopen, D33), and away. Every hard gate is the truer reason, so the
  // calendar only labels a worker nothing else holds back. buildPool leaves
  // exactly these out of the pool, so they must land here.
  for (const row of rows ?? []) {
    if (row.gate !== null) continue;
    if (row.booking_status !== null) {
      const end = endedByStaff.get(row.staff_id);
      if (end === undefined || !officeMayReopen(end)) continue;
    }
    if (listedElsewhere.has(row.staff_id) || out.has(row.staff_id)) continue;
    const windows = away.get(row.staff_id);
    if (!windows) continue;
    out.set(row.staff_id, {
      ...personFor(people, row.staff_id),
      reason: CALENDAR_GATE,
      ...GATE_COPY[CALENDAR_GATE]!,
      label: unavailableLabel(windows),
      appliedAt: null,
      inviteAnyway: true,
    });
  }

  for (const booking of ended) {
    if (out.has(booking.staffId) || listedElsewhere.has(booking.staffId)) continue;
    // Invitable again, so it is in the pool rather than here (D33).
    if (rows !== null && officeMayReopen(booking)) continue;
    const cause = booking.cancelCause ?? '';
    const copy = CAUSE_COPY[cause] ?? UNKNOWN_CAUSE;
    out.set(booking.staffId, {
      ...personFor(people, booking.staffId),
      reason: cause || booking.status,
      ...copy,
      appliedAt: null,
      inviteAnyway: false,
    });
  }

  const order = (reason: string) => {
    const i = REASON_ORDER.indexOf(reason);
    return i === -1 ? REASON_ORDER.length : i;
  };
  return [...out.values()].sort(
    (a, b) => order(a.reason) - order(b.reason) || a.name.localeCompare(b.name, 'en-GB'),
  );
}

// ---------------------------------------------------------------------
// Role header (§3.3, §9.8)
// ---------------------------------------------------------------------

export interface RateLine {
  pay: string;
  /** Base + 12.07% holiday, broken out and never blended (§9.8). */
  final: string;
  charge: string;
  /** "+£9.40/h", or "−£0.50/h" when the charge is under the final rate. */
  margin: string;
  marginTone: 'green' | 'coral';
}

function pounds(pence: number): string {
  return `£${(Math.abs(pence) / 100).toFixed(2)}`;
}

/** "Pay £19.00 · final £21.29 · charge £30.69 · +£9.40/h" (wireframe). */
export function rateLine(payRate: number, chargeRate: number): RateLine {
  const payPence = Math.round(payRate * 100);
  const chargePence = Math.round(chargeRate * 100);
  const marginPence = marginPerHourPence(chargePence, payPence);
  return {
    pay: pounds(payPence),
    final: pounds(finalHourlyPence(payPence)),
    charge: pounds(chargePence),
    margin: `${marginPence < 0 ? '−' : '+'}${pounds(marginPence)}/h`,
    marginTone: marginPence < 0 ? 'coral' : 'green',
  };
}

// ---------------------------------------------------------------------
// Manual invite (§3.3, §3.4) — office_invite_worker's refusals
// ---------------------------------------------------------------------

const INVITE_REFUSAL_COPY: Readonly<Record<string, string>> = {
  event_cancelled: 'This event has been cancelled, so nobody can be invited to it.',
  event_ended: 'This shift has already ended, so nobody can be invited to it.',
  full: 'This role is already fully confirmed (headcount + buffer). Nobody else is invited.',
  // D33: an ended booking is reopened by the invite, so this is only a live
  // one, or an ended one that carries check-in history or a violation.
  already_has_booking:
    'This worker already holds this role — invited, applied, confirmed or checked in — or their earlier booking on it has check-in history, so it cannot be offered again.',
  target_met: 'This role is already fully confirmed (headcount + buffer). Nobody else is invited.',
  auto_assign_off: 'Auto-assign is switched off for this event or role.',
  outside_radius: 'This worker lives outside the same-day escalation radius of the venue.',
  not_bookable: ACCEPT_APPLICATION_REFUSAL_COPY.not_bookable,
  wrong_role: ACCEPT_APPLICATION_REFUSAL_COPY.wrong_role,
  do_not_return: ACCEPT_APPLICATION_REFUSAL_COPY.do_not_return,
  blocked: ACCEPT_APPLICATION_REFUSAL_COPY.blocked,
  self_cancelled: ACCEPT_APPLICATION_REFUSAL_COPY.self_cancelled,
  booked_elsewhere: ACCEPT_APPLICATION_REFUSAL_COPY.booked_elsewhere,
  rtw_expired: ACCEPT_APPLICATION_REFUSAL_COPY.rtw_expired,
  hours_limit: ACCEPT_APPLICATION_REFUSAL_COPY.hours_limit,
};

export function inviteRefusal(reason: string): string {
  return INVITE_REFUSAL_COPY[reason] ?? `The invitation was not sent (${reason || 'unknown'}).`;
}

// ---------------------------------------------------------------------
// Withdraw (§3.3, §3.6) — withdraw_booking's refusals
// ---------------------------------------------------------------------

const WITHDRAW_REFUSAL_COPY: Readonly<Record<string, string>> = {
  checked_in:
    'This worker has already checked in (or been turned away), so the booking cannot be withdrawn.',
  not_withdrawable:
    'This booking is no longer live — it was already withdrawn, declined or cancelled — or it is a Radar application, which the office answers by accepting it or letting the role fill.',
};

export function withdrawRefusal(reason: string): string {
  return WITHDRAW_REFUSAL_COPY[reason] ?? `The worker was not withdrawn (${reason || 'unknown'}).`;
}

/**
 * Whether the auto-assign switches may be pressed (§3.4). Auto-assign
 * stops for a cancelled event (§3.3) and has nothing to fill once every
 * role section is over; before that — including on an Ongoing event,
 * where the 10-minute escalation needs it — the manager may turn it off
 * and on at will.
 */
export function canToggleAutoAssign(status: string): boolean {
  return status === 'upcoming' || status === 'ongoing';
}

// ---------------------------------------------------------------------
// Attendance on a Confirmed row (§3.3 wireframe, §5, §9.5)
// ---------------------------------------------------------------------

/** One check_logs row for a booking, as the board reads it. */
export interface CheckLogRow {
  outcome: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  managerFinishAt: string | null;
}

/** One violations row for a booking, as the board reads it. */
export interface ViolationRow {
  type: string;
  resolved: boolean;
  minutesLate: number | null;
  actualFinishAt: string | null;
}

/** What a Confirmed row says about the worker's day, from check_logs + violations. */
export interface BookingAttendance {
  checkInAt: string | null;
  checkOutAt: string | null;
  lateMinutes: number | null;
  leftEarly: boolean;
  /** An unresolved "No check-out" (RULE-02): payable time is undetermined. */
  noCheckout: boolean;
}

const earliest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);
const latest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * Folds a booking's check logs and violations into what the board shows.
 * The first successful check-in is the arrival; the latest recorded finish
 * — pressed, or manager-entered at a RULE-02 resolution — is the departure.
 */
export function attendanceOf(
  logs: readonly CheckLogRow[],
  violations: readonly ViolationRow[],
): BookingAttendance {
  let checkInAt: string | null = null;
  let checkOutAt: string | null = null;
  for (const log of logs) {
    if (log.outcome === 'checked_in') checkInAt = earliest(checkInAt, log.checkInAt);
    checkOutAt = latest(checkOutAt, log.checkOutAt ?? log.managerFinishAt);
  }
  let lateMinutes: number | null = null;
  let leftEarly = false;
  let noCheckout = false;
  for (const v of violations) {
    if (v.type === 'late') lateMinutes = Math.max(lateMinutes ?? 0, v.minutesLate ?? 0);
    if (v.type === 'left_early') leftEarly = true;
    if (v.type === 'no_checkout') {
      if (v.resolved) checkOutAt = latest(checkOutAt, v.actualFinishAt);
      else noCheckout = true;
    }
  }
  return { checkInAt, checkOutAt, lateMinutes, leftEarly, noCheckout };
}

export type AttendanceKind = 'on_shift' | 'checked_out' | 'no_checkout' | 'late' | 'left_early';

export interface AttendancePill {
  kind: AttendanceKind;
  label: string;
  tone: 'green' | 'amber' | 'coral' | 'neutral';
  /** A time the pill carries ("Checked out 01:34"), rendered viewer-local (§1.8). */
  at?: string;
  /** Where the manager acts on it: a No check-out is resolved in the Violation log. */
  href?: string;
}

/**
 * The attendance pills of a Confirmed row, in the wireframe's order: the
 * state (On shift / Checked out HH:MM / No check-out), then Late and Left
 * early. A worker who has not checked in carries none — the No-show badge
 * is its own (§3.3).
 */
export function attendancePills(a: BookingAttendance): AttendancePill[] {
  const pills: AttendancePill[] = [];
  if (a.noCheckout) {
    pills.push({ kind: 'no_checkout', label: 'No check-out', tone: 'coral', href: '/checkin' });
  } else if (a.checkOutAt) {
    pills.push({ kind: 'checked_out', label: 'Checked out', tone: 'neutral', at: a.checkOutAt });
  } else if (a.checkInAt) {
    pills.push({ kind: 'on_shift', label: 'On shift', tone: 'green' });
  }
  if (a.lateMinutes !== null) {
    pills.push({
      kind: 'late',
      label: a.lateMinutes > 0 ? `Late ${a.lateMinutes} min` : 'Late',
      tone: 'amber',
    });
  }
  if (a.leftEarly) pills.push({ kind: 'left_early', label: 'Left early', tone: 'coral' });
  return pills;
}

/**
 * §3.4: from the section's start until its end the 10-minute escalation
 * owns it, so the board asks for the escalation pool (`p_escalation`) — the
 * radius gate and the proximity order the job itself uses.
 */
export function sectionInEscalation(
  section: { startsAt: string | Date; endsAt: string | Date },
  now: Date = new Date(),
): boolean {
  const starts = new Date(section.startsAt).getTime();
  const ends = new Date(section.endsAt).getTime();
  return now.getTime() >= starts && now.getTime() < ends;
}

/**
 * Whether a role block opens expanded. On an Ongoing event a section whose
 * own window is over starts collapsed, so the manager's eye lands on the
 * roles still running (wireframe: "window ended · collapsed"); everything
 * else starts open. The heading toggles either way.
 */
export function roleBlockOpen(
  section: { endsAt: string | Date },
  status: string,
  now: Date = new Date(),
): boolean {
  if (status !== 'ongoing') return true;
  return now.getTime() <= new Date(section.endsAt).getTime();
}

// ---------------------------------------------------------------------
// Offer up a shift (ADR-0045, docs/19 §4) — what the board shows
// ---------------------------------------------------------------------

/** An open offer on a confirmed booking, as the board reads `shift_offers`. */
export interface BoardOffer {
  offerId: string;
  /** `pool` / `direct`: offered to workers. `office`: a cover request. */
  mode: 'pool' | 'office' | 'direct';
  expiresAt: string;
  note: string | null;
}

/**
 * The chip on a Confirmed row. The worker is still confirmed — fill, the
 * buffer and the client's line-up are unchanged — so it is a chip, never a
 * move to another list: "Offered up · until Sat 20 Sep, 16:00 UK", or
 * "Asked for cover: {note}".
 */
export function offerChip(offer: BoardOffer): { label: string; tone: 'cyan' | 'amber' } {
  if (offer.mode === 'office') {
    const note = offer.note?.trim();
    return { label: note ? `Asked for cover: ${note}` : 'Asked for cover', tone: 'amber' };
  }
  const at = new Date(offer.expiresAt);
  const day = formatDateIn(at, UK_ZONE, { weekday: 'short' });
  return { label: `Offered up · until ${day}, ${formatTimeIn(at, UK_ZONE)} UK`, tone: 'cyan' };
}

/** A completed hand-over on one role section. */
export interface Handover {
  fromName: string;
  toName: string;
  at: string;
}

/** "Handed over: Grace L. → Tom R. · Tue 23 Sep" — per section, UK date. */
export function handedOverLine(handover: Handover): string {
  const day = formatDateIn(new Date(handover.at), UK_ZONE, { weekday: 'short' });
  return `Handed over: ${handover.fromName} → ${handover.toName} · ${day}`;
}

const OFFER_OFFICE_REFUSAL_COPY: Readonly<Record<string, string>> = {
  event_cancelled: 'This event has been cancelled.',
  offer_not_open:
    'This request is no longer open — the worker withdrew it, it lapsed, or it was taken.',
  not_a_cover_request: 'This is already offered to other workers, not a cover request.',
  section_started: 'This shift has already started; the same-day escalation fills it now.',
  original_not_confirmed: 'The worker is no longer confirmed on this shift.',
  note_too_long: 'Keep the note to 300 characters.',
};

/** `office_open_offer_to_pool` / `office_decline_cover` refusals, for the manager. */
export function offerOfficeRefusal(reason: string): string {
  return OFFER_OFFICE_REFUSAL_COPY[reason] ?? `Nothing was changed (${reason || 'unknown'}).`;
}

/** The prompt in front of Decline. The note is the office's own record. */
export const DECLINE_COVER_PROMPT =
  'Decline this cover request? The worker stays booked and is told the office has closed it (OF6). Add a note for the office record (optional):';

/** The confirm in front of Open to pool. */
export const OPEN_TO_POOL_CONFIRM =
  'Open this shift to other workers? It stays theirs until someone takes it, up to the start of the shift.';
