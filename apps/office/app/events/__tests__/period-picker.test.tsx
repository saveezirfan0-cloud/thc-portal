// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventQuery } from '../_lib/filters';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { PeriodPicker } = await import('../_components/PeriodPicker');

const week: EventQuery = {
  view: 'week',
  date: '2026-10-07',
  q: 'gala',
  clientId: 'c1',
  status: 'upcoming',
};

describe('the period label as a date picker (ADR-0104)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let showPicker: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    push.mockReset();
    showPicker = vi.fn();
    // jsdom has no showPicker.
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
      configurable: true,
      value: showPicker,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const mount = (query: EventQuery = week, label = 'Mon 5 Oct – Sun 11 Oct 2026') =>
    act(() => root.render(<PeriodPicker query={query} label={label} />));
  const button = () => container.querySelector('button.lbl') as HTMLButtonElement;
  const field = () => container.querySelector('input[type="date"]') as HTMLInputElement;
  const pick = (value: string) =>
    act(() => {
      // React listens for `input`; set the value the way the browser does.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        field(),
        value,
      );
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('still shows the period as its text, so the label reads as before', () => {
    mount();
    expect(button().textContent).toBe('Mon 5 Oct – Sun 11 Oct 2026');
  });

  it('opens the browser date picker on the current date when the label is pressed', () => {
    mount();
    expect(field().value).toBe('2026-10-07');
    act(() => button().click());
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('falls back to focusing and clicking the input where showPicker is unavailable', () => {
    showPicker.mockImplementation(() => {
      throw new Error('NotAllowedError');
    });
    mount();
    const click = vi.spyOn(field(), 'click');
    act(() => button().click());
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('goes to the chosen day, keeping the view and every filter', () => {
    mount();
    pick('2026-10-15');
    expect(push).toHaveBeenCalledTimes(1);
    const url = new URL(push.mock.calls[0]![0] as string, 'http://x');
    expect(url.pathname).toBe('/events');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      view: 'week',
      date: '2026-10-15',
      q: 'gala',
      client: 'c1',
      status: 'upcoming',
    });
  });

  it('does nothing for the day already showing or for a cleared field', () => {
    mount();
    pick('2026-10-07');
    pick('');
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps the picker out of the tab order: the button is the control', () => {
    mount();
    expect(field().tabIndex).toBe(-1);
    expect(field().getAttribute('aria-hidden')).toBe('true');
    expect(button().getAttribute('aria-label')).toContain('choose a date');
  });
});
