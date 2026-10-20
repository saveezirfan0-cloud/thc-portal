// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ListedEvent } from '../data';
import { toEventRows } from '../view-model';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ListView } = await import('../_components/EventViews');

const before = new Date('2026-10-06T09:00:00Z');

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
        roleName: 'Bar Staff',
        start: '10:00',
        end: '14:00',
        headcount: 1,
        buffer: 0,
        confirmed: 0,
      },
    ],
  };
}

/** Whether each list row, in order, carries the alternate day shade. */
function shaded(events: ListedEvent[]) {
  const html = renderToStaticMarkup(
    <ListView rows={toEventRows(events, before)} today="2026-10-06" />,
  );
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('tbody tr')).map((tr) => tr.classList.contains('day-alt'));
}

describe('the events list shades alternate days', () => {
  it('gives every event on one date the same shade and flips it on the next date', () => {
    expect(
      shaded([
        ev('a', '2026-10-15'),
        ev('b', '2026-10-15'),
        ev('c', '2026-10-15'),
        ev('d', '2026-10-16'),
        ev('e', '2026-10-17'),
        ev('f', '2026-10-17'),
      ]),
    ).toEqual([false, false, false, true, false, false]);
  });

  it('leaves a single day unshaded', () => {
    expect(shaded([ev('a', '2026-10-15'), ev('b', '2026-10-15')])).toEqual([false, false]);
  });
});
