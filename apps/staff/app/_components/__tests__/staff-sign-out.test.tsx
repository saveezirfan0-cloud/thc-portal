// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetThisDevice } from '../../../lib/push';

/**
 * Security round 12.10, item 3: signing out forgets this device's Web Push
 * subscription — the record's row (`forget_push_subscription`) and the
 * browser's own — so the signed-out worker's notifications stop arriving
 * on a phone they no longer hold. Best effort: nothing here may stop the
 * sign-out POST from going.
 */
const forgetPushSubscription = vi.hoisted(() => vi.fn());
vi.mock('../../notifications/actions', () => ({
  forgetPushSubscription: (endpoint: string) => forgetPushSubscription(endpoint),
}));

const { StaffSignOut } = await import('../StaffSignOut');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeNavigator(
  subscription: { endpoint: string; unsubscribe: () => Promise<boolean> } | null,
) {
  return {
    serviceWorker: {
      getRegistration: vi.fn(async () => ({
        pushManager: { getSubscription: vi.fn(async () => subscription) },
      })),
    },
  } as unknown as Navigator;
}

describe('forgetThisDevice', () => {
  it('forgets the endpoint in the record, then unsubscribes the browser', async () => {
    const unsubscribe = vi.fn(async () => true);
    const forget = vi.fn(async () => ({ ok: true }));
    const done = await forgetThisDevice(
      forget,
      1_000,
      fakeNavigator({ endpoint: 'https://push.example/abc', unsubscribe }),
    );
    expect(done).toBe(true);
    expect(forget).toHaveBeenCalledWith('https://push.example/abc');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(forget.mock.invocationCallOrder[0]).toBeLessThan(
      unsubscribe.mock.invocationCallOrder[0]!,
    );
  });

  it('a failing forget still unsubscribes; nothing throws', async () => {
    const unsubscribe = vi.fn(async () => true);
    const forget = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(
      forgetThisDevice(forget, 1_000, fakeNavigator({ endpoint: 'e', unsubscribe })),
    ).resolves.toBe(true);
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('with no subscription, or no service worker, there is nothing to do', async () => {
    const forget = vi.fn();
    expect(await forgetThisDevice(forget, 1_000, fakeNavigator(null))).toBe(false);
    expect(await forgetThisDevice(forget, 1_000, {} as Navigator)).toBe(false);
    expect(forget).not.toHaveBeenCalled();
  });

  it('gives up rather than wait on a hung network', async () => {
    vi.useFakeTimers();
    const hung = new Promise(() => {});
    const pending = forgetThisDevice(
      () => hung,
      1_500,
      fakeNavigator({ endpoint: 'e', unsubscribe: async () => true }),
    );
    await vi.advanceTimersByTimeAsync(1_600);
    expect(await pending).toBe(false);
    vi.useRealTimers();
  });
});

describe('<StaffSignOut>', () => {
  let container: HTMLDivElement;
  let root: Root;
  const submit = vi.fn();
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    HTMLFormElement.prototype.submit = submit;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  });

  function useNavigator(nav: Navigator) {
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
  }

  async function signOut() {
    act(() => root.render(<StaffSignOut size="md" block />));
    const form = container.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/auth/signout');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
  }

  it('forgets and unsubscribes this device, then posts the sign-out', async () => {
    const unsubscribe = vi.fn(async () => true);
    forgetPushSubscription.mockResolvedValue({ ok: true });
    useNavigator(fakeNavigator({ endpoint: 'https://push.example/abc', unsubscribe }));
    window.localStorage.setItem('thc.push.was-on', '1');
    await signOut();
    expect(forgetPushSubscription).toHaveBeenCalledWith('https://push.example/abc');
    expect(unsubscribe).toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      submit.mock.invocationCallOrder[0]!,
    );
    expect(window.localStorage.getItem('thc.push.was-on')).toBeNull();
  });

  it('still signs out when the clean-up fails', async () => {
    forgetPushSubscription.mockRejectedValue(new Error('offline'));
    useNavigator(
      fakeNavigator({
        endpoint: 'e',
        unsubscribe: async () => {
          throw new Error('nope');
        },
      }),
    );
    await signOut();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('still signs out on a device with no push at all', async () => {
    useNavigator({} as Navigator);
    await signOut();
    expect(forgetPushSubscription).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
