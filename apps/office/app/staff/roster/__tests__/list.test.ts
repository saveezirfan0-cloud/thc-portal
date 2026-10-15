import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '../data';
import {
  bySurname,
  filterRoster,
  parseRosterFilter,
  rosterCsv,
  rosterExportHref,
  rosterFileName,
  isFiltered,
  reasonCounts,
  rosterIndex,
  standingCounts,
} from '../list';
import { keptExplanation, keptLinkable, parseRosterReport } from '../report';

/**
 * ADR-0138 · the invite list's filter and export: the screen and the CSV
 * route cut the list the same way, and the file opens cleanly in Excel.
 */
const row = (over: Partial<RosterEntry> & Pick<RosterEntry, 'id' | 'email'>): RosterEntry => ({
  first_name: null,
  last_name: null,
  payroll_id: null,
  grp: 'spudbros',
  loaded_at: '2026-10-08T14:55:12Z',
  ...over,
});

const rows: RosterEntry[] = [
  row({
    id: 'w1',
    email: 'daisy@x.co',
    first_name: 'Daisy',
    last_name: 'Marsden',
    payroll_id: '4016',
  }),
  row({
    id: 'w2',
    email: 'josh@x.co',
    first_name: 'Joshua',
    last_name: 'Allen',
    payroll_id: '5171',
  }),
  row({ id: 'a1', email: 'kept@x.co', first_name: 'Kept', last_name: 'Here' }),
  row({ id: 'm1', email: 'old@x.co', first_name: 'Sam', last_name: 'Spud' }),
  row({ id: 't1', email: 'thc@x.co', first_name: 'Tia', last_name: 'Cole', grp: 'thc' }),
];

const report = parseRosterReport({
  reminders: { 'thc@x.co': { sent: 3, lastSentAt: '2026-10-14T09:10:00Z', lastError: null } },
  applied: ['a1'],
  kept: [
    {
      entryId: 'a1',
      staffId: 's9',
      staffName: 'Kept Hereford',
      staffEmail: 'kept@x.co',
      status: 'interview_requested',
      staffPayrollId: null,
      reason: 'name_differs',
      holderId: null,
      holderName: null,
    },
    // A reason for a row the report does not call applied is never shown.
    { entryId: 'w1', staffId: 's8', reason: 'not_applied' },
    // Nor one the page does not know.
    { entryId: 'a1', staffId: 's7', reason: 'gremlins' },
  ],
  matches: [
    {
      entryId: 'm1',
      staffId: 's1',
      staffName: 'Sam Spud',
      staffEmail: 'new@x.co',
      status: 'documents',
      appliedAt: '2026-10-09T10:00:00Z',
    },
  ],
});
const index = rosterIndex(report);

describe('the invite list filter', () => {
  it('tells apart not applied, possible match and applied', () => {
    expect(rows.map((r) => index.standing(r))).toEqual([
      'waiting',
      'waiting',
      'applied',
      'match',
      'waiting',
    ]);
  });

  it('SpudBros who have not applied: neither applied with the email nor a possible match', () => {
    const shown = filterRoster(
      rows,
      parseRosterFilter({ grp: 'spudbros', status: 'waiting' }),
      index,
    );
    expect(shown.map((r) => r.id)).toEqual(['w1', 'w2']);
  });

  it('searches name, email and Payroll ID', () => {
    const f = (q: string) => filterRoster(rows, parseRosterFilter({ q }), index).map((r) => r.id);
    expect(f('marsden')).toEqual(['w1']);
    expect(f('JOSH@')).toEqual(['w2']);
    expect(f(' 5171 ')).toEqual(['w2']);
  });

  it('reads an unknown value in a hand-edited URL as "all"', () => {
    expect(parseRosterFilter({ grp: 'other', status: '?' })).toEqual({
      grp: 'all',
      status: 'all',
      payroll: 'all',
      reason: 'all',
      q: '',
    });
  });

  it('counts each status within the chosen group', () => {
    expect(standingCounts(rows, 'spudbros', index)).toEqual({
      all: 4,
      waiting: 2,
      match: 1,
      applied: 1,
    });
  });

  it('links the export to the same filter', () => {
    expect(rosterExportHref(parseRosterFilter({}))).toBe('/staff/roster/export');
    expect(
      rosterExportHref(parseRosterFilter({ grp: 'spudbros', status: 'waiting', q: 'a b' })),
    ).toBe('/staff/roster/export?grp=spudbros&status=waiting&q=a+b');
  });
});

describe('the Payroll ID and Reason filters (ADR-0143)', () => {
  it('reads unknown values as "all", and counts as narrowing only what narrows', () => {
    const f = parseRosterFilter({ payroll: 'sideways', reason: 'gremlins' });
    expect([f.payroll, f.reason]).toEqual(['all', 'all']);
    expect(isFiltered(f)).toBe(false);
    expect(isFiltered(parseRosterFilter({ payroll: 'without' }))).toBe(true);
  });

  it('keeps the rows with, or without, a Payroll ID on the sheet', () => {
    const ids = (payroll: string) =>
      filterRoster(rows, parseRosterFilter({ payroll }), index).map((r) => r.id);
    expect(ids('with')).toEqual(['w1', 'w2']);
    expect(ids('without')).toEqual(['a1', 'm1', 't1']);
  });

  it('keeps the applied rows with that reason, and only those', () => {
    const ids = (reason: string) =>
      filterRoster(rows, parseRosterFilter({ reason }), index).map((r) => r.id);
    expect(ids('name_differs')).toEqual(['a1']);
    expect(ids('not_applied')).toEqual([]);
    expect(index.kept(rows[0]!)).toBeUndefined();
  });

  it('counts each within the chosen group and status', () => {
    const cuts = reasonCounts(rows, parseRosterFilter({ grp: 'spudbros' }), index);
    expect(cuts.payroll).toEqual({ all: 4, with: 2, without: 2 });
    expect(cuts.reason.all).toBe(1);
    expect(cuts.reason.name_differs).toBe(1);
    expect(reasonCounts(rows, parseRosterFilter({ status: 'waiting' }), index).reason.all).toBe(0);
  });

  it('carries both into the export link and the file name', () => {
    const f = parseRosterFilter({ payroll: 'without', reason: 'name_differs' });
    expect(rosterExportHref(f)).toBe('/staff/roster/export?payroll=without&reason=name_differs');
    expect(rosterFileName(f, new Date('2026-10-15T10:00:00Z'))).toBe(
      'invite-list-without-payroll-id-name-differs-2026-10-15.csv',
    );
  });
});

describe('why an applied row has no Payroll ID (ADR-0143)', () => {
  const kept = (reason: string, extra: Record<string, unknown> = {}) =>
    parseRosterReport({
      applied: ['x'],
      kept: [{ entryId: 'x', staffId: 's', staffName: 'Andreu Gaviria', reason, ...extra }],
    }).kept[0]!;

  it('offers Link only where Link can settle it', () => {
    expect(keptLinkable(kept('name_differs'))).toBe(true);
    expect(keptLinkable(kept('not_applied'))).toBe(true);
    expect(keptLinkable(kept('already_has'))).toBe(true);
    expect(keptLinkable(kept('no_payroll_id'))).toBe(true);
    expect(keptLinkable(kept('payroll_id_taken'))).toBe(false);
    expect(keptLinkable(kept('other_payroll_id'))).toBe(false);
  });

  it('says why in the office’s words, naming the people', () => {
    expect(keptExplanation(kept('name_differs'), '7053')).toContain('Applied as Andreu Gaviria');
    expect(
      keptExplanation(kept('payroll_id_taken', { holderName: 'Holly Holder' }), '7053'),
    ).toContain('Payroll ID 7053 is already Holly Holder’s');
    expect(keptExplanation(kept('other_payroll_id', { staffPayrollId: 'Z9' }), '7053')).toContain(
      'Already has Payroll ID Z9, not 7053',
    );
  });
});

describe('the invite list CSV', () => {
  it('has a BOM, a header, one CRLF line per person, sorted by surname', () => {
    const shown = filterRoster(
      rows,
      parseRosterFilter({ grp: 'spudbros', status: 'waiting' }),
      index,
    );
    const csv = rosterCsv(shown.sort(bySurname), index, report);
    expect(csv.startsWith('\uFEFFFirst name,Last name,Email,Payroll ID,Group,Status,')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(
      'Joshua,Allen,josh@x.co,5171,SpudBros Express,Not applied,,,,0,,,2026-10-08',
    );
    expect(lines[2]?.startsWith('Daisy,Marsden,')).toBe(true);
    expect(lines[3]).toBe('');
  });

  it('names who applied under the other email, and the reminders sent', () => {
    const csv = rosterCsv([rows[3]!, rows[4]!], index, report);
    const [, match, thc] = csv.slice(1).split('\r\n');
    expect(match).toContain('Possible match,,Sam Spud,new@x.co,0,');
    expect(thc).toContain('THC,Not applied,,,,3,2026-10-14,,');
  });

  it('says why an applied row has no Payroll ID, and who applied (ADR-0143)', () => {
    const csv = rosterCsv([rows[2]!], index, report);
    expect(csv.slice(1).split('\r\n')[1]).toContain(
      'Applied · no Payroll ID,Name differs from the sheet,Kept Hereford,kept@x.co,',
    );
  });

  it('defuses a cell that would run as a formula in Excel', () => {
    const csv = rosterCsv(
      [row({ id: 'x', email: 'x@x.co', first_name: '=HYPERLINK("a")' })],
      index,
      null,
    );
    expect(csv.split('\r\n')[1]?.startsWith(`"'=HYPERLINK(""a"")"`)).toBe(true);
  });

  it('names the file after the filter and the UK date', () => {
    const now = new Date('2026-10-14T23:30:00Z');
    expect(rosterFileName(parseRosterFilter({ grp: 'spudbros', status: 'waiting' }), now)).toBe(
      'invite-list-spudbros-not-applied-2026-10-15.csv',
    );
    expect(rosterFileName(parseRosterFilter({}), now)).toBe('invite-list-2026-10-15.csv');
  });
});
