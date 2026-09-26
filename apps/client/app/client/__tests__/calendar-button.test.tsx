import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineupRow, PortalEvent, RoleSection } from '../rules';

/**
 * "Add to calendar" in the event page's header (ADR-0050): shown beside
 * the download, hidden for a cancelled event, and on click a Blob download
 * named after the event, built from the page's own origin. The file's
 * contents are ics.test.ts's; this covers the wiring.
 */
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../events/[id]/actions', () => ({ leaveFeedback: vi.fn() }));

const { CalendarButton } = await import('../events/[id]/CalendarButton');
const { EventScreen } = await import('../events/[id]/EventScreen');

const EVENT_ID = '60000000-0000-4000-8000-000000000001';

const gala = (over: Partial<PortalEvent> = {}): PortalEvent => ({
  id: EVENT_ID,
  title: 'Gala Dinner',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St, EC4V 5AJ',
  eventDate: '2026-09-19',
  poNumber: '4471-A',
  onsiteContact: 'Marco Vitale · Banqueting manager',
  startsAt: '2026-09-19T06:00:00Z',
  endsAt: '2026-09-19T22:30:00Z',
  status: 'upcoming',
  ...over,
});

const sections: RoleSection[] = [
  {
    shiftId: 's-chef',
    eventId: EVENT_ID,
    role: 'Chef',
    startsAt: '2026-09-19T06:00:00Z',
    endsAt: '2026-09-19T14:00:00Z',
    headcount: 1,
    confirmed: 1,
  },
];
const lineup: LineupRow[] = [
  {
    bookingId: 'b-1',
    eventId: EVENT_ID,
    shiftId: null,
    role: 'Chef',
    startsAt: '2026-09-19T06:00:00Z',
    endsAt: '2026-09-19T14:00:00Z',
    name: 'Amelia Hart',
    photoPath: null,
    sortKey: 'Hart Amelia',
    feedbackGiven: false,
  },
];

const BUTTON =
  '<button type="button" class="btn" title="Download a calendar file for this event">Add to calendar</button>';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CalendarButton', () => {
  it('sits in the header actions, after the download', () => {
    const markup = renderToStaticMarkup(
      <EventScreen
        event={gala()}
        sections={sections}
        lineup={lineup}
        photos={{}}
        now="2026-09-18T12:00:00Z"
      />,
    );
    const actions = markup.slice(markup.indexOf('class="actions row"'));
    expect(actions.indexOf('Download Allocation Sheet')).toBeGreaterThan(-1);
    expect(actions.indexOf(BUTTON)).toBeGreaterThan(actions.indexOf('Download Allocation Sheet'));
  });

  it('is offered for upcoming, ongoing and completed events', () => {
    for (const status of ['upcoming', 'ongoing', 'completed'] as const) {
      expect(renderToStaticMarkup(<CalendarButton event={gala({ status })} />)).toBe(BUTTON);
    }
  });

  it('is not offered for a cancelled event', () => {
    expect(renderToStaticMarkup(<CalendarButton event={gala({ status: 'cancelled' })} />)).toBe('');
    const markup = renderToStaticMarkup(
      <EventScreen
        event={gala({ status: 'cancelled' })}
        sections={sections}
        lineup={lineup}
        photos={{}}
        now="2026-09-18T12:00:00Z"
      />,
    );
    expect(markup).not.toContain('Add to calendar');
  });

  it('downloads "{title}.ics" as a text/calendar Blob built on the page origin', async () => {
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const appendChild = vi.fn();
    vi.stubGlobal('window', { location: { origin: 'https://portal.test' } });
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } });
    let blob: Blob | undefined;
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blob = b as Blob;
      return 'blob:calendar';
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.useFakeTimers();

    const element = CalendarButton({ event: gala() }) as ReactElement<{ onClick: () => void }>;
    element.props.onClick();

    expect(create).toHaveBeenCalledOnce();
    expect(anchor.href).toBe('blob:calendar');
    expect(anchor.download).toBe('Gala Dinner.ics');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:calendar');
    vi.useRealTimers();

    expect(blob?.type).toBe('text/calendar;charset=utf-8');
    const text = (await blob!.text()).replace(/\r\n /g, '');
    expect(text).toContain(`UID:${EVENT_ID}@thehospitalitycompany.co.uk\r\n`);
    expect(text).toContain(`Line-up: https://portal.test/client/events/${EVENT_ID}\r\n`);
    expect(text).not.toContain('Amelia');
  });
});
