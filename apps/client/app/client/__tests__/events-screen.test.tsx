import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PortalEvent, RoleSection } from '../rules';

/**
 * The event list names the customer (§11.1, `wireframes/client/events.html`:
 * "Events · Leonardo Hotel St Pauls" over the panel, and "Confirmed line-ups
 * and timesheets for Leonardo Hotel St Pauls" under the heading). The name
 * comes from `client_company_v`; when it cannot be read the list still
 * renders, titled plain "Events".
 */
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { EventsScreen } = await import('../EventsScreen');

const event: PortalEvent = {
  id: 'ev-1',
  title: 'Gala Dinner',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St, EC4V 5AJ',
  eventDate: '2026-10-02',
  poNumber: '4471-A',
  onsiteContact: null,
  startsAt: '2026-10-02T06:00:00Z',
  endsAt: '2026-10-02T22:30:00Z',
  status: 'upcoming',
};

const section: RoleSection = {
  shiftId: 's-1',
  eventId: 'ev-1',
  role: 'Chef',
  startsAt: '2026-10-02T06:00:00Z',
  endsAt: '2026-10-02T14:00:00Z',
  headcount: 2,
  confirmed: 1,
};

function render(company: string | null) {
  return renderToStaticMarkup(
    <EventsScreen
      events={[event]}
      sections={[section]}
      lineup={[]}
      photos={{}}
      company={company}
      now="2026-09-25T10:00:00Z"
    />,
  );
}

describe('the event list names the customer (§11.1)', () => {
  it('titles the panel "Events · <client>" and says whose line-ups these are', () => {
    const html = render('Leonardo Hotel St Pauls');
    expect(html).toContain('Events · Leonardo Hotel St Pauls');
    expect(html).toContain('Confirmed line-ups and timesheets for Leonardo Hotel St Pauls');
  });

  it('falls back to "Events" when the company is unknown', () => {
    const html = render(null);
    expect(html).toContain('>Events');
    expect(html).not.toContain('Events ·');
    expect(html).toContain('Confirmed line-ups and timesheets · read-only');
  });
});
