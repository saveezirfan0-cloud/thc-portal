import { describe, expect, it } from 'vitest';
import { UK_ZONE, displayTime, needsDualZone, ukInputLabel } from '../time';

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
