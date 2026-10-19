// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Go-live audit B5 for the list buttons ("I'm ready", "Accept", "Apply"…):
 * a press that never gets an answer frees the button and says so, instead
 * of throwing to error.tsx; one refused by a newer deploy reloads onto it.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const reloadForNewBuild = vi.hoisted(() => vi.fn(() => true));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../../_lib/stale-deploy', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reloadForNewBuild,
}));

const { ActionButton, NO_ANSWER } = await import('../ActionButton');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function press(action: () => Promise<never>) {
  await act(async () => {
    root.render(<ActionButton label="I’m ready" action={action} />);
  });
  await act(async () => {
    container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('ActionButton with no answer from the server', () => {
  it('says it did not go through, and the button is pressable again', async () => {
    await press(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(document.body.textContent).toContain(NO_ANSWER.title);
    expect(document.body.textContent).toContain(NO_ANSWER.body);
    const again = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'I’m ready',
    );
    expect(again?.disabled).toBe(false);
    expect(reloadForNewBuild).not.toHaveBeenCalled();
  });

  it('a stale deploy reloads instead', async () => {
    await press(() =>
      Promise.reject(Object.assign(new Error('not found'), { name: 'UnrecognizedActionError' })),
    );
    expect(reloadForNewBuild).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(NO_ANSWER.title);
  });
});

describe('ActionButton after an answer with something to say', () => {
  const buttonNamed = (name: string) =>
    [...document.body.querySelectorAll('button')].find((b) => b.textContent === name);

  it('a refusal stays up, and the screen refreshes only once it is dismissed', async () => {
    await press(
      () =>
        Promise.resolve({
          refusal: { title: 'Sorry, this shift has been taken', body: 'x' },
        }) as never,
    );
    expect(document.body.textContent).toContain('Sorry, this shift has been taken');
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => {
      buttonNamed('OK')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('a note does the same', async () => {
    await press(() => Promise.resolve({ ok: true, note: '1 overlapping invitation' }) as never);
    expect(document.body.textContent).toContain('1 overlapping invitation');
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => {
      buttonNamed('OK')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
