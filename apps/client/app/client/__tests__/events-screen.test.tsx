import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PortalEvent, RoleSection } from '../rules';

/**
 * The event list (§11.1, `wireframes/client/events.html`).
 *
 * The Document column used to be a hard-coded disabled button whose
 * tooltip promised the documents "with §11.3" (audit 25.09 D11). It is a
 * live link to `/client/events/:id/document?kind=…` whenever
 * `client_event_documents_v` returned that kind, and an honest disabled
 * "Not issued yet" otherwise. The panel names the customer's company.
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

const event = (over: Partial<PortalEvent>): PortalEvent => ({
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
  ...over,
});

const section = (eventId: string): RoleSection => ({
  shiftId: `s-${eventId}`,
  eventId,
  role: 'Chef',
  startsAt: '2026-10-02T06:00:00Z',
  endsAt: '2026-10-02T14:00:00Z',
  headcount: 2,
  confirmed: 1,
});

const NOW = '2026-09-25T10:00:00Z';

function render(props: Partial<Parameters<typeof EventsScreen>[0]> = {}) {
  return renderToStaticMarkup(
    <EventsScreen
      events={[
        event({ id: 'issued', title: 'Gala Dinner' }),
        event({ id: 'pending', title: 'Wedding Breakfast' }),
      ]}
      sections={[section('issued'), section('pending')]}
      lineup={[]}
      photos={{}}
      now={NOW}
      documents={{ issued: ['allocation'] }}
      company="Leonardo Hotel St Pauls"
      {...props}
    />,
  );
}

describe('the event list download (§11.1)', () => {
  it('links to the issued allocation sheet', () => {
    const html = render();
    expect(html).toContain('href="/client/events/issued/document?kind=allocation"');
  });

  it('shows a disabled button saying "Not issued yet" when nothing is issued', () => {
    const html = render();
    expect(html).not.toContain('/client/events/pending/document');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Not issued yet"/);
  });

  it('says the documents could not be loaded rather than "not issued" when the view failed', () => {
    const html = render({ documents: {}, documentsLoaded: false });
    expect(html).toContain('Documents cannot be loaded right now');
    expect(html).not.toContain('Not issued yet');
  });

  it('shows no section number or rule id anywhere on the list', () => {
    expect(render()).not.toMatch(/§|RULE-/);
  });
});

describe('the list panel title (§11.1)', () => {
  it('names the customer: "Events · <client name>"', () => {
    expect(render()).toContain('Events · Leonardo Hotel St Pauls');
  });

  it('falls back to "Events" when the company is unknown', () => {
    const html = render({ company: null });
    expect(html).toContain('<h3>Events <span');
    expect(html).not.toContain('Events ·');
  });
});
