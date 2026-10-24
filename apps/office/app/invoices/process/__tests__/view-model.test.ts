import { describe, expect, it } from 'vitest';
import {
  addEmptyGroup,
  ageDays,
  buildShiftUpdate,
  countRows,
  extractionErrorText,
  filterRows,
  gbp,
  hasWeeklyRows,
  hoursEditable,
  isCleanForApproval,
  isWorking,
  issuedGroupIndexes,
  moveRow,
  removeGroup,
  singleGroup,
  splitByWeek,
  splitGroupAfter,
  stepFor,
  summariseGroup,
  toConfirmed,
  todayInUk,
  ukDate,
  weekStart,
} from '../view-model';
import type { ShiftRow } from '../types';

let n = 0;
function row(over: Partial<ShiftRow> = {}): ShiftRow {
  n += 1;
  return {
    id: `s${n}`,
    fileId: 'f1',
    sort: n,
    kind: 'shift',
    status: 'extracted',
    staffName: 'Ana Smith',
    staffRef: '1042',
    workDate: '2026-10-19',
    roleName: 'Waiting',
    startTime: '10:00',
    endTime: '18:00',
    breakMin: 30,
    hours: 7.5,
    staffCount: 1,
    quantity: null,
    description: null,
    rate: 18.98,
    amount: 142.35,
    issues: [],
    confidence: null,
    source: null,
    invoiceId: null,
    ...over,
  };
}

describe('the stepper follows the job status', () => {
  it('maps every status to a step', () => {
    expect(stepFor('uploaded')).toEqual({ current: 0, phase: 'processing' });
    expect(stepFor('extracting')).toEqual({ current: 1, phase: 'processing' });
    expect(stepFor('error')).toEqual({ current: 1, phase: 'error' });
    expect(stepFor('reviewing')).toEqual({ current: 1, phase: 'review' });
    expect(stepFor('reviewing', 'confirm')).toEqual({ current: 2, phase: 'confirm' });
    expect(stepFor('confirmed')).toEqual({ current: 3, phase: 'generate' });
    expect(stepFor('complete')).toEqual({ current: 4, phase: 'done' });
  });

  it('?step=confirm cannot pull a job that is not in review back to Confirm', () => {
    expect(stepFor('confirmed', 'confirm').phase).toBe('generate');
    expect(stepFor('complete', 'confirm').phase).toBe('done');
  });

  it('only a job being read refreshes itself', () => {
    expect(isWorking('uploaded')).toBe(true);
    expect(isWorking('extracting')).toBe(true);
    expect(isWorking('reviewing')).toBe(false);
    expect(isWorking('error')).toBe(false);
  });

  it('puts extraction codes into words', () => {
    expect(extractionErrorText('no_rows_found')).toContain('No timesheet rows');
    expect(extractionErrorText('some_new_code')).toContain('could not be read');
    expect(extractionErrorText('Azure said no.')).toBe('Azure said no.');
    expect(extractionErrorText(null)).toContain('could not be read');
  });
});

describe('Review counters, chips and Approve all clean', () => {
  const rows = [
    row({ status: 'approved', hours: 8, amount: 100.1, staffCount: 1 }),
    row({ status: 'approved', hours: 4, amount: 50.05, staffCount: 2 }),
    row({ status: 'flagged', issues: ['no_rate'], amount: null }),
    row({ status: 'extracted', confidence: 0.9 }),
    row({ status: 'extracted', confidence: 0.4 }),
    row({ status: 'rejected' }),
  ];

  it('counts by status and totals only approved rows', () => {
    const c = countRows(rows);
    expect(c).toMatchObject({ total: 6, approved: 2, flagged: 1, extracted: 2, rejected: 1 });
    expect(c.approvedHours).toBe(16); // 8 + 4 × 2 staff
    expect(c.approvedTotal).toBe(150.15);
  });

  it('cleans only rows with no issues and a confident (or exact) reading', () => {
    expect(isCleanForApproval(row({ confidence: 0.75 }))).toBe(true);
    expect(isCleanForApproval(row({ confidence: null }))).toBe(true);
    expect(isCleanForApproval(row({ confidence: 0.74 }))).toBe(false);
    expect(isCleanForApproval(row({ issues: ['no_hours'] }))).toBe(false);
    expect(isCleanForApproval(row({ status: 'approved' }))).toBe(false);
    expect(isCleanForApproval(row({ status: 'rejected' }))).toBe(false);
    expect(isCleanForApproval(row({ invoiceId: 'inv' }))).toBe(false);
    expect(countRows(rows).clean).toBe(1);
  });

  it('filters by chip', () => {
    expect(filterRows(rows, 'all')).toHaveLength(6);
    expect(filterRows(rows, 'approved')).toHaveLength(2);
    expect(filterRows(rows, 'flagged')).toHaveLength(1);
  });

  it('weekly rows have no clock times; only they take typed hours', () => {
    const weekly = row({ startTime: null, endTime: null, hours: 21.5 });
    expect(hasWeeklyRows([row(), weekly])).toBe(true);
    expect(hasWeeklyRows([row()])).toBe(false);
    expect(hoursEditable(weekly)).toBe(true);
    expect(hoursEditable(row())).toBe(false);
    expect(hoursEditable({ ...weekly, invoiceId: 'x' })).toBe(false);
  });
});

describe('editing a row', () => {
  it('a changed role clears the rate so the rate card prices it again', () => {
    const r = buildShiftUpdate(row(), { roleName: 'Bar Staff' });
    expect(r).toEqual({ ok: true, set: { role_name: 'Bar Staff', rate: null } });
  });

  it('a typed rate with the role keeps the typed rate', () => {
    const r = buildShiftUpdate(row(), { roleName: 'Bar Staff', rate: 20 });
    expect(r).toEqual({ ok: true, set: { role_name: 'Bar Staff', rate: 20 } });
  });

  it('maps times, dates and breaks to columns and rejects nonsense', () => {
    expect(
      buildShiftUpdate(row(), { startTime: '17:30', breakMin: 45, workDate: '2026-10-20' }),
    ).toEqual({
      ok: true,
      set: { start_time: '17:30', break_min: 45, work_date: '2026-10-20' },
    });
    expect(buildShiftUpdate(row(), { startTime: '25:00' })).toMatchObject({ ok: false });
    expect(buildShiftUpdate(row(), { breakMin: -5 })).toMatchObject({ ok: false });
    expect(buildShiftUpdate(row(), { breakMin: 2.5 })).toMatchObject({ ok: false });
    expect(buildShiftUpdate(row(), { workDate: '2026-02-30' })).toMatchObject({ ok: false });
    expect(buildShiftUpdate(row(), { rate: -1 })).toMatchObject({ ok: false });
    expect(buildShiftUpdate(row(), { staffCount: 0 })).toMatchObject({ ok: false });
  });

  it('hours are typed only where there are no start and end', () => {
    expect(buildShiftUpdate(row(), { hours: 8 })).toMatchObject({ ok: false });
    const weekly = row({ startTime: null, endTime: null });
    expect(buildShiftUpdate(weekly, { hours: 21.5 })).toEqual({ ok: true, set: { hours: 21.5 } });
    // adding a start time at the same time as typing hours is refused: the DB would overwrite them
    expect(buildShiftUpdate(weekly, { hours: 8, startTime: '10:00' })).toMatchObject({ ok: false });
  });

  it('an invoiced row cannot change', () => {
    expect(buildShiftUpdate(row({ invoiceId: 'inv' }), { staffName: 'X' })).toMatchObject({
      ok: false,
    });
  });

  it('an empty patch is not a write', () => {
    expect(buildShiftUpdate(row(), {})).toMatchObject({ ok: false });
  });

  it('clearing a text cell stores null, not an empty string, where null is meant', () => {
    expect(buildShiftUpdate(row(), { staffRef: '  ' })).toEqual({
      ok: true,
      set: { staff_ref: null },
    });
    expect(buildShiftUpdate(row(), { startTime: '' })).toEqual({
      ok: true,
      set: { start_time: null },
    });
    expect(buildShiftUpdate(row(), { staffName: '' })).toEqual({
      ok: true,
      set: { staff_name: '' },
    });
  });
});

describe('Confirm groups', () => {
  const defaults = { invoiceDate: '2026-10-26', format: 'named' as const };
  const monday = row({ workDate: '2026-10-19' });
  const wednesday = row({ workDate: '2026-10-21' });
  const nextMonday = row({ workDate: '2026-10-26' });
  const undated = row({ workDate: null });
  const all = [monday, wednesday, nextMonday, undated];
  const byId = new Map(all.map((r) => [r.id, r]));

  it('is ONE invoice by default, dated to the rows', () => {
    const [g] = singleGroup(all, defaults);
    expect(g).toMatchObject({
      invoiceDate: '2026-10-26',
      eventDateStart: '2026-10-19',
      eventDateEnd: '2026-10-26',
      format: 'named',
      poNumber: '',
    });
    expect(g!.shiftIds).toHaveLength(4);
    expect(singleGroup([], defaults)).toEqual([]);
  });

  it('splits by Monday–Sunday week, undated rows joining the first', () => {
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // a Sunday
    expect(weekStart('2026-10-26')).toBe('2026-10-26');
    const groups = splitByWeek(all, defaults);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.shiftIds).toEqual([undated.id, monday.id, wednesday.id]);
    expect(groups[1]!.shiftIds).toEqual([nextMonday.id]);
    expect(groups[1]).toMatchObject({ eventDateStart: '2026-10-26', eventDateEnd: '2026-10-26' });
  });

  it('splits one group after a date into two, keeping the PO and format', () => {
    const [g] = singleGroup(all, defaults);
    const one = { ...g!, poNumber: 'PO1', format: 'aggregated' as const };
    const out = splitGroupAfter([one], 0, '2026-10-21', byId, defaults);
    expect(out).toHaveLength(2);
    expect(out[0]!.shiftIds).toEqual([monday.id, wednesday.id, undated.id]);
    expect(out[0]).toMatchObject({ poNumber: 'PO1', eventDateEnd: '2026-10-21' });
    expect(out[1]!.shiftIds).toEqual([nextMonday.id]);
    expect(out[1]).toMatchObject({ format: 'aggregated', poNumber: '' });
    // a split that would leave a side empty changes nothing
    expect(splitGroupAfter([one], 0, '2026-12-01', byId, defaults)).toHaveLength(1);
  });

  it('moves a row between invoices and the dates follow unless they were typed', () => {
    const [a, b] = addEmptyGroup(singleGroup(all, defaults), defaults).map((x, i) =>
      i === 0 ? x : x,
    );
    const moved = moveRow([a!, b!], nextMonday.id, b!.key, byId);
    expect(moved[0]!.shiftIds).not.toContain(nextMonday.id);
    expect(moved[0]!.eventDateEnd).toBe('2026-10-21');
    expect(moved[1]).toMatchObject({ shiftIds: [nextMonday.id], eventDateStart: '2026-10-26' });
    const typed = moveRow([{ ...a!, datesEdited: true }, b!], nextMonday.id, b!.key, byId);
    expect(typed[0]!.eventDateEnd).toBe('2026-10-26');
  });

  it('only an empty invoice can be removed', () => {
    const groups = addEmptyGroup(singleGroup(all, defaults), defaults);
    expect(removeGroup(groups, groups[1]!.key)).toHaveLength(1);
    expect(removeGroup(groups, groups[0]!.key)).toHaveLength(2);
  });

  it('sends the RPC shape and nothing else', () => {
    const [g] = singleGroup([monday], defaults);
    expect(toConfirmed([{ ...g!, poNumber: ' 5225 ' }])).toEqual([
      {
        poNumber: '5225',
        invoiceDate: '2026-10-26',
        eventDateStart: '2026-10-19',
        eventDateEnd: '2026-10-19',
        format: 'named',
        shiftIds: [monday.id],
      },
    ]);
  });
});

describe('group totals (ADR-0210 §4: round per line, VAT on the subtotal)', () => {
  it('adds the printed lines in pence and takes VAT once', () => {
    const lines = [row({ amount: 33.33 }), row({ amount: 33.33 }), row({ amount: 33.34 })];
    expect(summariseGroup(lines, 20)).toEqual({
      rows: 3,
      hours: 22.5,
      subtotal: 100,
      vat: 20,
      total: 120,
    });
  });

  it('does not drift on 0.1 + 0.2 style sums', () => {
    const s = summariseGroup([row({ amount: 0.1 }), row({ amount: 0.2 })], 20);
    expect(s.subtotal).toBe(0.3);
    expect(s.vat).toBe(0.06);
    expect(s.total).toBe(0.36);
  });

  it('multiplies hours by staff and ignores expense lines in hours', () => {
    const s = summariseGroup(
      [
        row({ hours: 4, staffCount: 3, amount: 10 }),
        row({ kind: 'custom', hours: null, quantity: 2, amount: 8 }),
      ],
      20,
    );
    expect(s.hours).toBe(12);
    expect(s.subtotal).toBe(18);
  });
});

describe('Generate', () => {
  it('a confirmed group is issued once any of its rows carries an invoice', () => {
    const groups = [
      {
        poNumber: '',
        invoiceDate: '',
        eventDateStart: '',
        eventDateEnd: '',
        format: 'named' as const,
        shiftIds: ['a', 'b'],
      },
      {
        poNumber: '',
        invoiceDate: '',
        eventDateStart: '',
        eventDateEnd: '',
        format: 'named' as const,
        shiftIds: ['c'],
      },
    ];
    expect([...issuedGroupIndexes(groups, new Map([['b', 'inv1']]))]).toEqual([0]);
    expect(issuedGroupIndexes(groups, new Map()).size).toBe(0);
  });
});

describe('display helpers', () => {
  it('writes UK dates and money', () => {
    expect(ukDate('2026-10-19')).toBe('19/10/2026');
    expect(ukDate(null)).toBe('—');
    expect(gbp(3004.55)).toBe('£3,004.55');
    expect(gbp(null)).toBe('—');
  });

  it("today is the UK day, not UTC's", () => {
    expect(todayInUk(new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25'); // 00:30 BST on the 25th
  });

  it('ages a job in whole days', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    expect(ageDays('2026-10-10T12:00:00Z', now)).toBe(14);
    expect(ageDays('2026-10-24T08:00:00Z', now)).toBe(0);
  });
});
