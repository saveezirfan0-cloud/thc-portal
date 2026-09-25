import { describe, expect, it } from 'vitest';
import { ukLocalToIso } from '../ukLocalToIso';

/**
 * "Actual finish (UK time)" is labelled UK because §1.8 says a
 * manager-typed time is UK, and the manager may not be in the UK. Reading
 * the field as the browser's zone is the bug this guards.
 */
describe('§1.8 the manager types UK time', () => {
  it('reads a winter time as GMT', () => {
    expect(ukLocalToIso('2026-01-15T23:30')).toBe('2026-01-15T23:30:00.000Z');
  });

  it('reads a summer time as BST, an hour ahead of UTC', () => {
    expect(ukLocalToIso('2026-06-14T23:30')).toBe('2026-06-14T22:30:00.000Z');
  });

  it('does not drift across midnight', () => {
    expect(ukLocalToIso('2026-06-15T00:15')).toBe('2026-06-14T23:15:00.000Z');
  });
});
