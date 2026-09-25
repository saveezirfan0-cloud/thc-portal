import { describe, expect, it } from 'vitest';
import {
  UK_ZONE,
  displayTime,
  formatDateIn,
  formatDateTimeIn,
  needsDualZone,
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
