import { describe, expect, it } from 'vitest';
import {
  VIOLATION_PAGE_SIZE,
  flaggedAs,
  logQueryHref,
  logTime,
  pageRange,
  parseLogQuery,
  ukDate,
  ukDayBounds,
} from '../log';

/**
 * /checkin's reads (§9.5, §1.8): which shifts are "today", and the
 * violation log's filter, pages, Time column and "Flagged as" line.
 */

/** The monitor's query: role sections with starts_at < to AND ends_at > from. */
const onBoard = (bounds: { from: string; to: string }, start: string, end: string) =>
  new Date(start) < new Date(bounds.to) && new Date(end) > new Date(bounds.from);

describe('the monitor covers today’s UK day (§9.5, §1.8)', () => {
  it('is midnight to midnight in London during BST', () => {
    expect(ukDayBounds(new Date('2026-06-14T10:00:00Z'))).toEqual({
      from: '2026-06-13T23:00:00.000Z',
      to: '2026-06-14T23:00:00.000Z',
    });
  });

  it('is midnight to midnight in GMT in winter', () => {
    expect(ukDayBounds(new Date('2026-01-15T10:00:00Z'))).toEqual({
      from: '2026-01-15T00:00:00.000Z',
      to: '2026-01-16T00:00:00.000Z',
    });
  });

  it('takes the UK date, not the server’s, just after UK midnight in summer', () => {
    // 23:30 UTC on the 14th is 00:30 on the 15th in London.
    expect(ukDate(new Date('2026-06-14T23:30:00Z'))).toBe('2026-06-15');
    expect(ukDayBounds(new Date('2026-06-14T23:30:00Z')).from).toBe('2026-06-14T23:00:00.000Z');
  });

  it('is 23 hours long on the day the clocks go forward', () => {
    const b = ukDayBounds(new Date('2026-03-29T12:00:00Z'));
    expect((Date.parse(b.to) - Date.parse(b.from)) / 3_600_000).toBe(23);
  });

  const now = new Date('2026-06-14T10:00:00Z'); // 11:00 UK
  const today = ukDayBounds(now);

  it('shows today’s shifts', () => {
    expect(onBoard(today, '2026-06-14T16:00:00Z', '2026-06-14T22:30:00Z')).toBe(true);
  });

  it('keeps last night’s overnight shift that runs past midnight', () => {
    // 19:00–02:00 UK: started yesterday, still going after midnight.
    expect(onBoard(today, '2026-06-13T18:00:00Z', '2026-06-14T01:00:00Z')).toBe(true);
  });

  it('does not show tomorrow morning’s shifts (audit)', () => {
    expect(onBoard(today, '2026-06-15T06:00:00Z', '2026-06-15T14:00:00Z')).toBe(false);
  });

  it('does not show yesterday’s day shift', () => {
    expect(onBoard(today, '2026-06-13T08:00:00Z', '2026-06-13T16:00:00Z')).toBe(false);
  });
});

describe('the violation log’s query (audit D50)', () => {
  it('defaults to unresolved only, first page', () => {
    expect(parseLogQuery({})).toEqual({ showResolved: false, page: 1 });
  });

  it('reads Show resolved and the page from the URL', () => {
    expect(parseLogQuery({ resolved: '1', page: '3' })).toEqual({ showResolved: true, page: 3 });
  });

  it('ignores a page it cannot read', () => {
    expect(parseLogQuery({ page: 'x' }).page).toBe(1);
    expect(parseLogQuery({ page: '-2' }).page).toBe(1);
    expect(parseLogQuery({ page: ['2', '5'] }).page).toBe(2);
  });

  it('writes the default as the bare route', () => {
    expect(logQueryHref({ showResolved: false, page: 1 })).toBe('/checkin');
    expect(logQueryHref({ showResolved: true, page: 2 })).toBe('/checkin?resolved=1&page=2');
  });

  it('reads one row more than a page shows, to know there is an older one', () => {
    expect(pageRange(1)).toEqual({ from: 0, to: VIOLATION_PAGE_SIZE });
    expect(pageRange(3)).toEqual({ from: 2 * VIOLATION_PAGE_SIZE, to: 3 * VIOLATION_PAGE_SIZE });
  });
});

describe('the Time column carries the day (§9.5, checkin.html)', () => {
  const now = new Date('2026-09-17T12:00:00Z');

  it('today’s entries read "today"', () => {
    expect(logTime('2026-09-17T15:12:00Z', 'Europe/London', now)).toBe('today 16:12');
  });

  it('an earlier day this month reads as the wireframe does', () => {
    expect(logTime('2026-09-16T21:00:00Z', 'Europe/London', now)).toBe('Wed 16 · 22:00');
  });

  it('another month names it, another year names that too', () => {
    expect(logTime('2026-08-20T09:00:00Z', 'Europe/London', now)).toBe('Thu 20 Aug · 10:00');
    expect(logTime('2025-12-24T09:00:00Z', 'Europe/London', now)).toBe('Wed 24 Dec 2025 · 09:00');
  });

  it('is the viewer’s own clock, day included (§1.8)', () => {
    // 22:30 UK on the 16th is 00:30 on the 17th in Athens: "today" there.
    expect(logTime('2026-09-16T21:30:00Z', 'Europe/Athens', now)).toBe('today 00:30');
  });
});

describe('"Flagged as" (§9.5)', () => {
  it('is the violation name plus the event, as the scope records it', () => {
    expect(flaggedAs('left_early', 'Gala Dinner')).toBe('Checked out early — Gala Dinner');
    expect(flaggedAs('no_checkout', 'Press Night')).toBe('No check-out — Press Night');
  });
});
