// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ViolationRow } from '../types';

/**
 * ADR-0085. The old `datetime-local` could not hold garbage; the platform's
 * time field can, and it reports "not a time" as "" — the same as "left
 * empty". For a No-show whose section has not ended an empty arrival means
 * "register them as arriving NOW", and an empty finish means "raise a No
 * check-out", both of which move pay. So a typo or a half-filled pair must
 * keep Resolve disabled, never quietly take the empty meaning.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@thc/db/browser', () => ({ createClient: vi.fn() }));
const resolveViolation = vi.fn(async () => ({ ok: true }));
vi.mock('../actions', () => ({ resolveViolation }));

const { ResolveModal } = await import('../ResolveModal');

const IN_THE_FUTURE = new Date(Date.now() + 6 * 3600_000).toISOString();

const NO_SHOW: ViolationRow = {
  id: 'v1',
  bookingId: 'b1',
  staffName: 'Omar S.',
  photoUrl: null,
  eventTitle: 'Press Night',
  venueName: 'Mandarin Oriental',
  roleName: 'Waiting Staff',
  startsAt: new Date(Date.now() - 3600_000).toISOString(),
  endsAt: IN_THE_FUTURE, // not ended: the arrival is optional
  type: 'no_show',
  detectedAt: new Date().toISOString(),
  minutesLate: null,
  resolved: false,
  resolvedAt: null,
  resolvedByName: null,
  resolutionNote: null,
  actualFinishAt: null,
  checkInAt: null,
  checkOutAt: null,
  payrollExported: false,
  flaggedAs: 'No-show — Press Night',
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  resolveViolation.mockClear();
});

function setValue(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!;
  act(() => {
    set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function open() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<ResolveModal violation={NO_SHOW} onClose={() => {}} />));
  const q = <T extends Element>(sel: string) => document.body.querySelector<T>(sel)!;
  const resolve = () =>
    [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Resolve')!;
  return {
    date: () => q<HTMLInputElement>('input[aria-label="Date"]'),
    time: () => q<HTMLInputElement>('input[aria-label="Time"]'),
    note: () => q<HTMLTextAreaElement>('textarea'),
    resolve,
  };
}

describe('Resolve a No-show before the section has ended', () => {
  it('can be resolved with the arrival left empty (arrives "now")', () => {
    const d = open();
    setValue(d.note(), 'Arrived late, agreed by phone.');
    expect(d.resolve().disabled).toBe(false);
  });

  it('cannot be resolved while the time is not a time', () => {
    const d = open();
    setValue(d.note(), 'Arrived late, agreed by phone.');
    setValue(d.time(), '9pmm');
    expect(d.resolve().disabled).toBe(true);
    setValue(d.time(), '25:00');
    expect(d.resolve().disabled).toBe(true);
  });

  it('cannot be resolved with only a time, or only a date', () => {
    const d = open();
    setValue(d.note(), 'Arrived late, agreed by phone.');
    setValue(d.time(), '18:30');
    expect(d.resolve().disabled).toBe(true); // time, no date
    setValue(d.date(), '2026-09-17');
    expect(d.resolve().disabled).toBe(false); // both
    setValue(d.time(), '');
    expect(d.resolve().disabled).toBe(true); // date, no time
  });

  it('is resolvable again once the pair is cleared or corrected', () => {
    const d = open();
    setValue(d.note(), 'Arrived late, agreed by phone.');
    setValue(d.time(), 'xx');
    expect(d.resolve().disabled).toBe(true);
    setValue(d.time(), '');
    expect(d.resolve().disabled).toBe(false);
  });

  it('sends the typed arrival as one UK wall-clock instant when both are valid', async () => {
    const d = open();
    setValue(d.note(), 'Arrived late, agreed by phone.');
    setValue(d.date(), '2026-09-17');
    setValue(d.time(), '7:30 pm');
    expect(d.resolve().disabled).toBe(false);
    await act(async () => d.resolve().click());
    const [, , finishIso, arrivedIso] = resolveViolation.mock.calls[0] as unknown as [
      string,
      string,
      string | null,
      string | null,
    ];
    expect(finishIso).toBeNull();
    expect(arrivedIso).toBe('2026-09-17T18:30:00.000Z'); // 19:30 BST
  });
});
