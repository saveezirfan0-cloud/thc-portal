import { describe, expect, it, vi } from 'vitest';

// `gate.ts` imports the profile loader, which reads cookies; only `gateFor`
// (pure) is under test.
vi.mock('../../profile/data', () => ({ loadProfile: vi.fn() }));

import { gateFor } from '../gate';

describe('gateFor — which locks leave Documents open (§10.1)', () => {
  it('keeps Documents open, under the shell, for an onboarding-only worker (ADR-0106)', () => {
    // A SpudBros Express worker has to be able to renew a document; the
    // Profile hub sends them here, so a locked screen would be a loop.
    expect(gateFor('connecteam')).toEqual({ lock: 'connecteam', open: true, ignoreLock: true });
  });

  it('is unchanged for the other cases', () => {
    expect(gateFor('none')).toEqual({ lock: 'none', open: true, ignoreLock: false });
    expect(gateFor('documents')).toEqual({ lock: 'documents', open: true, ignoreLock: true });
    for (const lock of ['onboarding', 'hold', 'quiz_failed', 'rejected', 'leaver'] as const) {
      expect(gateFor(lock).open).toBe(false);
    }
  });
});
