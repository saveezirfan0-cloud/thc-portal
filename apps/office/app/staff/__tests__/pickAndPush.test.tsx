// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffRow } from '../types';

/**
 * ADR-0082 on the directory: tick workers, Send push to them. The ticks
 * are offered only to a login that may write and never on a removed
 * worker; they survive a page turn; the action is handed exactly the ticked
 * ids; a send clears them.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const actions = vi.hoisted(() => ({ messageStaff: vi.fn() }));
vi.mock('../messageActions', () => actions);

const { StaffScreen } = await import('../StaffScreen');

const BASE: StaffRow = {
  id: 'w1',
  employee_id: 873,
  status: 'compliant',
  removed: false,
  display_name: 'Amara K.',
  photo_path: null,
  photo_url: null,
  rating: 4.6,
  reliability: 98,
  block_kind: null,
  block_reason: null,
  rtw_branch: 'uk_irish',
  right_to_work_until: null,
  graduated_at: null,
  wtr_optout: false,
  left_at: null,
  leave_reason: null,
  role_names: ['Waiting Staff'],
  unresolved_violations: 0,
  do_not_return_clients: [],
  weekly_cap_hours: 48,
  weekly_cap_band: 'standard_48',
  weekly_booked_hours: 0,
  weekly_cap_until: null,
  last_shift_at: null,
  released_shift_count: 0,
  p45_requested_at: null,
};

const row = (id: string, name: string, over: Partial<StaffRow> = {}): StaffRow => ({
  ...BASE,
  id,
  display_name: name,
  ...over,
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  actions.messageStaff.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(staff: StaffRow[], canMessage = true) {
  act(() =>
    root.render(<StaffScreen staff={staff} students={[]} problem={null} canMessage={canMessage} />),
  );
}

const box = (label: string) =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === text);
const click = (el: HTMLElement | null | undefined) => {
  expect(el).toBeTruthy();
  act(() => el!.click());
};

describe('/staff · Send push to ticked workers (ADR-0082)', () => {
  it('offers no ticks to a login that may not write', () => {
    mount([row('w1', 'Amara K.')], false);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('offers a tick on every worker but a removed one', () => {
    mount([
      row('w1', 'Amara K.'),
      row('w2', 'Deleted account #2', { removed: true, status: 'removed' }),
    ]);
    expect(box('Select Amara K.')).not.toBeNull();
    expect(box('Select Deleted account #2')).toBeNull();
    // No bar until someone is ticked.
    expect(button('Clear')).toBeUndefined();
  });

  it('sends exactly the ticked workers, kept across a page turn, and clears after', async () => {
    // 16 workers: two pages of 15.
    const staff = Array.from({ length: 16 }, (_, i) =>
      row(`w${String(i + 1).padStart(2, '0')}`, `Worker ${String(i + 1).padStart(2, '0')}`),
    );
    mount(staff);
    click(box('Select Worker 02'));
    click(button('Next ›'));
    click(box('Select Worker 16'));
    expect(container.textContent).toContain('2 selected');

    actions.messageStaff.mockResolvedValue({
      ok: true,
      summary: 'Sent to 2 people.',
      everyoneReached: true,
    });
    click(button('Send push (2)'));
    const textarea = document.querySelector('textarea')!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(textarea, 'Uniforms are ready');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const send = [...document.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Send push',
    );
    await act(async () => send[send.length - 1]!.click());
    expect(actions.messageStaff).toHaveBeenCalledWith(['w02', 'w16'], 'Uniforms are ready');
    expect(document.body.textContent).toContain('Sent to 2 people.');

    click(button('Done'));
    expect(container.textContent).not.toContain('selected');
  });

  it('ticks and unticks everyone on the page at once', () => {
    mount([row('w1', 'Amara K.'), row('w2', 'Ben O.')]);
    click(box('Select everyone on this page'));
    expect(box('Select Amara K.')!.checked).toBe(true);
    expect(box('Select Ben O.')!.checked).toBe(true);
    expect(button('Send push (2)')).toBeTruthy();
    click(box('Select everyone on this page'));
    expect(button('Clear')).toBeUndefined();
  });
});
