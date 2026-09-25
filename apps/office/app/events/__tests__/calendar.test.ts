import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  endOfMonth,
  formatDayShort,
  isCalendarView,
  monthGrid,
  monthName,
  periodLabel,
  periodRange,
  relativeDayLabel,
  shiftPeriod,
  startOfWeek,
  todayInUk,
  ukDateOf,
  weekDays,
  weekdayIndex,
} from '../calendar';

describe('the week runs Monday to Sunday (§3.1)', () => {
  it('indexes Monday as 0 and Sunday as 6', () => {
    expect(weekdayIndex('2026-09-14')).toBe(0); // Monday
    expect(weekdayIndex('2026-09-18')).toBe(4); // Friday
    expect(weekdayIndex('2026-09-20')).toBe(6); // Sunday
  });

  it('starts the week on the Monday, including from the Sunday itself', () => {
    expect(startOfWeek('2026-09-18')).toBe('2026-09-14');
    expect(startOfWeek('2026-09-20')).toBe('2026-09-14');
    expect(startOfWeek('2026-09-14')).toBe('2026-09-14');
  });

  it('gives seven consecutive days, Monday first', () => {
    expect(weekDays('2026-09-18')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
  });
});

describe('date arithmetic is civil, not instant-based', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('is unaffected by the BST changeovers', () => {
    // 29 March 2026 is a 23-hour day in London, 25 October a 25-hour one.
    // A calendar day is still a calendar day.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('clamps a month step rather than overflowing into the next month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'); // leap year
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('finds the last day of the month, leap years included', () => {
    expect(endOfMonth('2026-09-05')).toBe('2026-09-30');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
  });
});

describe('the month grid is whole Mon–Sun weeks (§3.1)', () => {
  const grid = monthGrid('2026-09-18');

  it('starts on a Monday and ends on a Sunday', () => {
    expect(weekdayIndex(grid[0]!.iso)).toBe(0);
    expect(weekdayIndex(grid[grid.length - 1]!.iso)).toBe(6);
    expect(grid.length % 7).toBe(0);
  });

  it('covers every day of the month', () => {
    const inMonth = grid.filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(30);
    expect(inMonth[0]!.iso).toBe('2026-09-01');
    expect(inMonth[29]!.iso).toBe('2026-09-30');
  });

  it('marks the neighbours so they can be dimmed', () => {
    // September 2026 starts on a Tuesday, so Monday 31 August leads.
    expect(grid[0]).toEqual({ iso: '2026-08-31', dayOfMonth: 31, inMonth: false });
    expect(grid[1]!.inMonth).toBe(true);
  });

  it('handles a month that begins on a Monday without a leading week', () => {
    const june = monthGrid('2026-06-15'); // 1 June 2026 is a Monday
    expect(june[0]!.iso).toBe('2026-06-01');
    expect(june[0]!.inMonth).toBe(true);
  });
});

describe('the arrows step by the view they belong to (§3.1)', () => {
  it('steps a day, a week or a month', () => {
    expect(shiftPeriod('day', '2026-09-18', 1)).toBe('2026-09-19');
    expect(shiftPeriod('week', '2026-09-18', 1)).toBe('2026-09-25');
    expect(shiftPeriod('week', '2026-09-18', -1)).toBe('2026-09-11');
    expect(shiftPeriod('month', '2026-09-18', 1)).toBe('2026-10-18');
  });

  it('steps the list a month too, so past events are browsable there as well', () => {
    expect(shiftPeriod('list', '2026-09-18', -1)).toBe('2026-08-18');
  });
});

describe('each view loads exactly the days it shows', () => {
  it('a day view loads one day', () => {
    expect(periodRange('day', '2026-09-18')).toEqual({ from: '2026-09-18', to: '2026-09-18' });
  });

  it('a week view loads its Monday to its Sunday', () => {
    expect(periodRange('week', '2026-09-18')).toEqual({ from: '2026-09-14', to: '2026-09-20' });
  });

  it('a month view loads the whole grid, neighbours included', () => {
    expect(periodRange('month', '2026-09-18')).toEqual({ from: '2026-08-31', to: '2026-10-04' });
  });

  it('a list loads the calendar month itself, without the spill days', () => {
    expect(periodRange('list', '2026-09-18')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
});

describe('the period label between the arrows', () => {
  it('names the month, the week span or the day', () => {
    expect(periodLabel('month', '2026-09-18')).toBe('September 2026');
    expect(periodLabel('list', '2026-09-18')).toBe('September 2026');
    // A week inside one month names it once (events.html:251).
    expect(periodLabel('week', '2026-09-18')).toBe('Mon 14 – Sun 20 Sep 2026');
    expect(periodLabel('day', '2026-09-18')).toBe('Fri 18 Sep 2026');
  });

  it('spells both months for a week that straddles them', () => {
    expect(periodLabel('week', '2026-09-30')).toBe('Mon 28 Sep – Sun 4 Oct 2026');
  });

  it('says "· today" on the day view when it is (events.html:312)', () => {
    expect(periodLabel('day', '2026-09-18', '2026-09-18')).toBe('Fri 18 Sep 2026 · today');
    expect(periodLabel('day', '2026-09-19', '2026-09-18')).toBe('Sat 19 Sep 2026');
  });

  it('names the month for the list footer', () => {
    expect(monthName('2026-09-18')).toBe('September');
  });

  it('describes a day relative to today, for the builder banners', () => {
    expect(relativeDayLabel('2026-09-18', '2026-09-18')).toBe('today');
    expect(relativeDayLabel('2026-09-19', '2026-09-18')).toBe('tomorrow');
    expect(relativeDayLabel('2026-09-17', '2026-09-18')).toBe('yesterday');
    expect(relativeDayLabel('2026-09-25', '2026-09-18')).toBe('on Fri 25 Sep');
  });

  it('formats a day the way the list column reads it', () => {
    expect(formatDayShort('2026-09-18')).toBe('Fri 18 Sep');
  });
});

describe('today is today in the UK, whatever the server is set to (§1.8)', () => {
  it('reads a late-evening UTC instant as the UK date', () => {
    // 23:30 UTC on 18 June is 00:30 on the 19th in London (BST).
    expect(todayInUk(new Date('2026-06-18T23:30:00Z'))).toBe('2026-06-19');
    expect(ukDateOf(new Date('2026-06-18T23:30:00Z'))).toBe('2026-06-19');
    // In winter the two coincide.
    expect(todayInUk(new Date('2026-12-18T23:30:00Z'))).toBe('2026-12-18');
  });
});

describe('the view parameter is validated before use', () => {
  it('accepts only the four views', () => {
    expect(isCalendarView('list')).toBe(true);
    expect(isCalendarView('month')).toBe(true);
    expect(isCalendarView('nonsense')).toBe(false);
    expect(isCalendarView(undefined)).toBe(false);
  });
});
