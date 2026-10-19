// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Go-live audit H4: `PushStatus` re-sends the subscription only when it,
 * or the signed-in worker, changed — or a day has passed. It used to write
 * on every mount, focus and visibility change.
 */
const SUB = { endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a', userAgent: 'ua' };
const push = vi.hoisted(() => ({
  current: null as null | Record<string, string>,
}));
const save = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ ok: true as const })));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../../../lib/push', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readEnvironment: () => ({
    supported: true,
    standalone: true,
    ios: false,
    configured: true,
    permission: 'granted',
  }),
  registerServiceWorker: async () => null,
  currentSubscription: async () => push.current,
  enablePush: async () => ({ ok: false, state: 'granted', message: '' }),
}));
vi.mock('../../notifications/actions', () => ({
  savePushSubscription: (...args: unknown[]) => save(...args),
}));

const { PushStatus } = await import('../PushStatus');
const { RESAVE_AFTER_MS, SAVED_KEY, fingerprint, savedRecord, shouldSave } =
  await import('../push-save-memo');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
}

let container: HTMLDivElement;
let root: Root;

/** Mount, let the async sync settle, unmount — one screen visit. */
async function visit(staffId: string | null = 'staff-1') {
  await act(async () => {
    root.render(<PushStatus staffId={staffId} />);
  });
  await act(async () => {
    // The fingerprint is a real SubtleCrypto digest: let it and the save land.
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
  });
  act(() => root.unmount());
  root = createRoot(container);
}

beforeEach(() => {
  save.mockClear();
  save.mockResolvedValue({ ok: true });
  push.current = { ...SUB };
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('PushStatus saves the subscription only when there is something to say', () => {
  it('once for the first screen, not again for the next ones', async () => {
    await visit();
    await visit();
    await visit();
    expect(save).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(SAVED_KEY)).not.toContain(SUB.endpoint);
  });

  it('again when another worker signs in on this phone', async () => {
    await visit('staff-1');
    await visit('staff-2');
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('again when the subscription changed', async () => {
    await visit();
    push.current = { ...SUB, endpoint: 'https://push.example/rotated' };
    await visit();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('again when the record refused it last time', async () => {
    save.mockResolvedValueOnce({ ok: false, error: 'x' } as never);
    await visit();
    await visit();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('always, when who is signed in is not known', async () => {
    await visit(null);
    await visit(null);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('a lost save does not take the page down', async () => {
    save.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await visit();
    await visit();
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe('shouldSave', () => {
  it('after 24 hours, or with nothing remembered, or a different fingerprint', async () => {
    const print = await fingerprint(SUB, 'staff-1');
    expect(print).toMatch(/^[0-9a-f]{64}$/);
    const record = savedRecord(print!, 1_000);
    expect(shouldSave(record, print, 1_000 + RESAVE_AFTER_MS - 1)).toBe(false);
    expect(shouldSave(record, print, 1_000 + RESAVE_AFTER_MS)).toBe(true);
    expect(shouldSave(null, print, 1_000)).toBe(true);
    expect(shouldSave(record, await fingerprint(SUB, 'staff-2'), 1_000)).toBe(true);
    expect(shouldSave('not json', print, 1_000)).toBe(true);
    expect(shouldSave(record, null, 1_000)).toBe(true);
  });
});
