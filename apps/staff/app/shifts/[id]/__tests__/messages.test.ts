import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MESSAGES, checkedOutOffSiteMessage, messageFor, turnedAwayMessage } from '../messages';

/**
 * Audit D19 · one copy table. `ShiftScreen` kept its own `MESSAGES`, which
 * is how the turn-away lost §3.2's last sentence and the off-site check-out
 * lost its time.
 */
describe('the shift screen’s copy', () => {
  it('says the whole §3.2 turn-away sentence, paid line only when on time', () => {
    expect(turnedAwayMessage(true)).toBe(
      'Thanks for coming — this shift is already fully staffed, so you’re not needed today. We’ve logged that you arrived on time and you’ll be paid for 4 hours. Please check your app for other shifts.',
    );
    expect(turnedAwayMessage(false)).toBe(
      'Thanks for coming — this shift is already fully staffed, so you’re not needed today. Please check your app for other shifts.',
    );
    expect(MESSAGES['turned_away_paid']).toBe(turnedAwayMessage(true));
    expect(MESSAGES['turned_away_unpaid']).toBe(turnedAwayMessage(false));
  });

  it('puts the last on-site time in the off-site check-out sentence (§5.1)', () => {
    expect(messageFor('checked_out_off_site', { lastOnSite: '16:00' })).toBe(
      'You checked out away from the venue — we’ve recorded your last time on site, 16:00.',
    );
    expect(checkedOutOffSiteMessage(null)).toBe(
      'You checked out away from the venue — we’ve recorded your last time on site.',
    );
  });

  it('answers null for a key it does not know, rather than showing a code', () => {
    expect(messageFor('some_new_key')).toBeNull();
  });

  it('is the only table: the screen keeps no copy of its own', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const screen = readFileSync(join(here, '..', 'ShiftScreen.tsx'), 'utf8');
    expect(screen).not.toMatch(/const MESSAGES/);
    expect(screen).toContain("from './messages'");
  });
});
