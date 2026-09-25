import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import vectors from '../changeRequest.vectors.json' with { type: 'json' };
import {
  CHANGE_KINDS,
  decisionNeedsReason,
  isChangeKind,
  isOwnEvidencePath,
  isOwnPhotoPath,
  validateDecision,
  validateNameChange,
} from '../changeRequest';
import {
  CHANGE_REQUEST_STATUSES,
  CHANGE_REQUEST_TRANSITIONS,
  IllegalTransitionError,
  assertChangeRequestTransition,
  canTransitionChangeRequest,
  type ChangeRequestStatus,
} from '../state';

/**
 * ADR-0038 (docs/18 §3). The machine exists twice — CHANGE_REQUEST_TRANSITIONS
 * and profile_change_transitions() + profile_change_requests_state_guard in
 * 20260930100100 — and both are held to changeRequest.vectors.json: here, and
 * in pgTAP 651 through change_request_vectors.psql.
 */
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '../../scripts/gen-vectors-sql.mjs');
const generated = resolve(here, '../../../../supabase/tests/_shared/change_request_vectors.psql');
const sql = readFileSync(
  resolve(here, '../../../../supabase/migrations/20260930100100_staff_additions_schema.sql'),
  'utf8',
);

const edge = (from: string, to: string) => `${from}->${to}`;
const vectorEdges = new Set(vectors.edges.map((e) => edge(e.from, e.to)));

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

describe('change request machine — shared vectors (TS ↔ SQL profile_change_transitions)', () => {
  it('has the statuses of the vectors and of the table CHECK', () => {
    expect([...CHANGE_REQUEST_STATUSES].sort()).toEqual([...vectors.statuses].sort());
    expect(sqlCheckValues('profile_change_requests_status')).toEqual(
      [...CHANGE_REQUEST_STATUSES].sort(),
    );
  });

  it('has exactly the edges of the vectors file, in TS and in SQL', () => {
    const ts = Object.entries(CHANGE_REQUEST_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => edge(from, to)),
    );
    expect(ts.sort()).toEqual([...vectorEdges].sort());
    expect(sqlEdges('profile_change_transitions')).toEqual([...vectorEdges].sort());
  });

  const pairs = CHANGE_REQUEST_STATUSES.flatMap((from) =>
    CHANGE_REQUEST_STATUSES.map((to) => [from, to] as [ChangeRequestStatus, ChangeRequestStatus]),
  );
  it.each(pairs)('%s → %s', (from, to) => {
    const legal = from === to || vectorEdges.has(edge(from, to));
    expect(canTransitionChangeRequest(from, to)).toBe(legal);
    if (legal) expect(() => assertChangeRequestTransition(from, to)).not.toThrow();
    else expect(() => assertChangeRequestTransition(from, to)).toThrow(IllegalTransitionError);
  });

  it('names its machine in the error', () => {
    try {
      assertChangeRequestTransition('approved', 'pending');
    } catch (e) {
      expect((e as IllegalTransitionError).machine).toBe('change_request');
    }
  });

  it('every edge carries its reference', () => {
    for (const e of vectors.edges) expect(e.ref).toMatch(/ADR-0038/);
  });
});

describe('validateNameChange', () => {
  it.each(vectors.names.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const result = validateNameChange(c.input, vectors.current);
    if ('refusal' in c.expect) expect(result).toEqual({ ok: false, reason: c.expect.refusal });
    else expect(result).toEqual({ ok: true, ...c.expect });
  });

  it('without a name on file, nothing is "unchanged"', () => {
    expect(validateNameChange({ first: 'Maria', last: 'Lopez' }).ok).toBe(true);
  });
});

describe('the decision — a rejection must say why (the worker is shown it)', () => {
  it('needs a reason only to reject', () => {
    expect(decisionNeedsReason(false)).toBe(true);
    expect(decisionNeedsReason(true)).toBe(false);
  });

  it.each(vectors.decisions.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(validateDecision(c.approve, c.reason)).toBe(c.expect);
  });
});

describe("paths are the worker's own", () => {
  const me = '6f1f4b8e-0000-4000-8000-000000000001';
  const other = '6f1f4b8e-0000-4000-8000-000000000002';

  it('a photo lives under <staff_id>/', () => {
    expect(isOwnPhotoPath(me, `${me}/selfie-2.jpg`)).toBe(true);
    expect(isOwnPhotoPath(me, `${other}/selfie-2.jpg`)).toBe(false);
    expect(isOwnPhotoPath(me, `${me}/../${other}/selfie.jpg`)).toBe(false);
    expect(isOwnPhotoPath(me, `${me}/`)).toBe(false);
  });

  it('name evidence lives under <staff_id>/change-requests/', () => {
    expect(isOwnEvidencePath(me, `${me}/change-requests/abc.pdf`)).toBe(true);
    expect(isOwnEvidencePath(me, `${me}/passport.pdf`)).toBe(false);
  });

  it('has the two kinds the table allows', () => {
    expect([...CHANGE_KINDS].sort()).toEqual(sqlCheckValues('profile_change_requests_kind'));
    expect(isChangeKind('name')).toBe(true);
    expect(isChangeKind('email')).toBe(false);
  });
});

describe('the generated pgTAP vectors', () => {
  it('match changeRequest.vectors.json — run `pnpm --filter @thc/domain gen:vectors`', () => {
    const fresh = execFileSync('node', [script, '--stdout', 'changeRequest'], {
      encoding: 'utf8',
    });
    expect(readFileSync(generated, 'utf8')).toBe(fresh);
  });
});
