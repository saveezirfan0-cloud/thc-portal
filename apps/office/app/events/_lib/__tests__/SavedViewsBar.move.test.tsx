// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEventQuery } from '../filters';
import { SAVED_VIEWS_KEY, type SavedView } from '../saved-views';

/**
 * The one-tap move of this browser's pre-table views into the account
 * (ADR-0053): offered only when the account has none, cleared from
 * localStorage only once the database has them, and kept when it refuses.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const actions = vi.hoisted(() => ({
  saveMyView: vi.fn(),
  deleteMyView: vi.fn(),
  moveLocalViews: vi.fn(),
  listMySavedViews: vi.fn(),
}));
vi.mock('../saved-views-actions', () => actions);

const { SavedViewsBar } = await import('../SavedViewsBar');

const QUERY = parseEventQuery({}, '2026-09-25');
const OLD: SavedView[] = [
  { name: 'Weddings', filters: { view: 'week', q: '', clientId: '', status: 'upcoming' } },
];

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const fn of Object.values(actions)) fn.mockReset();
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(initial: Parameters<typeof SavedViewsBar>[0]['initial']) {
  act(() => root.render(<SavedViewsBar query={QUERY} clients={[]} initial={initial} />));
}

function moveButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Move my saved views to my account',
  );
}

describe('Move my saved views to my account', () => {
  it('is offered when the browser has views and the account has none; clears storage after', async () => {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(OLD));
    actions.moveLocalViews.mockResolvedValue({
      ok: true,
      views: [{ id: 'row-1', ...OLD[0] }],
      message: 'Moved 1 saved view to your account.',
    });
    mount({ ok: true, views: [] });
    expect(container.textContent).toContain('1 saved view is still only in this browser.');

    await act(async () => moveButton()!.click());

    expect(actions.moveLocalViews).toHaveBeenCalledWith(OLD);
    expect(window.localStorage.getItem(SAVED_VIEWS_KEY)).toBeNull();
    expect(moveButton()).toBeUndefined();
    expect(container.textContent).toContain('Weddings');
    expect(container.textContent).toContain('Moved 1 saved view to your account.');
  });

  it("keeps this browser's copy when the database refuses", async () => {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(OLD));
    actions.moveLocalViews.mockResolvedValue({
      ok: false,
      readOnly: true,
      message: 'This login is not allowed to change saved views.',
    });
    mount({ ok: true, views: [] });
    await act(async () => moveButton()!.click());

    expect(window.localStorage.getItem(SAVED_VIEWS_KEY)).not.toBeNull();
    expect(container.textContent).toContain('Saved views are read-only here');
  });

  it('is not offered when the account already has views', () => {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(OLD));
    mount({ ok: true, views: [{ id: 'row-9', name: 'Mine', filters: OLD[0]!.filters }] });
    expect(moveButton()).toBeUndefined();
  });

  it("with the table unreadable, still opens this browser's views read-only", () => {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(OLD));
    mount({ ok: false, readOnly: true, message: 'Saved views could not be reached.' });
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/events?view=week&date=2026-09-25&status=upcoming',
    );
    expect(moveButton()).toBeUndefined();
    expect(container.textContent).not.toContain('Save view');
  });
});
