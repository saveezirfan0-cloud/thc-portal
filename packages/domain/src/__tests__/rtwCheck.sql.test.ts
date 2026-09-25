import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RTW_CHECK_TRANSITIONS } from '../state.ts';
import {
  RTW_CHECK_BACKOFF_MINUTES,
  RTW_CHECK_STATUSES,
  RTW_NOT_FOUND_REASON,
} from '../rtwCheck.ts';

/**
 * The automated right-to-work check exists twice (ADR-0025): the rules here,
 * and supabase/migrations/20260928100000_rtw_check.sql, which is
 * authoritative for the state machine, the attempt limit and the backoff.
 * This reads the migration — the deployed artefact — and holds the two to
 * each other, the way staffMachine.sql.test.ts does the §2.12 machine.
 */
const MIGRATION = join(
  import.meta.dirname,
  '../../../../supabase/migrations/20260928100000_rtw_check.sql',
);
const sql = readFileSync(MIGRATION, 'utf8');

function sqlEdges(): string[] {
  const start = sql.indexOf('create or replace function public.rtw_check_transitions()');
  expect(start, 'rtw_check_transitions() is still in the migration').toBeGreaterThan(-1);
  const block = sql.slice(start, sql.indexOf('$$;', start));
  return [...block.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)'\)/g)]
    .map(([, f, t]) => `${f}->${t}`)
    .sort();
}

function tsEdges(): string[] {
  return Object.entries(RTW_CHECK_TRANSITIONS)
    .flatMap(([from, tos]) => tos.map((to) => `${from}->${to}`))
    .sort();
}

describe('rtw_checks: TypeScript and SQL agree', () => {
  it('has the same edges', () => {
    expect(sqlEdges()).toEqual(tsEdges());
  });

  it('has the same statuses in the table constraint', () => {
    const m = /constraint rtw_checks_status check \(status in \(([^)]*)\)\)/.exec(sql);
    expect(m).not.toBeNull();
    const statuses = [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(statuses).toEqual([...RTW_CHECK_STATUSES].sort());
  });

  it('backs off on the same schedule', () => {
    const m = /\(array\[([\d,\s]+)\]\)\[least\(greatest\(coalesce\(p_attempt/.exec(sql);
    expect(m).not.toBeNull();
    expect(m![1]!.split(',').map((x) => Number(x.trim()))).toEqual([...RTW_CHECK_BACKOFF_MINUTES]);
  });

  it('starts with five attempts, as the domain default', () => {
    expect(sql).toMatch(/'max_attempts', 5\)\)/);
  });

  it('never writes the worker-facing not_found reason in SQL — the runner sends it', () => {
    // The wording is decided once, in packages/domain, and reaches N8 through
    // rtw_check_record's decision argument.
    expect(sql).not.toContain(RTW_NOT_FOUND_REASON);
  });
});
