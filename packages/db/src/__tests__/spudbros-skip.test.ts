import { describe, expect, it } from 'vitest';
import { runSpudbrosSkipSweep } from '../spudbros';
import type { SkipDue, SkipSweepDeps } from '../spudbros';
import type { IssuedLink } from '../provision';

/**
 * SpudBros Express staff skip the Willo interview (ADR-0118): the SQL
 * leases who is due; this mints each one's login and link and hands it to
 * spudbros_skip_interview(). What must hold: a failure is recorded and
 * never stops the others, and nothing reaches the database without a link.
 */
function row(over: Partial<SkipDue> = {}): SkipDue {
  return { staff_id: 'staff-1', email: 'sam@example.com', user_id: null, attempt: 1, ...over };
}

const ok = (userId: string): IssuedLink => ({
  ok: true,
  userId,
  link: `https://staff.test/activate/${'a'.repeat(40)}`,
  installLink: 'https://staff.test/install',
  type: 'invite',
});

function deps(
  due: SkipDue[],
  issue: (c: { email: string; userId: string | null }) => IssuedLink = () => ok('user-1'),
  skip: (a: { staffId: string }) => { outcome: string } = () => ({ outcome: 'documents' }),
) {
  const skipped: { staffId: string; userId: string; link: string; installLink: string }[] = [];
  const failures: [string, string][] = [];
  const errors: string[] = [];
  const d: SkipSweepDeps = {
    due: async () => due,
    issue: async (c) => issue(c),
    skip: async (a) => {
      skipped.push(a);
      return skip(a);
    },
    recordFailure: async (staffId, reason) => {
      failures.push([staffId, reason]);
    },
    log: (level, message) => {
      if (level === 'error') errors.push(message);
    },
  };
  return { d, skipped, failures, errors };
}

describe('runSpudbrosSkipSweep', () => {
  it('does nothing when nobody is due', async () => {
    const t = deps([]);
    expect(await runSpudbrosSkipSweep(t.d)).toEqual({
      spudbros_due: 0,
      spudbros_moved: 0,
      spudbros_unchanged: 0,
      spudbros_failed: 0,
    });
    expect(t.skipped).toEqual([]);
  });

  it('mints the login and moves each one to Documents with its link', async () => {
    const t = deps([row(), row({ staff_id: 'staff-2', email: 'dot@example.com' })], (c) =>
      ok(`user-for-${c.email}`),
    );
    const result = await runSpudbrosSkipSweep(t.d);
    expect(result).toMatchObject({ spudbros_due: 2, spudbros_moved: 2, spudbros_failed: 0 });
    expect(t.skipped.map((s) => [s.staffId, s.userId])).toEqual([
      ['staff-1', 'user-for-sam@example.com'],
      ['staff-2', 'user-for-dot@example.com'],
    ]);
    expect(t.skipped[0]?.installLink).toBe('https://staff.test/install');
  });

  it('counts someone who moved on since the lease as unchanged', async () => {
    const t = deps([row()], undefined, () => ({ outcome: 'unchanged' }));
    expect(await runSpudbrosSkipSweep(t.d)).toMatchObject({
      spudbros_moved: 0,
      spudbros_unchanged: 1,
    });
  });

  it('records a login that could not be made, and carries on with the next', async () => {
    const t = deps([row(), row({ staff_id: 'staff-2', email: 'dot@example.com' })], (c) =>
      c.email === 'sam@example.com' ? { ok: false, code: 'account_not_staff' } : ok('user-2'),
    );
    const result = await runSpudbrosSkipSweep(t.d);
    expect(result).toMatchObject({ spudbros_moved: 1, spudbros_failed: 1 });
    expect(t.failures).toEqual([['staff-1', 'account_not_staff']]);
    expect(t.skipped.map((s) => s.staffId)).toEqual(['staff-2']);
  });

  it('records a database refusal, and carries on with the next', async () => {
    const t = deps([row(), row({ staff_id: 'staff-2' })], undefined, (a) => {
      if (a.staffId === 'staff-1') throw new Error('spudbros_skip_interview: unknown_staff');
      return { outcome: 'documents' };
    });
    const result = await runSpudbrosSkipSweep(t.d);
    expect(result).toMatchObject({ spudbros_moved: 1, spudbros_failed: 1 });
    expect(t.failures[0]?.[1]).toContain('unknown_staff');
  });

  it('never fails the sweep because a failure could not be recorded', async () => {
    const t = deps([row()], () => ({ ok: false, code: 'activation_link_required' }));
    t.d.recordFailure = async () => {
      throw new Error('down');
    };
    expect(await runSpudbrosSkipSweep(t.d)).toMatchObject({ spudbros_failed: 1 });
    expect(t.errors).toContain('[spudbros-skip] could not record the failure');
  });
});
