import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Go-live audit M5 · Documents reads in two waves, and never reads a held
 * worker's documents.
 *
 *   wave 1  staff_me(): the gate, shared with the shell (React.cache)
 *   wave 2  the documents and right-to-work checks, only when the gate is
 *           open, alongside the header photo's signature, which
 *           `preloadShell()` starts as soon as staff_me() answers
 *           (request-dedupe.test.ts pins that half).
 *
 * The documents are not read speculatively alongside staff_me(): on a
 * manual hold, a failed quiz, a leaver or a removal they must not be read
 * at all (§10.1 cases 2–4), so they wait for the gate.
 */
const h = vi.hoisted(() => ({
  order: [] as string[],
  gate: { open: true, lock: 'none', ignoreLock: false, profile: null } as Record<string, unknown>,
}));

vi.mock('../../_components/preloadShell', () => ({
  preloadShell: () => h.order.push('preloadShell'),
}));
vi.mock('../gate', () => ({
  documentsGate: async () => {
    h.order.push('gate');
    return h.gate;
  },
}));
vi.mock('../data', () => ({
  supabaseConfigured: () => true,
  loadDocuments: async () => {
    h.order.push('documents');
    return { documents: [] };
  },
}));
vi.mock('../../_lib/rtwCheck', () => ({
  loadMyRtwChecks: async () => {
    h.order.push('rtwChecks');
    return {};
  },
}));
vi.mock('../../_lib/timeFormat', () => ({ getTimeFormat: async () => '24h' }));
vi.mock('../model', () => ({ buildDocumentsView: () => ({ checking: false }) }));
vi.mock('../../_components/StaffShell', () => ({ StaffShell: () => null }));

const { default: DocumentsPage } = await import('../page');

const open = () => DocumentsPage({ searchParams: Promise.resolve({}) });

beforeEach(() => {
  h.order.length = 0;
  h.gate = { open: true, lock: 'none', ignoreLock: false, profile: null };
});

describe('/documents', () => {
  it('starts the shell’s reads before it waits on the gate', async () => {
    await open();
    expect(h.order.indexOf('preloadShell')).toBeLessThan(h.order.indexOf('gate'));
  });

  it('reads the documents and the checks together once the gate is open', async () => {
    await open();
    expect(h.order).toEqual(['preloadShell', 'gate', 'documents', 'rtwChecks']);
  });

  it.each(['hold', 'quiz_failed', 'leaver', 'removed'])(
    'never reads the documents of a worker the %s lock shuts out',
    async (lock) => {
      h.gate = { open: false, lock, ignoreLock: false, profile: null };
      await open();
      expect(h.order).not.toContain('documents');
      expect(h.order).not.toContain('rtwChecks');
    },
  );
});
