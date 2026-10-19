// @vitest-environment jsdom
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListedEvent } from '../data';
import { bucketByDay, toEventRows } from '../view-model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../_components/EventFilters', () => ({ EventFilters: () => null }));

const { EventToolbar } = await import('../_components/EventToolbar');
const { TodayLink } = await import('../_components/TodayLink');
const { ListView, MonthView, WeekView } = await import('../_components/EventViews');

/**
 * The toolbar's Today (§3.1). /events opens on today's period, so a link to
 * that same period did nothing a manager could see and Today read as broken.
 * It now lands on today: the cell, column or first row from today on.
 */
const TODAY = '2026-10-19';
// 10:00 BST on Monday 19 October.
const NOW = new Date('2026-10-19T09:00:00Z');

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function todayHref(query: { view: 'list' | 'month' | 'week' | 'day'; date: string }) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const html = renderToStaticMarkup(
    <EventToolbar query={{ q: '', clientId: '', status: '', ...query }} clients={[]} />,
  );
  return /<a href="([^"]+)" class="btn sm">Today<\/a>/.exec(html)?.[1]?.replaceAll('&amp;', '&');
}

describe('Today in the toolbar', () => {
  it('opens today in the view being read, at #today', () => {
    expect(todayHref({ view: 'week', date: '2026-12-05' })).toBe(
      `/events?view=week&date=${TODAY}#today`,
    );
    expect(todayHref({ view: 'list', date: '2026-12-05' })).toBe(
      `/events?view=list&date=${TODAY}#today`,
    );
  });
});

function click(onToday: boolean, target: HTMLElement | null) {
  const scrollIntoView = vi.fn();
  if (target) {
    target.scrollIntoView = scrollIntoView;
    document.body.append(target);
  }
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  const host = document.createElement('div');
  document.body.append(host);
  act(() => createRoot(host).render(<TodayLink href="/events?view=month" onToday={onToday} />));
  const link = host.querySelector('a')!;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  act(() => {
    link.dispatchEvent(event);
  });
  return { event, scrollIntoView };
}

function anchor() {
  const el = document.createElement('div');
  el.id = 'today';
  return el;
}

describe('TodayLink', () => {
  it("on today's period, stays put and scrolls today into view with a flash", () => {
    const el = anchor();
    const { event, scrollIntoView } = click(true, el);
    expect(event.defaultPrevented).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(el.classList.contains('landed')).toBe(true);
  });

  it('on another period, is an ordinary link', () => {
    const { event, scrollIntoView } = click(false, anchor());
    expect(event.defaultPrevented).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('with nothing to land on, does nothing rather than throw', () => {
    expect(click(true, null).event.defaultPrevented).toBe(true);
  });
});

function ev(id: string, date: string): ListedEvent {
  return {
    id,
    title: `Event ${id}`,
    date,
    clientId: 'c',
    clientName: 'Client',
    venueName: 'Venue',
    venueAddress: '',
    poNumber: '',
    cancelledAt: null,
    cancelReason: '',
    roles: [
      {
        roleName: 'Waiting Staff',
        start: '09:00',
        end: '17:00',
        headcount: 2,
        buffer: 0,
        confirmed: 2,
      },
    ],
  };
}

const ids = (html: string) => [...html.matchAll(/id="today"/g)].length;

describe('#today, where Today lands', () => {
  it('in the list, is the first row from today on — the next event when today has none', () => {
    const rows = toEventRows(
      [ev('a', '2026-10-12'), ev('b', '2026-10-21'), ev('c', '2026-10-22')],
      NOW,
    );
    const html = renderToStaticMarkup(<ListView rows={rows} today={TODAY} />);
    expect(ids(html)).toBe(1);
    expect(html).toMatch(/<tr id="today"[^>]*>(?:(?!<\/tr>).)*Event b/);
  });

  it('in the list, is absent when every event is past', () => {
    const rows = toEventRows([ev('a', '2026-10-12')], NOW);
    expect(ids(renderToStaticMarkup(<ListView rows={rows} today={TODAY} />))).toBe(0);
  });

  it("is today's month cell and today's week column", () => {
    const days = ['2026-10-18', TODAY, '2026-10-20'];
    const buckets = bucketByDay([], days);
    const month = renderToStaticMarkup(
      <MonthView
        cells={days.map((iso) => ({ iso, dayOfMonth: Number(iso.slice(8)), inMonth: true }))}
        buckets={buckets}
        today={TODAY}
      />,
    );
    expect(ids(month)).toBe(1);
    expect(month).toMatch(/id="today" class="day today"/);
    const week = renderToStaticMarkup(<WeekView days={days} buckets={buckets} today={TODAY} />);
    expect(ids(week)).toBe(1);
    expect(week).toMatch(/class="col today" id="today"/);
  });
});
