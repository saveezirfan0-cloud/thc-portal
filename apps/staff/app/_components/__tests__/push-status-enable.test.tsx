// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0158: the "Turn on" button in the banner asks for permission, subscribes
 * and records it in the same tap, instead of sending the worker to
 * /notifications for a second button. Pinned here: success clears the banner,
 * a "Block" at the system prompt turns it into the state's own message, and a
 * record that did not take is reported rather than shown as working.
 */
const push = vi.hoisted(() => ({
  enablePush: vi.fn(),
  currentSubscription: vi.fn(async () => null),
  registerServiceWorker: vi.fn(async () => null),
}));
const save = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../../notifications/actions', () => ({ savePushSubscription: save }));
vi.mock('../../../lib/push', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  ...push,
  readEnvironment: () => ({
    supported: true,
    standalone: true,
    ios: false,
    configured: true,
    permission: 'default' as NotificationPermission,
  }),
}));

const { PushStatus } = await import('../PushStatus');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SUBSCRIPTION = {
  endpoint: 'https://push.example/abc',
  p256dh: 'k',
  auth: 'a',
  userAgent: 'x',
};

let container: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount() {
  await act(async () => {
    root.render(<PushStatus />);
  });
  await flush();
}

const button = () => container.querySelector<HTMLButtonElement>('button.push-banner-cta');

beforeEach(() => {
  window.localStorage.clear();
  push.enablePush.mockReset();
  save.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the banner for a worker who has not been asked', () => {
  it('shows a Turn on button and no way to hide it', async () => {
    await mount();
    expect(container.textContent).toContain('Turn on notifications so you don’t miss shifts.');
    expect(button()?.textContent).toBe('Turn on');
    expect(container.querySelector('.push-banner-x')).toBeNull();
  });

  it('one tap: asks, subscribes, records it, and the banner goes', async () => {
    push.enablePush.mockResolvedValue({ ok: true, subscription: SUBSCRIPTION });
    save.mockResolvedValue({ ok: true });
    await mount();
    await act(async () => button()!.click());
    await flush();
    expect(push.enablePush).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(SUBSCRIPTION);
    expect(container.querySelector('.push-banner')).toBeNull();
    expect(window.localStorage.getItem('thc.push.was-on')).toBe('1');
  });

  it('Block at the system prompt: the banner becomes "Notifications are off", nothing is recorded', async () => {
    push.enablePush.mockResolvedValue({ ok: false, state: 'denied', message: 'off' });
    await mount();
    await act(async () => button()!.click());
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Notifications are off');
    expect(container.querySelector('a.push-banner-cta')?.getAttribute('href')).toBe(
      '/notifications',
    );
  });

  it('subscribed but the record did not take it: says so, and links to the explanation', async () => {
    push.enablePush.mockResolvedValue({ ok: true, subscription: SUBSCRIPTION });
    save.mockResolvedValue({ ok: false, error: 'nope' });
    await mount();
    await act(async () => button()!.click());
    await flush();
    expect(container.textContent).toContain('That didn’t work — open Notifications for help.');
    expect(container.querySelector('a.push-banner-cta')?.getAttribute('href')).toBe(
      '/notifications',
    );
    expect(window.localStorage.getItem('thc.push.was-on')).toBeNull();
  });
});
