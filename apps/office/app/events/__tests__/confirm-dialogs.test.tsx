// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The event board asks its questions in the design system's Modal, never in
 * `window.confirm`, `window.prompt` or `window.alert`
 * (wireframes/backoffice/event-board.html). The payroll warnings
 * (BookingActions) moved first; Accept application (ApplicationActions) was
 * the one left behind, and is pinned here — with ADR-0042's Invite anyway
 * and ADR-0045's Open to pool and Decline cover: no dialog until the press,
 * and Cancel sends nothing.
 */
const actions = vi.hoisted(() => ({
  acceptApplication: vi.fn(async () => ({ ok: true as const })),
  openOfferToPool: vi.fn(async () => ({ ok: true as const })),
  declineCover: vi.fn(async () => ({ ok: true as const })),
  inviteWorker: vi.fn(async () => ({ ok: true as const })),
  getBack: vi.fn(async () => ({ ok: true as const })),
  markNoShow: vi.fn(async () => ({ ok: true as const })),
  withdraw: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock('../[id]/actions', () => actions);

const EVENTS = join(dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('no browser dialog on /events (wireframe, §3.3)', () => {
  it('no screen under /events calls window.confirm, window.prompt or window.alert', () => {
    const offenders = sources(EVENTS).filter((file) =>
      /window\.(confirm|prompt|alert)\s*\(/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('Accept application shows its button and no dialog until pressed', async () => {
    const { ApplicationActions } = await import('../[id]/_components/ApplicationActions');
    const html = renderToStaticMarkup(
      <ApplicationActions eventId="evt-1" bookingId="bk-1" name="Ada Lovelace" />,
    );
    expect(html).toContain('Accept application');
    expect(html).not.toContain('role="dialog"');
  });
});

// ---------------------------------------------------------------------
// The three Modals the additions brought to the board, pressed for real.
// ---------------------------------------------------------------------
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const fn of Object.values(actions)) fn.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(node: ReactNode) {
  act(() => root.render(node));
}
const dialog = () => container.querySelector('[role="dialog"]');
/** A button by its exact text — inside the dialog when `inDialog`. */
function button(label: string, inDialog = false): HTMLButtonElement {
  const scope = inDialog ? dialog() : container;
  const found = [...(scope?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent === label && (inDialog || !b.closest('[role="dialog"]')),
  );
  if (!found) throw new Error(`no button "${label}"`);
  return found as HTMLButtonElement;
}
async function press(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
/** Type into a React-controlled textarea: the native setter, then `input`. */
function type(area: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const COVER = {
  offerId: 'off-1',
  mode: 'office' as const,
  expiresAt: '2026-10-09T16:00:00Z',
  note: null,
};

describe('Open to pool (ADR-0045)', () => {
  it('asks in the Modal only once pressed, and Cancel sends nothing', async () => {
    const { BookingActions } = await import('../[id]/_components/BookingActions');
    const { OPEN_TO_POOL_CONFIRM } = await import('../[id]/board-model');
    mount(
      <BookingActions
        eventId="evt-1"
        bookingId="bk-1"
        noShow={false}
        confirmed
        payrollExported={false}
        offer={COVER}
      />,
    );
    expect(dialog()).toBeNull();

    await press(button('Open to pool'));
    expect(dialog()?.textContent).toContain(OPEN_TO_POOL_CONFIRM);

    await press(button('Cancel', true));
    expect(dialog()).toBeNull();
    expect(actions.openOfferToPool).not.toHaveBeenCalled();
  });

  it('sends only on the dialog’s own Open to pool', async () => {
    const { BookingActions } = await import('../[id]/_components/BookingActions');
    mount(
      <BookingActions
        eventId="evt-1"
        bookingId="bk-1"
        noShow={false}
        confirmed
        payrollExported={false}
        offer={COVER}
      />,
    );
    await press(button('Open to pool'));
    await press(button('Open to pool', true));
    expect(actions.openOfferToPool).toHaveBeenCalledWith('evt-1', 'off-1');
  });
});

describe('Decline cover, with the office’s note (ADR-0045)', () => {
  it('asks in the Modal only once pressed, and Cancel sends nothing — even with a note typed', async () => {
    const { BookingActions } = await import('../[id]/_components/BookingActions');
    mount(
      <BookingActions
        eventId="evt-1"
        bookingId="bk-1"
        noShow={false}
        confirmed
        payrollExported={false}
        offer={COVER}
      />,
    );
    expect(dialog()).toBeNull();

    await press(button('Decline'));
    const area = dialog()?.querySelector('textarea') as HTMLTextAreaElement;
    expect(area).not.toBeNull();
    type(area, 'Covered by phone');

    await press(button('Cancel', true));
    expect(dialog()).toBeNull();
    expect(actions.declineCover).not.toHaveBeenCalled();
  });

  it('holds the note to 300 characters, counting, as office_decline_cover() does', async () => {
    const { BookingActions } = await import('../[id]/_components/BookingActions');
    mount(
      <BookingActions
        eventId="evt-1"
        bookingId="bk-1"
        noShow={false}
        confirmed
        payrollExported={false}
        offer={COVER}
      />,
    );
    await press(button('Decline'));
    const area = dialog()?.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.maxLength).toBe(300);
    expect(dialog()?.textContent).toContain('0 / 300');
    type(area, 'Covered by phone');
    expect(dialog()?.textContent).toContain('16 / 300');

    await press(button('Decline', true));
    expect(actions.declineCover).toHaveBeenCalledWith('evt-1', 'off-1', 'Covered by phone');
  });

  it('offers neither button on a pool offer — only a cover request is the office’s to decide', async () => {
    const { BookingActions } = await import('../[id]/_components/BookingActions');
    mount(
      <BookingActions
        eventId="evt-1"
        bookingId="bk-1"
        noShow={false}
        confirmed
        payrollExported={false}
        offer={{ ...COVER, mode: 'pool' }}
      />,
    );
    expect(() => button('Open to pool')).toThrow();
    expect(() => button('Decline')).toThrow();
  });
});

describe('Invite anyway (ADR-0042)', () => {
  it('asks in the Modal only once pressed, and Cancel sends nothing', async () => {
    const { InviteAnyway } = await import('../[id]/_components/InviteAnyway');
    const { inviteAnywayPrompt } = await import('../[id]/board-model');
    mount(<InviteAnyway eventId="evt-1" shiftId="sh-1" staffId="st-1" name="Ada Lovelace" />);
    expect(dialog()).toBeNull();

    await press(button('Invite anyway'));
    expect(dialog()?.textContent).toContain(inviteAnywayPrompt('Ada Lovelace'));

    await press(button('Cancel', true));
    expect(dialog()).toBeNull();
    expect(actions.inviteWorker).not.toHaveBeenCalled();
  });

  it('invites only on the dialog’s own button', async () => {
    const { InviteAnyway } = await import('../[id]/_components/InviteAnyway');
    mount(<InviteAnyway eventId="evt-1" shiftId="sh-1" staffId="st-1" name="Ada Lovelace" />);
    await press(button('Invite anyway'));
    await press(button('Invite Ada Lovelace', true));
    expect(actions.inviteWorker).toHaveBeenCalledWith('evt-1', 'sh-1', 'st-1');
  });
});
