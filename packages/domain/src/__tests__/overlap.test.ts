import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import vectors from '../overlap.vectors.json' with { type: 'json' };
import {
  DEFAULT_DIFFERENT_VENUE_GAP_MINUTES,
  invitationsToWithdraw,
  isBookedElsewhere,
  overlapVerdict,
} from '../overlap';
import type { BookingWindow } from '../overlap';

/** The vectors carry ISO instants; the rule works in epoch milliseconds. */
function windowOf(w: { startsAt: string; endsAt: string; venueId: string | null }): BookingWindow {
  return {
    startsAt: Date.parse(`${w.startsAt}Z`),
    endsAt: Date.parse(`${w.endsAt}Z`),
    venueId: w.venueId,
  };
}

describe('booked elsewhere (§3.4)', () => {
  it.each(vectors.cases)('$name', ({ candidate, held, gapMinutes, expect: expected }) => {
    expect(overlapVerdict(windowOf(candidate), windowOf(held), gapMinutes)).toBe(expected);
  });

  it('defaults to the two hours in settings.booked_elsewhere_gap_minutes', () => {
    expect(DEFAULT_DIFFERENT_VENUE_GAP_MINUTES).toBe(120);
  });
});

// The vectors are only a contract while both sides run the same ones.
// supabase/tests/120_auto_assign.sql loads a generated copy of this JSON, so
// a case added here without regenerating would quietly leave the SQL
// implementation untested. Same guard as pay.vectors.test.ts.
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '../../scripts/gen-overlap-vectors.mjs');
const generated = resolve(here, '../../../../supabase/tests/_shared/overlap_vectors.psql');

describe('overlap vectors are the same on both sides', () => {
  it('overlap_vectors.psql matches overlap.vectors.json — run `pnpm --filter @thc/domain gen:vectors`', () => {
    const fresh = execFileSync('node', [script, '--stdout'], { encoding: 'utf8' });
    expect(readFileSync(generated, 'utf8')).toBe(fresh);
  });

  it('covers every verdict the rule can return', () => {
    const verdicts = new Set(vectors.cases.map((c) => c.expect));
    expect([...verdicts].sort()).toEqual(['clear', 'gap_too_short', 'intersects']);
  });
});

describe('the gate over a whole set of confirmed bookings', () => {
  const shift: BookingWindow = {
    startsAt: Date.parse('2026-11-02T15:00Z'),
    endsAt: Date.parse('2026-11-02T21:00Z'),
    venueId: 'v2',
  };

  it('is clear when every confirmed booking leaves room', () => {
    expect(
      isBookedElsewhere(shift, [
        {
          startsAt: Date.parse('2026-11-02T05:00Z'),
          endsAt: Date.parse('2026-11-02T11:00Z'),
          venueId: 'v1',
        },
        {
          startsAt: Date.parse('2026-11-03T09:00Z'),
          endsAt: Date.parse('2026-11-03T17:00Z'),
          venueId: 'v3',
        },
      ]),
    ).toBe(false);
  });

  it('is barred by a single conflicting booking among many', () => {
    expect(
      isBookedElsewhere(shift, [
        {
          startsAt: Date.parse('2026-11-02T05:00Z'),
          endsAt: Date.parse('2026-11-02T11:00Z'),
          venueId: 'v1',
        },
        {
          startsAt: Date.parse('2026-11-02T13:30Z'),
          endsAt: Date.parse('2026-11-02T14:30Z'),
          venueId: 'v1',
        },
      ]),
    ).toBe(true);
  });

  it('is clear with no confirmed bookings at all', () => {
    expect(isBookedElsewhere(shift, [])).toBe(false);
  });
});

// §3.4, 14.07.2026: Accept withdraws the worker's other open invitations
// that OVERLAP the accepted window — keyed on intersection, not on the
// travel gap. See the note in overlap.ts for why the two differ.
describe('what Accept withdraws', () => {
  const accepted: BookingWindow = {
    startsAt: Date.parse('2026-11-02T09:00Z'),
    endsAt: Date.parse('2026-11-02T14:00Z'),
    venueId: 'v1',
  };

  it('withdraws an invitation whose window intersects', () => {
    const invites = [
      {
        id: 'a',
        startsAt: Date.parse('2026-11-02T13:00Z'),
        endsAt: Date.parse('2026-11-02T19:00Z'),
        venueId: 'v2',
      },
    ];
    expect(invitationsToWithdraw(accepted, invites).map((i) => i.id)).toEqual(['a']);
  });

  it('leaves a non-overlapping invitation alone even when it is now unacceptable', () => {
    // 90 minutes later at another venue: the worker can no longer accept it
    // (gap_too_short), but §3.4 does not withdraw it from under them.
    const invites = [
      {
        id: 'b',
        startsAt: Date.parse('2026-11-02T15:30Z'),
        endsAt: Date.parse('2026-11-02T21:00Z'),
        venueId: 'v2',
      },
    ];
    expect(invitationsToWithdraw(accepted, invites)).toEqual([]);
    expect(isBookedElsewhere(invites[0]!, [accepted])).toBe(true);
  });

  it('leaves a back-to-back invitation at the same venue alone', () => {
    const invites = [
      {
        id: 'c',
        startsAt: Date.parse('2026-11-02T14:00Z'),
        endsAt: Date.parse('2026-11-02T19:00Z'),
        venueId: 'v1',
      },
    ];
    expect(invitationsToWithdraw(accepted, invites)).toEqual([]);
  });
});
