import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_FORMAT,
  UK_ZONE,
  clockLabel,
  displayTime,
  formatDateIn,
  formatDateTimeIn,
  formatTimeIn,
  needsDualZone,
  parseClock,
  parseTimeFormat,
  ukInputLabel,
} from '../time';

// 14 June 2026, 18:00 UK (BST = UTC+1).
const shiftStart = new Date('2026-06-14T17:00:00Z');

describe('scheduled times (§1.8)', () => {
  it('shows UK only for a UK viewer', () => {
    const shown = displayTime(shiftStart, 'scheduled', UK_ZONE);
    expect(shown.primary).toBe('18:00');
    expect(shown.secondary).toBeUndefined();
  });

  it('adds a "your time" line for a viewer elsewhere', () => {
    const shown = displayTime(shiftStart, 'scheduled', 'Europe/Warsaw');
    expect(shown.primary).toBe('18:00 (UK)');
    expect(shown.secondary).toBe('19:00 your time');
  });
});

describe('actual stamps (§1.8)', () => {
  it('shows the viewer local time only, never dual', () => {
    const shown = displayTime(shiftStart, 'actual', 'Europe/Warsaw');
    expect(shown.primary).toBe('19:00');
    expect(shown.secondary).toBeUndefined();
  });
});

describe('audit stamps (§1.8)', () => {
  it('is UK only wherever the viewer is', () => {
    const shown = displayTime(shiftStart, 'audit', 'America/New_York');
    expect(shown.primary).toBe('18:00 (UK)');
    expect(shown.secondary).toBeUndefined();
  });
});

describe('manager-typed inputs (§1.8)', () => {
  it('is labelled (UK time)', () => {
    expect(ukInputLabel('Actual finish')).toBe('Actual finish (UK time)');
  });
});

describe('needsDualZone', () => {
  it('is false in the UK and true elsewhere', () => {
    expect(needsDualZone(UK_ZONE)).toBe(false);
    expect(needsDualZone('Europe/Warsaw')).toBe(true);
  });
});

describe('formatDateIn — the same string in every engine', () => {
  const at = new Date('2026-09-25T12:00:00Z');

  it('writes the short form with no comma and a three-letter month', () => {
    expect(formatDateIn(at, UK_ZONE, { weekday: 'short', year: true })).toBe('Fri 25 Sep 2026');
    expect(formatDateIn(at, UK_ZONE, { weekday: 'short' })).toBe('Fri 25 Sep');
  });

  it('gives formatDateTimeIn the same month word', () => {
    expect(formatDateTimeIn(new Date('2026-09-05T08:05:00Z'), UK_ZONE)).toBe('05 Sep, 09:05');
  });

  it('drops the day for a month label', () => {
    expect(formatDateIn(at, UK_ZONE, { day: false, year: true })).toBe('Sep 2026');
  });

  it('writes the long form', () => {
    expect(formatDateIn(at, UK_ZONE, { weekday: 'long', month: 'long', year: true })).toBe(
      'Friday 25 September 2026',
    );
  });

  it('takes the calendar day from the zone, not from UTC', () => {
    // 23:30 UTC on the 24th is 00:30 on the 25th in London (BST).
    const late = new Date('2026-09-24T23:30:00Z');
    expect(formatDateIn(late, UK_ZONE, { weekday: 'short' })).toBe('Fri 25 Sep');
    expect(formatDateIn(late, 'UTC', { weekday: 'short' })).toBe('Thu 24 Sep');
  });
});

describe('the clock a person reads (ADR-0085)', () => {
  it('is 24-hour unless someone chooses otherwise', () => {
    expect(DEFAULT_TIME_FORMAT).toBe('24h');
    expect(formatTimeIn(shiftStart, UK_ZONE)).toBe('18:00');
    expect(parseTimeFormat(undefined)).toBe('24h');
    expect(parseTimeFormat('garbage')).toBe('24h');
    expect(parseTimeFormat('12h')).toBe('12h');
  });

  it('writes the same instant on a 12-hour clock, with the same stable space in every engine', () => {
    expect(formatTimeIn(shiftStart, UK_ZONE, '12h')).toBe('6:00 pm');
    expect(formatTimeIn(new Date('2026-06-14T23:00:00Z'), UK_ZONE, '12h')).toBe('12:00 am');
    expect(formatTimeIn(new Date('2026-06-14T11:30:00Z'), UK_ZONE, '12h')).toBe('12:30 pm');
    expect(formatTimeIn(new Date('2026-06-14T06:05:00Z'), UK_ZONE, '12h')).toBe('7:05 am');
    expect(formatTimeIn(shiftStart, UK_ZONE, '12h')).not.toMatch(/\u202f|\u00a0/);
  });

  it('keeps §1.8 intact on a 12-hour clock: UK line, "(UK)", and a second "your time" line', () => {
    const shown = displayTime(shiftStart, 'scheduled', 'Europe/Warsaw', false, '12h');
    expect(shown.primary).toBe('6:00 pm (UK)');
    expect(shown.secondary).toBe('7:00 pm your time');
    expect(displayTime(shiftStart, 'audit', 'America/New_York', false, '12h').primary).toBe(
      '6:00 pm (UK)',
    );
    expect(formatDateTimeIn(shiftStart, UK_ZONE, '12h')).toBe('14 Jun, 6:00 pm');
  });

  it('clockLabel leaves a 24-hour label alone and a malformed one untouched', () => {
    expect(clockLabel('09:05')).toBe('09:05');
    expect(clockLabel('09:05', '12h')).toBe('9:05 am');
    expect(clockLabel('', '12h')).toBe('');
  });
});

describe('parseClock — a typed time, in either clock', () => {
  it.each([
    ['17:00', '17:00'],
    ['1700', '17:00'],
    ['17.00', '17:00'],
    ['17', '17:00'],
    ['9', '09:00'],
    ['9:5', '09:05'],
    ['0905', '09:05'],
    ['905', '09:05'],
    ['00:00', '00:00'],
    ['23:59', '23:59'],
    ['5pm', '17:00'],
    ['5:30 pm', '17:30'],
    ['5.30PM', '17:30'],
    ['5:30 p.m.', '17:30'],
    ['12am', '00:00'],
    ['12 am', '00:00'],
    ['12pm', '12:00'],
    ['12:30am', '00:30'],
    ['  7:45 AM ', '07:45'],
  ])('reads %j as %s', (typed, stored) => {
    expect(parseClock(typed)).toBe(stored);
  });

  it.each([
    '',
    ' ',
    'noon',
    '24:00',
    '25',
    '17:60',
    '13pm',
    '0pm',
    '5:99pm',
    '1:2:3',
    '17:000',
    '-5',
  ])('refuses %j', (typed) => {
    expect(parseClock(typed)).toBeNull();
  });

  it('round-trips every minute of the day through both clocks', () => {
    for (let m = 0; m < 24 * 60; m++) {
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      expect(parseClock(clockLabel(hhmm, '24h'))).toBe(hhmm);
      expect(parseClock(clockLabel(hhmm, '12h'))).toBe(hhmm);
    }
  });
});
