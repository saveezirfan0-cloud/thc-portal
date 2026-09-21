import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAFF_TRANSITIONS, type StaffStatus } from '../state.ts';

/**
 * The §2.12 staff machine exists twice: as `STAFF_TRANSITIONS` here, and as
 * the `staff_transitions` table in
 * supabase/migrations/20260921180312_leaving_and_conviction.sql.
 *
 * CLAUDE.md asks for both — "one function in packages/domain/state.ts + a DB
 * function; illegal transitions are rejected in the DB too" — and two copies
 * of a rule drift. This reads the migration and holds them to each other edge
 * for edge, the way cap.test.ts holds cap_vectors.psql to cap.vectors.json.
 *
 * It parses rather than imports because the SQL is the deployed artefact: a
 * table built by a different migration, or an edit made straight to the
 * database, is exactly the drift worth catching.
 */
const MIGRATION = join(
  import.meta.dirname,
  '../../../../supabase/migrations/20260921180312_leaving_and_conviction.sql',
);

function sqlEdges(): Set<string> {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('insert into staff_transitions (from_status, to_status) values');
  expect(start, 'the staff_transitions insert is still in the migration').toBeGreaterThan(-1);
  const block = sql.slice(start, sql.indexOf('on conflict do nothing;', start));
  const edges = new Set<string>();
  for (const [, from, to] of block.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)'\)/g)) {
    edges.add(`${from}->${to}`);
  }
  return edges;
}

function tsEdges(): Set<string> {
  const edges = new Set<string>();
  for (const [from, tos] of Object.entries(STAFF_TRANSITIONS)) {
    for (const to of tos) edges.add(`${from}->${to}`);
  }
  return edges;
}

describe('the staff state machine is the same in TypeScript and in SQL', () => {
  it('has every edge on both sides', () => {
    expect([...sqlEdges()].sort()).toEqual([...tsEdges()].sort());
  });

  it('gives the leaver state exactly one way in and one way out (§10.6, §2.12)', () => {
    const sql = sqlEdges();
    const into = [...sql].filter((e) => e.endsWith('->inactive'));
    expect(into.sort()).toEqual(['blocked->inactive', 'compliant->inactive']);
    // Reset to candidate, and GDPR removal. There is no reactivate.
    const outOf = [...sql].filter((e) => e.startsWith('inactive->'));
    expect(outOf.sort()).toEqual(['inactive->interview_requested', 'inactive->removed']);
  });

  it('lets nothing out of removed, on either side (§1.7)', () => {
    expect([...sqlEdges()].filter((e) => e.startsWith('removed->'))).toEqual([]);
    expect(STAFF_TRANSITIONS.removed as readonly StaffStatus[]).toEqual([]);
  });
});
