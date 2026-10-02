import { describe, expect, it } from 'vitest';
import {
  addDays,
  autosendDueAt,
  autosendHint,
  autosendVerdict,
  completedStopAt,
  parseAutosendConfig,
} from '../schedule';
import type { AutosendFacts } from '../schedule';

/**
 * ADR-0074's rule, case by case. The same cases run against the SQL twin,
 * document_autosend_verdict(), in supabase/tests/760_document_autosend.sql —
 * keep the two lists in step.
 */
const CONFIG = parseAutosendConfig({
  allocation: { enabled: true, time: '16:00' },
  completed: { enabled: true, time: '10:00', hold_days: 14 },
});

/** Sat 11 Jul 2026, BST: Chef 07:00 → Waiting 22:30 UK. */
const SUMMER: AutosendFacts = {
  kind: 'allocation',
  eventDate: '2026-07-11',
  firstStart: '2026-07-11T06:00:00Z',
  lastEnd: '2026-07-11T21:30:00Z',
  cancelled: false,
  confirmed: 6,
  contacts: 2,
  undetermined: 0,
  manualAllocationAt: null,
  signoutQueuedAt: null,
  autoQueuedAt: null,
};

/** Sat 5 Dec 2026, GMT: 18:00 → 23:30 UK. */
const WINTER: AutosendFacts = {
  ...SUMMER,
  eventDate: '2026-12-05',
  firstStart: '2026-12-05T18:00:00Z',
  lastEnd: '2026-12-05T23:30:00Z',
};

const d1 = (facts: Partial<AutosendFacts>, now: string) =>
  autosendVerdict({ ...SUMMER, ...facts, kind: 'allocation' }, new Date(now), CONFIG);
const d2 = (facts: Partial<AutosendFacts>, now: string, config = CONFIG) =>
  autosendVerdict({ ...SUMMER, ...facts, kind: 'signout' }, new Date(now), config);

describe('D1 · Allocation Timesheet, the day before at 16:00 UK', () => {
  it('is not due at 15:59:59 the day before, and due at 16:00 (BST: 15:00Z)', () => {
    expect(d1({}, '2026-07-10T14:59:59Z')).toBe('not_yet');
    expect(d1({}, '2026-07-10T15:00:00Z')).toBe('due');
  });

  it('in GMT, 16:00 UK is 16:00Z', () => {
    const w = (now: string) =>
      autosendVerdict({ ...WINTER, kind: 'allocation' }, new Date(now), CONFIG);
    expect(w('2026-12-04T15:59:00Z')).toBe('not_yet');
    expect(w('2026-12-04T16:00:00Z')).toBe('due');
  });

  it('catches up an event created or filled late — any run before the first shift starts', () => {
    expect(d1({}, '2026-07-10T22:45:00Z')).toBe('due');
    expect(d1({}, '2026-07-11T05:59:00Z')).toBe('due');
  });

  it('never goes once the first shift has started', () => {
    expect(d1({}, '2026-07-11T06:00:00Z')).toBe('too_late');
    expect(d1({}, '2026-07-11T12:00:00Z')).toBe('too_late');
  });

  it('is skipped when a manager queued a D1 since 00:00 UK the day before', () => {
    // 00:00 BST on Fri 10 Jul = 23:00Z on the 9th.
    expect(d1({ manualAllocationAt: '2026-07-09T23:00:00Z' }, '2026-07-10T15:00:00Z')).toBe(
      'manual_sent',
    );
    expect(d1({ manualAllocationAt: '2026-07-10T09:12:00Z' }, '2026-07-10T15:00:00Z')).toBe(
      'manual_sent',
    );
    // A week-old manual copy is not "fresh": the automatic one still goes.
    expect(d1({ manualAllocationAt: '2026-07-09T22:59:00Z' }, '2026-07-10T15:00:00Z')).toBe('due');
  });

  it('skips a cancelled event, no confirmed staff, and a client card with no contact emails', () => {
    expect(d1({ cancelled: true }, '2026-07-10T15:00:00Z')).toBe('cancelled');
    expect(d1({ confirmed: 0 }, '2026-07-10T15:00:00Z')).toBe('no_confirmed_staff');
    expect(d1({ contacts: 0 }, '2026-07-10T15:00:00Z')).toBe('no_contact_emails');
  });

  it('an event with no role sections at all has nobody confirmed', () => {
    expect(d1({ firstStart: null, lastEnd: null, confirmed: 0 }, '2026-07-10T15:00:00Z')).toBe(
      'no_confirmed_staff',
    );
  });

  it('goes once: already sent automatically is final', () => {
    expect(d1({ autoQueuedAt: '2026-07-10T15:00:05Z' }, '2026-07-10T15:15:00Z')).toBe(
      'already_sent',
    );
  });

  it('gives up after eight spent claims — a fault never retries for ever', () => {
    expect(d1({ attempts: 7 }, '2026-07-10T15:00:00Z')).toBe('due');
    expect(d1({ attempts: 8 }, '2026-07-10T15:00:00Z')).toBe('gave_up');
  });

  it('can be switched off in settings', () => {
    const off = parseAutosendConfig({ allocation: { enabled: false } });
    expect(
      autosendVerdict({ ...SUMMER, kind: 'allocation' }, new Date('2026-07-10T15:00:00Z'), off),
    ).toBe('disabled');
  });

  it('reads its time from settings', () => {
    const at16 = parseAutosendConfig({ allocation: { time: '16:30' } });
    const v = (now: string) =>
      autosendVerdict({ ...SUMMER, kind: 'allocation' }, new Date(now), at16);
    expect(v('2026-07-10T15:29:00Z')).toBe('not_yet');
    expect(v('2026-07-10T15:30:00Z')).toBe('due');
  });
});

describe('D2 · Completed Allocation Timesheet, the morning after at 10:00 UK', () => {
  it('is not due at 09:59 UK the morning after, and due at 10:00 (BST: 09:00Z)', () => {
    expect(d2({}, '2026-07-12T08:59:00Z')).toBe('not_yet');
    expect(d2({}, '2026-07-12T09:00:00Z')).toBe('due');
  });

  it('waits for the last check-out window (end + 4 h) when a shift runs into the morning', () => {
    const late = { lastEnd: '2026-07-12T06:00:00Z' }; // 07:00 BST → windows close 11:00 BST
    expect(d2(late, '2026-07-12T09:30:00Z')).toBe('not_yet');
    expect(d2(late, '2026-07-12T10:00:00Z')).toBe('due');
  });

  it('is held while a No check-out is unresolved, and goes on the first run after', () => {
    expect(d2({ undetermined: 1 }, '2026-07-12T09:00:00Z')).toBe('held_no_checkout');
    expect(d2({ undetermined: 0 }, '2026-07-14T15:15:00Z')).toBe('due');
  });

  it('stops trying 14 days after the morning it was due', () => {
    // Sun 26 Jul 10:00 BST = 09:00Z.
    expect(completedStopAt('2026-07-11', CONFIG).toISOString()).toBe('2026-07-26T09:00:00.000Z');
    expect(d2({ undetermined: 1 }, '2026-07-26T08:59:00Z')).toBe('held_no_checkout');
    expect(d2({ undetermined: 0 }, '2026-07-26T08:59:00Z')).toBe('due');
    expect(d2({ undetermined: 0 }, '2026-07-26T09:00:00Z')).toBe('hold_expired');
  });

  it('is skipped when a D2 was queued after the event ended — but not for a mid-event copy', () => {
    expect(d2({ signoutQueuedAt: '2026-07-11T23:10:00Z' }, '2026-07-12T09:00:00Z')).toBe(
      'manual_sent',
    );
    expect(d2({ signoutQueuedAt: '2026-07-11T18:00:00Z' }, '2026-07-12T09:00:00Z')).toBe('due');
  });

  it('skips a cancelled event, no confirmed staff and no contact emails', () => {
    expect(d2({ cancelled: true }, '2026-07-12T09:00:00Z')).toBe('cancelled');
    expect(d2({ confirmed: 0 }, '2026-07-12T09:00:00Z')).toBe('no_confirmed_staff');
    expect(d2({ contacts: 0 }, '2026-07-12T09:00:00Z')).toBe('no_contact_emails');
  });

  it('gives up after eight spent claims, but a hold is reported first', () => {
    expect(d2({ attempts: 8 }, '2026-07-12T09:00:00Z')).toBe('gave_up');
    expect(d2({ attempts: 8, undetermined: 1 }, '2026-07-12T09:00:00Z')).toBe('held_no_checkout');
  });

  it('goes once', () => {
    expect(d2({ autoQueuedAt: '2026-07-12T09:00:04Z' }, '2026-07-12T09:15:00Z')).toBe(
      'already_sent',
    );
  });

  it('does not reach back past the moment the feature was switched on', () => {
    const on = parseAutosendConfig({ completed: { not_before: '2026-07-12T12:00:00Z' } });
    expect(d2({}, '2026-07-12T12:15:00Z', on)).toBe('before_activation');
    const earlier = parseAutosendConfig({ completed: { not_before: '2026-07-12T08:00:00Z' } });
    expect(d2({}, '2026-07-12T12:15:00Z', earlier)).toBe('due');
  });

  it('in GMT, 10:00 UK is 10:00Z', () => {
    const w = (now: string) =>
      autosendVerdict({ ...WINTER, kind: 'signout' }, new Date(now), CONFIG);
    expect(w('2026-12-06T09:59:00Z')).toBe('not_yet');
    expect(w('2026-12-06T10:00:00Z')).toBe('due');
  });
});

describe('the clock-change weekends (Europe/London)', () => {
  it('October: BST ends on Sun 25 Oct 2026', () => {
    // Sunday event: D1 is Sat 24 Oct 16:00 BST (15:00Z); D2 Mon 26 Oct 10:00 GMT (10:00Z).
    const facts = { eventDate: '2026-10-25', lastEnd: '2026-10-25T20:00:00Z' };
    expect(autosendDueAt('allocation', facts, CONFIG).toISOString()).toBe(
      '2026-10-24T15:00:00.000Z',
    );
    expect(autosendDueAt('signout', facts, CONFIG).toISOString()).toBe('2026-10-26T10:00:00.000Z');
    // Monday event: D1 on the Sunday of the change, 16:00 GMT.
    expect(
      autosendDueAt('allocation', { eventDate: '2026-10-26', lastEnd: null }, CONFIG).toISOString(),
    ).toBe('2026-10-25T16:00:00.000Z');
  });

  it('March: BST starts on Sun 29 Mar 2026', () => {
    const facts = { eventDate: '2026-03-29', lastEnd: '2026-03-29T20:00:00Z' };
    expect(autosendDueAt('allocation', facts, CONFIG).toISOString()).toBe(
      '2026-03-28T16:00:00.000Z',
    );
    expect(autosendDueAt('signout', facts, CONFIG).toISOString()).toBe('2026-03-30T09:00:00.000Z');
    expect(
      autosendDueAt('allocation', { eventDate: '2026-03-30', lastEnd: null }, CONFIG).toISOString(),
    ).toBe('2026-03-29T15:00:00.000Z');
  });

  it('the manual-D1 cut-off is 00:00 UK on the day before, on either side of a change', () => {
    // Event Mon 26 Oct: the day before is Sun 25 Oct, whose 00:00 is still BST (24 Oct 23:00Z).
    const facts = {
      ...SUMMER,
      kind: 'allocation' as const,
      eventDate: '2026-10-26',
      firstStart: '2026-10-26T18:00:00Z',
      lastEnd: '2026-10-26T23:00:00Z',
    };
    const now = new Date('2026-10-25T16:00:00Z');
    expect(
      autosendVerdict({ ...facts, manualAllocationAt: '2026-10-24T23:00:00Z' }, now, CONFIG),
    ).toBe('manual_sent');
    expect(
      autosendVerdict({ ...facts, manualAllocationAt: '2026-10-24T22:59:00Z' }, now, CONFIG),
    ).toBe('due');
  });
});

describe('settings', () => {
  it('fills the defaults, and ignores a malformed time rather than sending at midnight', () => {
    expect(parseAutosendConfig(null)).toEqual({
      allocation: { enabled: true, time: '16:00' },
      completed: { enabled: true, time: '10:00', holdDays: 14, notBefore: null },
      update: { enabled: true, gapMinutes: 60 },
    });
    expect(parseAutosendConfig({ update: { gap_minutes: 30 } }).update.gapMinutes).toBe(30);
    // The SQL twin's range: a quarter-hour to a day, a JSON number.
    expect(parseAutosendConfig({ update: { gap_minutes: 5 } }).update.gapMinutes).toBe(60);
    expect(parseAutosendConfig({ update: { gap_minutes: '30' } }).update.gapMinutes).toBe(60);
    expect(parseAutosendConfig({ allocation: { time: '2pm' } }).allocation.time).toBe('16:00');
    expect(parseAutosendConfig({ completed: { hold_days: -3 } }).completed.holdDays).toBe(14);
    expect(parseAutosendConfig({ completed: { hold_days: 7 } }).completed.holdDays).toBe(7);
    // The SQL twin reads only a JSON number and a JSON boolean; so does this.
    expect(parseAutosendConfig({ completed: { hold_days: '7' } }).completed.holdDays).toBe(14);
    expect(parseAutosendConfig({ allocation: { enabled: 'false' } }).allocation.enabled).toBe(true);
  });

  it('adds calendar days across a month end', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('the hint under the event page buttons', () => {
  it('says when the automatic send happens, and when it happened (UK)', () => {
    const idle = { sentAt: null, started: false, ended: false };
    expect(autosendHint('allocation', CONFIG, idle)).toBe(
      'Sent automatically the day before at 16:00 (UK time) · and again if the line-up or times change (at most hourly)',
    );
    expect(autosendHint('allocation', CONFIG, { ...idle, sentAt: '2026-09-28T15:00:04Z' })).toBe(
      'Allocation Timesheet sent automatically 28/09 16:00 · and again if the line-up or times change (at most hourly)',
    );
    // ADR-0084: and when it was last updated.
    expect(
      autosendHint('allocation', CONFIG, {
        ...idle,
        sentAt: '2026-09-28T15:00:04Z',
        updatedAt: '2026-09-28T17:15:02Z',
      }),
    ).toBe(
      'Allocation Timesheet sent automatically 28/09 16:00 · updated automatically 28/09 18:15',
    );
    expect(autosendHint('allocation', CONFIG, { ...idle, updatedAt: '2026-09-28T17:15:02Z' })).toBe(
      'Sent automatically the day before at 16:00 (UK time) · updated automatically 28/09 18:15',
    );
    expect(
      autosendHint('allocation', parseAutosendConfig({ allocation: { enabled: false } }), idle),
    ).toBe(
      'Re-sent automatically if the line-up or times change after it is sent (at most hourly)',
    );
    const noUpdates = parseAutosendConfig({ update: { enabled: false } });
    expect(autosendHint('allocation', noUpdates, idle)).toBe(
      'Sent automatically the day before at 16:00 (UK time)',
    );
    expect(
      autosendHint('signout', CONFIG, {
        sentAt: '2026-09-21T09:00:03Z',
        started: true,
        ended: true,
      }),
    ).toBe('Completed Timesheet sent automatically 21/09 10:00');
  });

  it('says nothing once the moment has passed without one', () => {
    expect(autosendHint('allocation', CONFIG, { sentAt: null, started: true, ended: false })).toBe(
      null,
    );
  });

  it('points the Completed Timesheet at invoicing while D2 is off (ADR-0083)', () => {
    const off = parseAutosendConfig({ completed: { enabled: false } });
    const ended = { sentAt: null, started: true, ended: true };
    expect(autosendHint('signout', off, ended)).toBe(
      'Completed Timesheet goes to the client with the invoice (Reports › Financial)',
    );
    const queued = { ...ended, queuedAt: '2026-10-06T08:12:00Z' };
    expect(autosendHint('signout', off, queued)).toBe(
      'Completed Timesheet queued for the client 06/10 09:12',
    );
    expect(autosendHint('signout', off, { ...queued, deliveredAt: '2026-10-06T08:13:00Z' })).toBe(
      'Completed Timesheet sent to the client 06/10 09:13',
    );
    // A copy the job sent before the switch went off still says so.
    expect(autosendHint('signout', off, { ...ended, sentAt: '2026-09-21T09:00:03Z' })).toBe(
      'Completed Timesheet sent automatically 21/09 10:00',
    );
  });
});

/**
 * ADR-0084: the re-send of a changed Allocation Timesheet. The same cases
 * as 772_allocation_timesheet_update.sql — keep the two lists in step.
 * Sat 11 Jul 2026, first shift 07:00 BST; a copy queued Fri 16:00 BST.
 */
describe('Update · a changed Allocation Timesheet, at most once an hour', () => {
  const u = (facts: Partial<AutosendFacts>, now: string, config = CONFIG) =>
    autosendVerdict(
      {
        ...SUMMER,
        confirmed: 3,
        allocationSentAt: '2026-07-10T15:00:00Z',
        changed: true,
        ...facts,
        kind: 'allocation_update',
      },
      new Date(now),
      config,
    );

  it('waits an hour after the last copy, then goes', () => {
    expect(u({}, '2026-07-10T15:59:00Z')).toBe('too_soon');
    expect(u({}, '2026-07-10T16:00:00Z')).toBe('due');
    expect(
      u({}, '2026-07-10T15:30:00Z', parseAutosendConfig({ update: { gap_minutes: 30 } })),
    ).toBe('due');
    expect(u({}, '2026-07-10T15:30:00Z', parseAutosendConfig({ update: { gap_minutes: 5 } }))).toBe(
      'too_soon',
    );
  });

  it('sends nothing when the sheet would print the same, or there is nothing to compare', () => {
    expect(u({ changed: false }, '2026-07-10T16:00:00Z')).toBe('unchanged');
    expect(u({ changed: null }, '2026-07-10T16:00:00Z')).toBe('no_baseline');
  });

  it('only follows a copy queued since 00:00 UK the day before — never the 16:00 send itself', () => {
    expect(u({ allocationSentAt: null }, '2026-07-10T16:00:00Z')).toBe('not_sent_yet');
    expect(u({ allocationSentAt: '2026-07-09T22:59:00Z' }, '2026-07-10T16:00:00Z')).toBe(
      'not_sent_yet',
    );
    expect(u({ allocationSentAt: '2026-07-09T23:00:00Z' }, '2026-07-10T16:00:00Z')).toBe('due');
  });

  it('stops once the first shift has started', () => {
    expect(u({ allocationSentAt: '2026-07-11T04:00:00Z' }, '2026-07-11T06:00:00Z')).toBe(
      'too_late',
    );
  });

  it('skips a cancelled event, an empty line-up, no contacts, and gives up after eight claims', () => {
    expect(u({ cancelled: true }, '2026-07-10T16:00:00Z')).toBe('cancelled');
    expect(u({ confirmed: 0 }, '2026-07-10T16:00:00Z')).toBe('no_confirmed_staff');
    expect(u({ contacts: 0 }, '2026-07-10T16:00:00Z')).toBe('no_contact_emails');
    expect(u({ attempts: 8 }, '2026-07-10T16:00:00Z')).toBe('gave_up');
    expect(u({}, '2026-07-10T16:00:00Z', parseAutosendConfig({ update: { enabled: false } }))).toBe(
      'disabled',
    );
  });
});
