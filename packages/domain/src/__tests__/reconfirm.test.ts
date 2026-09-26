import { describe, expect, it } from 'vitest';
import {
  reconfirmMovesTime,
  reconfirmReason,
  ukDayLabel,
  ukWindowLabel,
  type ReconfirmBefore,
} from '../shift';
import { cancelledFinanceNote, cancelledOnTheDay } from '../events';

/**
 * §3.5: "The card shows a 'Time Changed' tag, a line stating what changed
 * (e.g. 'Start time moved by the office (was 09:00–14:00)')". The line is
 * stored in bookings.reconfirm_reason and printed by the Staff App as-is,
 * so it must be a sentence — never "starts_at,ends_at" (D34).
 */
const before: ReconfirmBefore = {
  // Fri 19 Sep 2026, 09:00–14:00 BST.
  startsAt: new Date('2026-09-19T08:00:00Z'),
  endsAt: new Date('2026-09-19T13:00:00Z'),
  dressCode: 'Black & whites',
  venueAddress: '1 Test Street, London',
};

describe('reconfirmReason', () => {
  it('reads like the scope example for a start-time move', () => {
    expect(reconfirmReason(['starts_at'], before)).toBe(
      'Start time moved by the office (was 09:00–14:00)',
    );
  });

  it('says which end moved, or both', () => {
    expect(reconfirmReason(['ends_at'], before)).toBe(
      'End time moved by the office (was 09:00–14:00)',
    );
    expect(reconfirmReason(['starts_at', 'ends_at'], before)).toBe(
      'Start and end time moved by the office (was 09:00–14:00)',
    );
  });

  it('reports a date move once, as the date, with the old day and window', () => {
    expect(reconfirmReason(['starts_at', 'ends_at', 'event_date'], before)).toBe(
      'Date moved by the office (was Sat 19 Sep 09:00–14:00)',
    );
  });

  it('names dress code and venue changes with the old value', () => {
    expect(reconfirmReason(['dress_code'], before)).toBe(
      'Dress code changed by the office (was Black & whites)',
    );
    expect(reconfirmReason(['venue_address'], before)).toBe(
      'Venue changed by the office (was 1 Test Street, London)',
    );
    expect(reconfirmReason(['dress_code'], { ...before, dressCode: null })).toBe(
      'Dress code changed by the office (was not specified)',
    );
  });

  it('joins several changes into one line', () => {
    expect(reconfirmReason(['starts_at', 'dress_code'], before)).toBe(
      'Start time moved by the office (was 09:00–14:00) · Dress code changed by the office (was Black & whites)',
    );
  });

  it('never prints a field name', () => {
    const all = reconfirmReason(
      ['starts_at', 'ends_at', 'event_date', 'venue_address', 'dress_code'],
      before,
    );
    expect(all).not.toMatch(/starts_at|ends_at|event_date|venue_address|dress_code/);
  });

  it('a role past midnight reads in UK time, not the viewer zone', () => {
    expect(ukWindowLabel(new Date('2026-12-19T17:00:00Z'), new Date('2026-12-20T01:30:00Z'))).toBe(
      '17:00–01:30',
    );
    expect(ukDayLabel(new Date('2026-09-18T23:30:00Z'))).toBe('Sat 19 Sep');
  });
});

describe('reconfirmMovesTime — N11 or the details variant', () => {
  it('a time or date change is N11; dress code or venue alone is not', () => {
    expect(reconfirmMovesTime(['starts_at'])).toBe(true);
    expect(reconfirmMovesTime(['ends_at'])).toBe(true);
    expect(reconfirmMovesTime(['event_date'])).toBe(true);
    expect(reconfirmMovesTime(['dress_code'])).toBe(false);
    expect(reconfirmMovesTime(['venue_address', 'dress_code'])).toBe(false);
  });
});

describe('cancelledOnTheDay (§3.3 edge case, D12)', () => {
  it('before the day is excluded from financials', () => {
    expect(cancelledOnTheDay('2026-09-18T20:00:00Z', '2026-09-19')).toBe(false);
    expect(cancelledFinanceNote('2026-09-18T20:00:00Z', '2026-09-19')).toBe(
      'excluded from financials',
    );
  });

  it('on the day, by the UK calendar, is billed and paid at scheduled hours', () => {
    // 23:30 UTC on the 18th is 00:30 BST on the 19th: already the day.
    expect(cancelledOnTheDay('2026-09-18T23:30:00Z', '2026-09-19')).toBe(true);
    expect(cancelledOnTheDay(new Date('2026-09-19T15:00:00Z'), '2026-09-19')).toBe(true);
    expect(cancelledFinanceNote('2026-09-19T15:00:00Z', '2026-09-19')).toBe(
      'cancelled on the day — scheduled hours billed and paid',
    );
  });

  it('after the day (a late record of a started event) is billed too', () => {
    expect(cancelledOnTheDay('2026-09-20T09:00:00Z', '2026-09-19')).toBe(true);
  });
});
