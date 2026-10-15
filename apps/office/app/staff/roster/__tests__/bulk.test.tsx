import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { bulkSummary, keptRows, keptSafe, linkPlan } from '../bulk';
import type { RosterEntry } from '../data';
import { KeptPanel } from '../KeptPanel';
import { parseRosterReport } from '../report';
import type { KeptReason, RosterKept } from '../report';

/**
 * ADR-0145 · "Applied, no Payroll ID": tick many and Link them in one go.
 *
 *   · "safe" is exactly the rows Link settles with no question asked;
 *   · a name that differs is sent with the office's word, and only when ticked;
 *   · a taken or different Payroll ID is never sent, even if ticked;
 *   · the panel shows both names side by side, and nothing at all when empty.
 */
const row = (id: string, first: string, last: string, payroll: string | null): RosterEntry => ({
  id,
  email: `${id}@x.co`,
  first_name: first,
  last_name: last,
  payroll_id: payroll,
  grp: 'thc',
  loaded_at: '2026-10-08T14:55:12Z',
});

const kept = (entryId: string, reason: KeptReason, staffName: string): RosterKept => ({
  entryId,
  staffId: `staff-${entryId}`,
  staffName,
  staffEmail: `${entryId}@x.co`,
  status: 'documents',
  staffPayrollId: reason === 'other_payroll_id' ? '9999' : null,
  reason,
  holderId: reason === 'payroll_id_taken' ? 'holder-1' : null,
  holderName: reason === 'payroll_id_taken' ? 'Hana Holder' : null,
});

const waiting = [
  row('a', 'Andrea', 'Gaviria', '7053'),
  row('b', 'Daniel', 'Rodriguez', '6032'),
  row('c', 'Shaik', 'Saheb', '7971'),
  row('d', 'Eyad', 'Kufa', '6045'),
  row('e', 'Nia', 'Norm', null),
  row('z', 'Not', 'Kept', '1'),
];
const report = [
  kept('a', 'name_differs', 'Andreu Gaviria'),
  kept('b', 'not_applied', 'Daniel Rodriguez'),
  kept('c', 'payroll_id_taken', 'Shaik Saheb'),
  kept('d', 'other_payroll_id', 'Eyad Kufa'),
  kept('e', 'no_payroll_id', 'Nia Norm'),
];
const rows = keptRows(waiting, report);

describe('keptRows', () => {
  it('pairs each list row with its reason, in the list order, and skips the rest', () => {
    expect(rows.map((r) => r.row.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('keptSafe', () => {
  it('is the rows Link settles with no question: never a name that differs, a taken or another ID', () => {
    expect(rows.filter((r) => keptSafe(r.kept)).map((r) => r.row.id)).toEqual(['b', 'e']);
    expect(keptSafe(kept('x', 'already_has', 'X Y'))).toBe(true);
  });
});

describe('linkPlan', () => {
  it('sends only ticked, linkable rows, with the office’s word on a differing name', () => {
    expect(linkPlan(rows, new Set(['a', 'b', 'c', 'd']))).toEqual([
      { entryId: 'a', staffId: 'staff-a', confirmName: true },
      { entryId: 'b', staffId: 'staff-b', confirmName: false },
    ]);
  });

  it('sends nothing when nothing is ticked', () => {
    expect(linkPlan(rows, new Set())).toEqual([]);
  });
});

describe('bulkSummary', () => {
  it('says how many, and what is left to do', () => {
    expect(bulkSummary({ linked: 17, heldSpudbros: 0, failed: [] })).toBe(
      '17 linked: they have their Payroll ID and group, and come off the list.',
    );
    const text = bulkSummary({
      linked: 2,
      heldSpudbros: 1,
      failed: [{ entryId: 'a', message: 'no' }],
    });
    expect(text).toMatch(/1 with upcoming THC shifts was not switched/);
    expect(text).toMatch(/1 could not be linked and stays ticked/);
  });
});

describe('KeptPanel', () => {
  const data = { ...parseRosterReport({}), kept: report };
  const render = (canEdit: boolean, kept = report) =>
    renderToStaticMarkup(
      <KeptPanel
        report={{ ...data, kept }}
        waiting={waiting}
        canEdit={canEdit}
        pending={false}
        failures={new Map([['a', 'The names do not agree, so they were not linked.']])}
        onLinkMany={async () => []}
      />,
    );

  it('shows the sheet’s name beside the name they applied with, and why', () => {
    const html = render(true);
    expect(html).toContain('Applied, no Payroll ID (5)');
    expect(html).toContain('Andrea Gaviria');
    expect(html).toContain('Andreu Gaviria');
    expect(html).toContain('Name differs from the sheet');
    expect(html).toContain('Hana Holder');
    expect(html).toContain('Not linked: The names do not agree');
  });

  it('offers ticks and the bulk buttons to an owner or manager only', () => {
    const html = render(true);
    expect(html).toContain('Tick all safe (2)');
    expect(html).toContain('Tick all with a different name (1)');
    expect(html).toContain('Link ticked (0)');
    // a, b and e are linkable; c (taken) and d (another ID) get no tick box.
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    const viewer = render(false);
    expect(viewer).not.toContain('Link ticked');
    expect(viewer).not.toContain('type="checkbox"');
  });

  it('renders nothing when nobody is held back', () => {
    expect(render(true, [])).toBe('');
  });
});
