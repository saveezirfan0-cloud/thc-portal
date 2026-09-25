import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import vectors from '../shiftOffer.vectors.json' with { type: 'json' };
import {
  TAKE_OFFER_REFUSALS,
  canOfferShift,
  offerExpiresAt,
  offerVisibleTo,
  takeOffer,
  type TakeOfferInput,
} from '../shiftOffer';
import {
  IllegalTransitionError,
  SHIFT_OFFER_MODES,
  SHIFT_OFFER_MODE_TRANSITIONS,
  SHIFT_OFFER_STATUSES,
  SHIFT_OFFER_TRANSITIONS,
  assertShiftOfferTransition,
  canChangeShiftOfferMode,
  canTransitionShiftOffer,
  type BookingStatus,
  type ShiftOfferMode,
  type ShiftOfferStatus,
} from '../state';
import { canCancelShift, cancelDeadline } from '../staff';

/**
 * ADR-0039 (docs/18 §4). The offer machine exists twice —
 * SHIFT_OFFER_TRANSITIONS / SHIFT_OFFER_MODE_TRANSITIONS and
 * shift_offer_transitions() / shift_offer_mode_transitions() +
 * shift_offers_state_guard in 20260930100100 — and both are held to
 * shiftOffer.vectors.json (pgTAP 651). The take and visibility cases are the
 * contract take_offered_shift() and the Radar read are held to (Agent A).
 */
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '../../scripts/gen-vectors-sql.mjs');
const generated = resolve(here, '../../../../supabase/tests/_shared/shift_offer_vectors.psql');
const sql = readFileSync(
  resolve(here, '../../../../supabase/migrations/20260930100100_staff_additions_schema.sql'),
  'utf8',
);

const edge = (from: string, to: string) => `${from}->${to}`;
const vectorEdges = new Set(vectors.edges.map((e) => edge(e.from, e.to)));
const vectorModeEdges = new Set(vectors.modeEdges.map((e) => edge(e.from, e.to)));

function sqlEdges(fn: string): string[] {
  const start = sql.indexOf(`create or replace function public.${fn}()`);
  expect(start, `${fn}() is in the migration`).toBeGreaterThan(-1);
  const block = sql.slice(start, sql.indexOf('$$;', start));
  return [...block.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)'\)/g)]
    .map(([, f, t]) => edge(f!, t!))
    .sort();
}

function sqlCheckValues(constraint: string): string[] {
  const m = new RegExp(`constraint ${constraint} check \\(\\w+ in \\(([^)]*)\\)\\)`).exec(sql);
  expect(m, constraint).not.toBeNull();
  return [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort();
}

describe('shift offer machine — shared vectors (TS ↔ SQL shift_offer_transitions)', () => {
  it('has the statuses and modes of the vectors and of the table CHECKs', () => {
    expect([...SHIFT_OFFER_STATUSES].sort()).toEqual([...vectors.statuses].sort());
    expect([...SHIFT_OFFER_MODES].sort()).toEqual([...vectors.modes].sort());
    expect(sqlCheckValues('shift_offers_status')).toEqual([...SHIFT_OFFER_STATUSES].sort());
    expect(sqlCheckValues('shift_offers_mode')).toEqual([...SHIFT_OFFER_MODES].sort());
  });

  it('has exactly the edges of the vectors file, in TS and in SQL', () => {
    const ts = Object.entries(SHIFT_OFFER_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => edge(from, to)),
    );
    expect(ts.sort()).toEqual([...vectorEdges].sort());
    expect(sqlEdges('shift_offer_transitions')).toEqual([...vectorEdges].sort());
  });

  it('has exactly the one mode edge, office → pool, in TS and in SQL', () => {
    const ts = Object.entries(SHIFT_OFFER_MODE_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => edge(from, to)),
    );
    expect(ts.sort()).toEqual([...vectorModeEdges].sort());
    expect(sqlEdges('shift_offer_mode_transitions')).toEqual([...vectorModeEdges].sort());
  });

  const pairs = SHIFT_OFFER_STATUSES.flatMap((from) =>
    SHIFT_OFFER_STATUSES.map((to) => [from, to] as [ShiftOfferStatus, ShiftOfferStatus]),
  );
  it.each(pairs)('%s → %s', (from, to) => {
    const legal = from === to || vectorEdges.has(edge(from, to));
    expect(canTransitionShiftOffer(from, to)).toBe(legal);
    if (legal) expect(() => assertShiftOfferTransition(from, to)).not.toThrow();
    else expect(() => assertShiftOfferTransition(from, to)).toThrow(IllegalTransitionError);
  });

  const modePairs = SHIFT_OFFER_MODES.flatMap((from) =>
    SHIFT_OFFER_MODES.map((to) => [from, to] as [ShiftOfferMode, ShiftOfferMode]),
  );
  it.each(modePairs)('mode %s → %s while open', (from, to) => {
    expect(canChangeShiftOfferMode(from, to, 'open')).toBe(
      from === to || vectorModeEdges.has(edge(from, to)),
    );
  });

  it('and never once the offer is closed', () => {
    expect(canChangeShiftOfferMode('office', 'pool', 'cancelled')).toBe(false);
  });
});

describe('canOfferShift — exactly canCancelShift (RULE-04, > 72 h)', () => {
  it.each(vectors.canOffer.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const startsAt = new Date(c.startsAt);
    const now = new Date(c.now);
    expect(canOfferShift(startsAt, now)).toBe(c.expect);
    expect(canOfferShift(startsAt, now)).toBe(canCancelShift(startsAt, now));
  });
});

describe('offerExpiresAt', () => {
  it.each(vectors.expires.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const startsAt = new Date(c.startsAt);
    expect(offerExpiresAt(startsAt, c.openedByOffice).toISOString()).toBe(c.expect);
  });

  it('a pool offer closes at cancelDeadline', () => {
    const startsAt = new Date('2026-12-01T18:00:00Z');
    expect(offerExpiresAt(startsAt)).toEqual(cancelDeadline(startsAt));
  });
});

type Raw = Record<string, unknown>;
const merged = (group: { defaults: Raw; cases: { name: string; input: Raw }[] }) =>
  group.cases.map((c) => ({ ...c, input: { ...group.defaults, ...c.input } }));

function takeInput(i: Raw): TakeOfferInput {
  return {
    eventCancelled: i['eventCancelled'] as boolean,
    offerStatus: i['offerStatus'] as ShiftOfferStatus,
    expiresAt: new Date(i['expiresAt'] as string),
    originalStatus: i['originalStatus'] as BookingStatus,
    offeredBy: i['offeredBy'] as string,
    taker: i['taker'] as string,
    sectionStartsAt: new Date(i['sectionStartsAt'] as string),
    gate: i['candidate'] ? (i['gate'] as string | null) : undefined,
    qualified: i['qualified'] as boolean,
    wave1Exhausted: i['wave1Exhausted'] as boolean,
    takerBookingStatus: i['takerBookingStatus'] as BookingStatus | null,
  };
}

describe('takeOffer — the order take_offered_shift() checks in', () => {
  const cases = merged(vectors.take as never);
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const expected = (vectors.take.cases.find((x) => x.name === c.name) as { expect: unknown })
      .expect;
    expect(takeOffer(takeInput(c.input), new Date(c.input['now'] as string))).toEqual(expected);
  });

  it('exercises every refusal it can give', () => {
    const reasons = new Set(
      vectors.take.cases
        .map((c) => c.expect as { ok: boolean; reason?: string })
        .filter((e) => !e.ok)
        .map((e) => e.reason),
    );
    expect([...reasons].sort()).toEqual([...TAKE_OFFER_REFUSALS].sort());
  });

  it('the calendar never refuses a take (ADR-0036)', () => {
    const c = cases.find((x) => x.name === 'unavailable_does_not_refuse')!;
    expect(takeOffer(takeInput(c.input), new Date(c.input['now'] as string)).ok).toBe(true);
  });
});

describe('offerVisibleTo — Radar "Up for grabs" (RULE-17)', () => {
  const cases = merged(vectors.visibility as never);
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const i = c.input;
    const expected = vectors.visibility.cases.find((x) => x.name === c.name)!.expect;
    expect(
      offerVisibleTo(
        {
          status: i['status'] as ShiftOfferStatus,
          mode: i['mode'] as ShiftOfferMode,
          expiresAt: new Date(i['expiresAt'] as string),
          offeredBy: i['offeredBy'] as string,
          targetStaffId: i['targetStaffId'] as string | null,
        },
        {
          staffId: i['viewer'] as string,
          gate: i['candidate'] ? (i['gate'] as string | null) : undefined,
          qualified: i['qualified'] as boolean,
        },
        i['wave1Exhausted'] as boolean,
        new Date(i['now'] as string),
      ),
    ).toBe(expected);
  });
});

describe('the generated pgTAP vectors', () => {
  it('match shiftOffer.vectors.json — run `pnpm --filter @thc/domain gen:vectors`', () => {
    const fresh = execFileSync('node', [script, '--stdout', 'shiftOffer'], { encoding: 'utf8' });
    expect(readFileSync(generated, 'utf8')).toBe(fresh);
  });
});
