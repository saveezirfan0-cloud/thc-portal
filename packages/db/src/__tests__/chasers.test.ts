import { describe, expect, it } from 'vitest';
import { runChaserSweep } from '../chasers';
import type { ActivationDue, ChaserQueueAnswer, ChaserSweepDeps } from '../chasers';
import type { IssuedLink } from '../provision';

/**
 * The onboarding-chasers job (ADR-0071): the SQL decides who is due; this
 * mints each OC2's activation link and hands it back. What must hold:
 * nothing is minted unless the database named the row (a mint kills the
 * link already in the candidate's inbox), and one failure never stops the
 * others.
 */
function due(over: Partial<ActivationDue> = {}): ActivationDue {
  return { staffId: 'staff-1', userId: 'user-1', email: 'ada@example.com', rung: 1, ...over };
}

function deps(
  answer: ChaserQueueAnswer,
  issue: (c: { email: string; userId: string }) => IssuedLink | Promise<IssuedLink> = (c) => ({
    ok: true,
    userId: c.userId,
    link: `https://staff.test/activate/${'a'.repeat(40)}`,
    installLink: 'https://staff.test/install',
    type: 'invite',
  }),
  deliver: (a: { staffId: string }) => { queued: boolean } = () => ({ queued: true }),
) {
  const minted: string[] = [];
  const delivered: { staffId: string; userId: string; link: string; installLink: string }[] = [];
  const errors: string[] = [];
  const d: ChaserSweepDeps = {
    queue: async () => answer,
    issue: async (c) => {
      minted.push(c.email);
      return issue(c);
    },
    deliver: async (a) => {
      delivered.push(a);
      return deliver(a);
    },
    log: (level, message) => {
      if (level === 'error') errors.push(message);
    },
  };
  return { d, minted, delivered, errors };
}

describe('runChaserSweep', () => {
  it('mints nothing when the job is outside its hours or switched off', async () => {
    const t = deps({ skipped: 'outside 10:00–18:00 UK', activation: [due()] });
    const result = await runChaserSweep(t.d);
    expect(result.skipped).toBe('outside 10:00–18:00 UK');
    expect(t.minted).toEqual([]);
    expect(t.delivered).toEqual([]);
  });

  it('reports the emails and pushes the database queued', async () => {
    const t = deps({ oc1: 2, oc3: 5, activation: [] });
    expect(await runChaserSweep(t.d)).toEqual({
      oc1: 2,
      oc3: 5,
      oc2_due: 0,
      oc2_queued: 0,
      oc2_not_due: 0,
      oc2_failed: 0,
    });
    expect(t.minted).toEqual([]);
  });

  it('mints a link for each OC2 due and hands it to the database', async () => {
    const t = deps({
      oc1: 0,
      oc3: 0,
      activation: [due(), due({ staffId: 'staff-2', userId: 'user-2', email: 'bo@example.com' })],
    });
    const result = await runChaserSweep(t.d);
    expect(t.minted).toEqual(['ada@example.com', 'bo@example.com']);
    expect(t.delivered).toEqual([
      {
        staffId: 'staff-1',
        userId: 'user-1',
        link: `https://staff.test/activate/${'a'.repeat(40)}`,
        installLink: 'https://staff.test/install',
      },
      {
        staffId: 'staff-2',
        userId: 'user-2',
        link: `https://staff.test/activate/${'a'.repeat(40)}`,
        installLink: 'https://staff.test/install',
      },
    ]);
    expect(result.oc2_queued).toBe(2);
  });

  it('counts a row the database no longer thinks is due (activated in between)', async () => {
    const t = deps({ activation: [due()] }, undefined, () => ({ queued: false }));
    const result = await runChaserSweep(t.d);
    expect(result).toMatchObject({ oc2_due: 1, oc2_queued: 0, oc2_not_due: 1, oc2_failed: 0 });
  });

  it('never hands the database a link that was not issued, and carries on', async () => {
    const t = deps(
      {
        activation: [due(), due({ staffId: 'staff-2', userId: 'user-2', email: 'bo@example.com' })],
      },
      (c) =>
        c.email === 'ada@example.com'
          ? { ok: false, code: 'activation_link_required' }
          : {
              ok: true,
              userId: c.userId,
              link: `https://staff.test/activate/${'b'.repeat(40)}`,
              installLink: 'https://staff.test/install',
              type: 'invite',
            },
    );
    const result = await runChaserSweep(t.d);
    expect(t.delivered.map((d) => d.staffId)).toEqual(['staff-2']);
    expect(result).toMatchObject({ oc2_due: 2, oc2_queued: 1, oc2_failed: 1 });
    expect(t.errors).toEqual(['[onboarding-chasers] activation link not issued']);
  });

  it('survives a throw from the database for one candidate', async () => {
    const t = deps(
      { activation: [due(), due({ staffId: 'staff-2', userId: 'user-2' })] },
      undefined,
      (a) => {
        if (a.staffId === 'staff-1') throw new Error('account_mismatch');
        return { queued: true };
      },
    );
    const result = await runChaserSweep(t.d);
    expect(result).toMatchObject({ oc2_queued: 1, oc2_failed: 1 });
  });

  it('mints nothing for a row without a login', async () => {
    const t = deps({ activation: [due({ userId: null })] });
    const result = await runChaserSweep(t.d);
    expect(t.minted).toEqual([]);
    expect(result.oc2_failed).toBe(1);
  });
});
