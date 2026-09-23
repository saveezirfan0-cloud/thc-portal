import { describe, expect, it } from 'vitest';
import { layoutSheet, orderPeople, safeFileName, sheetText } from '../sheet';
import type { SheetLayout, SheetRow } from '../sheet';
import { GALA, galaPeople, removedWaiter, signOutPeople } from './fixtures';

function rows(layout: SheetLayout, page?: number): SheetRow[] {
  return layout.pages
    .filter((p) => page === undefined || p.number === page)
    .flatMap((p) => p.lines.flatMap((l) => (l.type === 'row' ? [l.row] : [])));
}

describe('allocation sheet · 27 rows (§11.3)', () => {
  // Chef 2 + Kitchen Porter 3 + Waiting Staff 22 = 27 → 12 + 12 + 3.
  const layout = layoutSheet({ kind: 'allocation', event: GALA, people: galaPeople(22) });

  it('matches the golden file', async () => {
    await expect(sheetText(layout)).toMatchFileSnapshot('./__golden__/allocation-27-rows.txt');
  });

  it('paginates to three pages of 12, 12 and 3', () => {
    expect(layout.pages.map((p) => rows(layout, p.number).length)).toEqual([12, 12, 3]);
    expect(layout.pages.every((p) => p.of === 3)).toBe(true);
  });

  it('prints the footer once, on the last page only', () => {
    expect(layout.pages.map((p) => p.footer)).toEqual([false, false, true]);
  });

  it('marks every page after the first "(continued)"', () => {
    expect(layout.pages.map((p) => p.continued)).toEqual([false, true, true]);
    expect(sheetText(layout)).toContain('Leonardo Hotel St Pauls – Gala Dinner · 19/09/2026 (continued)');
  });

  it('orders by role section (its own start), then surname', () => {
    const all = rows(layout);
    expect(all.slice(0, 5).map((r) => r.name)).toEqual([
      'Luca Moretti',
      'Daniel Okafor',
      'Aisha Bello',
      'Mateusz Nowak',
      'Tom Reid',
    ]);
    const waiting = all.slice(5).map((r) => r.name.split(' ')[1]);
    expect(waiting).toEqual([...waiting].sort((a, b) => a!.localeCompare(b!)));
  });

  it('repeats the section heading on the page it continues onto', () => {
    const page2 = layout.pages[1]!.lines[0]!;
    expect(page2).toEqual({ type: 'section', label: 'Waiting Staff · 17:00 – 23:30 · continued (12 of 22)' });
    const page1Wait = layout.pages[0]!.lines.find((l) => l.type === 'section' && l.label.startsWith('Waiting'));
    expect(page1Wait).toEqual({
      type: 'section',
      label: 'Waiting Staff · 17:00 – 23:30 · 22 staff (7 on this page, continued on page 2)',
    });
  });

  it('leaves Finish, Signature, Comments and Hours blank for the client to fill in', () => {
    for (const r of rows(layout)) {
      expect([r.finishTime, r.signature, r.comments, r.hoursWorked]).toEqual(['', '', '', '']);
    }
    expect(layout.totalHours).toBe('');
  });

  it('prints Name (Employee ID) + (Role) and start with the forecast finish in brackets, in UK time', () => {
    const luca = rows(layout)[0]!;
    expect(luca).toMatchObject({
      name: 'Luca Moretti',
      idLabel: '(THC-00412)',
      role: '(Chef)',
      startTime: '07:00 (15:00)',
    });
  });

  it('carries the PO number and the "Client – Event" title', () => {
    expect(layout.poNumber).toBe('4471-A');
    expect(layout.title).toBe('Leonardo Hotel St Pauls – Gala Dinner');
    expect(layout.fileName).toBe('Leonardo Hotel St Pauls – Gala Dinner.pdf');
    expect(layout.dateLabel).toBe('19/09/2026');
  });
});

describe('B12 done-when: a 25-worker event', () => {
  it('paginates to three pages (12 + 12 + 1), with no trailing empty page', () => {
    const layout = layoutSheet({ kind: 'allocation', event: GALA, people: galaPeople(20) });
    expect(layout.rowCount).toBe(25);
    expect(layout.pages).toHaveLength(3);
    expect(layout.pages.map((p) => rows(layout, p.number).length)).toEqual([12, 12, 1]);
  });

  it('24 workers is exactly two pages', () => {
    expect(layoutSheet({ kind: 'allocation', event: GALA, people: galaPeople(19) }).pages).toHaveLength(2);
  });
});

describe('sign-out timesheet · one page (§11.3)', () => {
  const layout = layoutSheet({ kind: 'signout', event: GALA, people: signOutPeople() });

  it('matches the golden file', async () => {
    await expect(sheetText(layout)).toMatchFileSnapshot('./__golden__/signout-1-page.txt');
  });

  it('is one page, with the footer on it', () => {
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]).toMatchObject({ number: 1, of: 1, continued: false, footer: true });
  });

  it('fills Finish, Comments (breaks) and Hours Worked from check-in/out', () => {
    const luca = rows(layout).find((r) => r.name === 'Luca Moretti')!;
    expect(luca).toMatchObject({ finishTime: '15:05', comments: 'Break 30 min', hoursWorked: '7h 30m' });
  });

  it('leaves Finish and Hours blank for an unresolved No check-out, and nobody else (RULE-02)', () => {
    const tom = rows(layout).find((r) => r.name === 'Tom Reid')!;
    expect(tom).toMatchObject({ finishTime: '', hoursWorked: '', comments: 'Break 20 min' });
    expect(rows(layout).filter((r) => r.hoursWorked === '').map((r) => r.name)).toEqual([
      'Mateusz Nowak',
      'Tom Reid',
    ]);
  });

  it("keeps the Signature column empty — it is the client's, by hand", () => {
    expect(rows(layout).every((r) => r.signature === '')).toBe(true);
  });

  it('totals the whole event, excluding the blank rows', () => {
    // 450 + 430 + 460 = 1,340 min
    expect(layout.totalHours).toBe('22h 20m');
  });
});

describe('GDPR: a copy regenerated after a removal (§1.7)', () => {
  const people = [...galaPeople(4), removedWaiter()];
  const layout = layoutSheet({ kind: 'allocation', event: GALA, people });
  const removed = rows(layout).find((r) => r.name === 'Deleted account #1042')!;

  it('prints "Deleted account #id", keeps the Employee ID, and draws no photo', () => {
    expect(removed).toMatchObject({ name: 'Deleted account #1042', idLabel: '(THC-00463)', photoPath: null });
    expect(sheetText(layout)).toContain('[ ] | Deleted account #1042 (THC-00463) (Waiting Staff)');
  });

  it('keeps the row, so the headcount is not skewed', () => {
    expect(layout.rowCount).toBe(people.length);
  });

  it('sorts the removed worker last in their role, because the surname is gone', () => {
    const waiting = rows(layout).filter((r) => r.role === '(Waiting Staff)');
    expect(waiting.at(-1)!.name).toBe('Deleted account #1042');
  });

  it('never shows a photo for a removed row even if a path slipped through', () => {
    const leaked = { ...removedWaiter(), photoPath: 'should-not-print.jpg' };
    const out = layoutSheet({ kind: 'allocation', event: GALA, people: [leaked] });
    expect(rows(out)[0]!.photoPath).toBeNull();
  });
});

describe('ordering and naming', () => {
  it('orders role sections by their own start (RULE-18), not by name', () => {
    const sections = orderPeople(galaPeople(3));
    expect(sections.map((s) => s.roleName)).toEqual(['Chef', 'Kitchen Porter', 'Waiting Staff']);
  });

  it('omits the PO line when the event has none', () => {
    const layout = layoutSheet({
      kind: 'allocation',
      event: { ...GALA, poNumber: '  ' },
      people: galaPeople(1),
    });
    expect(layout.poNumber).toBeNull();
    expect(sheetText(layout)).not.toContain('PO Number');
  });

  it('makes a safe file name without losing the en dash', () => {
    expect(safeFileName('A/B Hotel – Launch: "VIP"')).toBe('A-B Hotel – Launch- -VIP-.pdf');
  });

  it('still renders one page for an event with nobody on it', () => {
    const layout = layoutSheet({ kind: 'allocation', event: GALA, people: [] });
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.footer).toBe(true);
  });
});
