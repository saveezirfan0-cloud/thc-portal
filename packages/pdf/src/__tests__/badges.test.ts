import { describe, expect, it } from 'vitest';
import {
  BADGES_PER_PAGE,
  BADGE_SIZE,
  BADGE_SIZE_MM,
  badgeName,
  badgeNameSize,
  badgesText,
  layoutBadges,
} from '../badges';
import { renderBadgesPdf } from '../BadgesDocument';
import { A4_POINTS, countPdfPages, pdfPageSizes } from '../SheetDocument';
import { layoutSheet } from '../sheet';
import { GALA, galaPeople, removedWaiter } from './fixtures';

/** ADR-0081: name badges for the clients that put THC's staff in their own holders. */
describe('name badges (ADR-0081)', () => {
  it('has one badge per person on the Allocation Timesheet, in the sheet order', () => {
    const people = galaPeople(3);
    const badges = layoutBadges({ event: GALA, people });
    const sheet = layoutSheet({ kind: 'allocation', event: GALA, people });
    const sheetOrder = sheet.pages.flatMap((p) =>
      p.lines.flatMap((l) => (l.type === 'row' ? [l.row.bookingId] : [])),
    );
    expect(badges.count).toBe(8);
    expect(badges.pages.flatMap((p) => p.badges.map((b) => b.bookingId))).toEqual(sheetOrder);
  });

  it('prints the first name only — the surname stays on the timesheet', () => {
    const badges = layoutBadges({ event: GALA, people: galaPeople(0) });
    expect(badgesText(badges)).toBe(
      [
        '=== Page 1 of 1 · Leonardo Hotel St Pauls – Gala Dinner – Name Badges · 19/09/2026 ===',
        '[THC] Luca | [THC] Daniel',
        '[THC] Aisha | [THC] Mateusz',
        '[THC] Tom',
        '',
      ].join('\n'),
    );
  });

  it('falls back to the sheet name when no first name is on record', () => {
    const [p] = galaPeople(0);
    expect(badgeName({ ...p!, firstName: null, name: 'Tom Reid' })).toBe('Tom Reid');
    expect(badgeName({ ...p!, firstName: '  ', name: 'Tom Reid' })).toBe('Tom Reid');
  });

  it('gives no badge to a worker removed under §1.7', () => {
    const people = [...galaPeople(0), removedWaiter()];
    const badges = layoutBadges({ event: GALA, people });
    expect(badges.count).toBe(5);
    expect(badgesText(badges)).not.toContain('Deleted account');
  });

  it('puts ten badges on a page, and an exact multiple adds no empty page', () => {
    expect(BADGES_PER_PAGE).toBe(10);
    // 22 waiting staff + 5 kitchen = 27 → 10 · 10 · 7.
    const big = layoutBadges({ event: GALA, people: galaPeople(22) });
    expect(big.pages.map((p) => p.badges.length)).toEqual([10, 10, 7]);
    expect(big.pages.map((p) => `${p.number}/${p.of}`)).toEqual(['1/3', '2/3', '3/3']);
    const exact = layoutBadges({ event: GALA, people: galaPeople(15) });
    expect(exact.pages.map((p) => p.badges.length)).toEqual([10, 10]);
  });

  it('names the file after the client and event, like the sheet', () => {
    const badges = layoutBadges({ event: GALA, people: galaPeople(0) });
    expect(badges.fileName).toBe('Leonardo Hotel St Pauls – Gala Dinner – Name Badges.pdf');
  });

  it('is the standard 86 × 54 mm card', () => {
    expect(BADGE_SIZE_MM).toEqual({ width: 86, height: 54 });
    expect(BADGE_SIZE.width).toBeCloseTo(243.78, 1);
    expect(BADGE_SIZE.height).toBeCloseTo(153.07, 1);
    // Two across and five down fit inside A4 with room for a printer's margin.
    expect(BADGE_SIZE.width * 2).toBeLessThan(A4_POINTS.width - 2 * 28);
    expect(BADGE_SIZE.height * 5).toBeLessThan(A4_POINTS.height - 2 * 28);
  });

  it('shrinks a long name so it stays on one line', () => {
    expect(badgeNameSize('Jo')).toBe(28);
    expect(badgeNameSize('Maximilian')).toBe(24);
    expect(badgeNameSize('Oluwaseun-Tobi')).toBe(19);
    expect(badgeNameSize('Anna-Katharina Maria')).toBe(15);
  });

  it('renders every page as a full A4 sheet', async () => {
    const layout = layoutBadges({ event: GALA, people: galaPeople(22) });
    const pdf = await renderBadgesPdf(layout);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(countPdfPages(pdf)).toBe(3);
    for (const size of pdfPageSizes(pdf)) {
      expect(size.width).toBeCloseTo(A4_POINTS.width, 1);
      expect(size.height).toBeCloseTo(A4_POINTS.height, 1);
    }
  });

  it('renders a single badge on one A4 page', async () => {
    const layout = layoutBadges({ event: GALA, people: galaPeople(0).slice(0, 1) });
    const pdf = await renderBadgesPdf(layout);
    expect(countPdfPages(pdf)).toBe(1);
  });
});
