// @vitest-environment jsdom
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { periodLabel } from '../calendar';
import { eventsHref } from '../_lib/filters';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const {
  BackToScheduling,
  RememberSchedulingView,
  SCHEDULING_RETURN_KEY,
  readSchedulingReturn,
  schedulingReturnHref,
  schedulingReturnLabel,
} = await import('../_components/BackToScheduling');

/**
 * ADR-0195. The event board's way back to Scheduling opens the view it was
 * left in — Week of 12 Oct, filtered to one client — not the default List at
 * today, which is all the sidebar and the old crumb could do.
 */

const WEEK = {
  view: 'week' as const,
  date: '2026-10-12',
  q: '',
  clientId: 'c-halkin',
  status: '',
};
const WEEK_HREF = eventsHref(WEEK);
const WEEK_LABEL = schedulingReturnLabel('week', periodLabel('week', WEEK.date));

afterEach(() => {
  window.sessionStorage.clear();
  document.body.innerHTML = '';
});

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => act(() => root.unmount()) };
}

describe('the label', () => {
  it('names the view and its period', () => {
    expect(WEEK_LABEL).toBe('Week · Mon 12 Oct – Sun 18 Oct 2026');
    expect(schedulingReturnLabel('day', periodLabel('day', '2026-10-14'))).toBe(
      'Day · Wed 14 Oct 2026',
    );
    expect(schedulingReturnLabel('month', periodLabel('month', '2026-10-14'))).toBe(
      'Month · October 2026',
    );
  });
});

describe('reading the stored way back', () => {
  it('takes a Scheduling URL', () => {
    expect(readSchedulingReturn(JSON.stringify({ href: WEEK_HREF, label: WEEK_LABEL }))).toEqual({
      href: WEEK_HREF,
      label: WEEK_LABEL,
    });
  });

  it('ignores anything that is not this app’s /events', () => {
    for (const href of [
      'https://evil.example/events?view=week',
      '//evil.example/events?view=week',
      '/staff?view=week',
      '/events/abc',
      'javascript:alert(1)',
    ]) {
      expect(readSchedulingReturn(JSON.stringify({ href, label: 'x' }))).toBeNull();
    }
    expect(readSchedulingReturn(null)).toBeNull();
    expect(readSchedulingReturn('not json')).toBeNull();
    expect(readSchedulingReturn(JSON.stringify({ href: WEEK_HREF }))).toBeNull();
  });
});

describe('Scheduling → event board → back', () => {
  it('returns to the week, with its filters, that the board was opened from', () => {
    const scheduling = mount(<RememberSchedulingView href={WEEK_HREF} label={WEEK_LABEL} />);
    scheduling.unmount();

    const board = mount(
      <>
        <BackToScheduling variant="crumb" />
        <BackToScheduling />
      </>,
    );
    const [crumb, button] = Array.from(board.host.querySelectorAll('a'));
    expect(crumb?.getAttribute('href')).toBe(WEEK_HREF);
    expect(crumb?.textContent).toBe('Scheduling');
    expect(button?.getAttribute('href')).toBe(WEEK_HREF);
    expect(button?.textContent).toBe(`← Back to ${WEEK_LABEL}`);
    expect(WEEK_HREF).toBe('/events?view=week&date=2026-10-12&client=c-halkin');
  });

  it('keeps the latest view when the manager moves on before opening an event', () => {
    const first = mount(<RememberSchedulingView href={WEEK_HREF} label={WEEK_LABEL} />);
    first.unmount();
    const nextWeek = eventsHref({ ...WEEK, date: '2026-10-19' });
    const second = mount(<RememberSchedulingView href={nextWeek} label="Week · next" />);
    second.unmount();
    expect(JSON.parse(window.sessionStorage.getItem(SCHEDULING_RETURN_KEY)!).href).toBe(nextWeek);
  });

  it('falls back to /events when the board was opened without Scheduling', () => {
    const board = mount(<BackToScheduling />);
    const link = board.host.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/events');
    expect(link?.textContent).toBe('← Back to Scheduling');
  });

  it('renders the plain /events link on the server, before storage is read', () => {
    window.sessionStorage.setItem(
      SCHEDULING_RETURN_KEY,
      JSON.stringify({ href: WEEK_HREF, label: WEEK_LABEL }),
    );
    const html = renderToStaticMarkup(<BackToScheduling />);
    expect(html).toContain('href="/events"');
    expect(html).toContain('Back to Scheduling');
  });

  it('still renders when storage throws (private mode, blocked site data)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const board = mount(<BackToScheduling />);
    expect(board.host.querySelector('a')?.getAttribute('href')).toBe('/events');
    spy.mockRestore();
  });
});

describe('a period opened at today', () => {
  it('is kept without its date, so it goes back to today’s period on another day', () => {
    const href = eventsHref({ ...WEEK, date: '2026-10-22' });
    expect(schedulingReturnHref(href, '2026-10-22', '2026-10-22')).toBe(
      '/events?view=week&client=c-halkin',
    );
    expect(
      schedulingReturnHref('/events?view=list&date=2026-10-22', '2026-10-22', '2026-10-22'),
    ).toBe('/events?view=list');
    expect(readSchedulingReturn(JSON.stringify({ href: '/events', label: 'x' }))?.href).toBe(
      '/events',
    );
  });

  it('keeps any other date', () => {
    expect(schedulingReturnHref(WEEK_HREF, WEEK.date, '2026-10-22')).toBe(WEEK_HREF);
  });
});
