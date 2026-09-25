import { describe, expect, it } from 'vitest';
import {
  UK_ZONE,
  UK_ZONE_LABEL,
  VIEWER_ZONE_LABEL,
  displayTime,
  displayTimeRange,
  needsDualZone,
  ukInputLabel,
} from '../time';

// 14 June 2026, 18:00 UK (BST = UTC+1).
const shiftStart = new Date('2026-06-14T17:00:00Z');
const shiftEnd = new Date('2026-06-14T22:30:00Z');

describe('scheduled times (§1.8)', () => {
  it('shows a labelled UK line only for a UK viewer — never a bare clock', () => {
    const shown = displayTime(shiftStart, 'scheduled', UK_ZONE);
    expect(shown.primary).toBe('18:00 UK time');
    expect(shown.secondary).toBeUndefined();
  });

  it('adds a "your time" line for a viewer elsewhere', () => {
    const shown = displayTime(shiftStart, 'scheduled', 'Europe/Warsaw');
    expect(shown.primary).toBe('18:00 UK time');
    expect(shown.secondary).toBe('19:00 your time');
  });

  it('uses the scope’s words, not the abbreviation "(UK)"', () => {
    expect(UK_ZONE_LABEL).toBe('UK time');
    expect(VIEWER_ZONE_LABEL).toBe('your time');
    expect(displayTime(shiftStart, 'scheduled', 'Europe/Warsaw').primary).not.toContain('(UK)');
  });

  it('labels a window once per line — "06:15 – 23:00 UK time" / "… your time"', () => {
    expect(displayTimeRange(shiftStart, shiftEnd, UK_ZONE)).toEqual({
      primary: '18:00 – 23:30 UK time',
    });
    expect(displayTimeRange(shiftStart, shiftEnd, 'Europe/Warsaw')).toEqual({
      primary: '18:00 – 23:30 UK time',
      secondary: '19:00 – 00:30 your time',
    });
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
    // onboarding-3.html: "Signed electronically · 18.09.2026 14:42 UK time".
    expect(shown.primary).toBe('18:00 UK time');
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
