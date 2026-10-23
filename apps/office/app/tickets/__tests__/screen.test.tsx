import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TicketPageData, TicketsPageData } from '../data';
import type { Ticket } from '../types';
import { parseQuery } from '../view-model';

// Outside Next there is no router and no server; neither is under test.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../actions', () => ({
  createTicket: vi.fn(),
  addComment: vi.fn(),
  updateTicket: vi.fn(),
}));

const { TicketsScreen } = await import('../TicketsScreen');
const { TicketScreen } = await import('../TicketScreen');

const TICKET: Ticket = {
  id: '11111111-2222-4333-8444-555555555555',
  ticket_no: 12,
  kind: 'bug',
  severity: 'high',
  status: 'in_progress',
  title: 'Card vanishes after a drag',
  details: 'Dragged an event and it disappeared.',
  page_path: '/events',
  link_url: 'https://www.loom.com/share/abc',
  reporter_id: 'u1',
  reporter_name: 'Katie Gadsby',
  created_at: '2026-10-22T19:24:00Z',
  updated_at: '2026-10-22T19:24:00Z',
  resolved_at: null,
};

const LIST: TicketsPageData = { tickets: [TICKET], total: 1, open: 1, closed: 3, problem: null };

describe('<TicketsScreen> — /tickets', () => {
  it('lists a ticket by its TK- number with its type, status and reporter', () => {
    const html = renderToStaticMarkup(<TicketsScreen data={LIST} query={parseQuery({})} />);
    expect(html).toContain('TK-12');
    expect(html).toContain('Card vanishes after a drag');
    expect(html).toContain('In progress');
    expect(html).toContain('Katie Gadsby');
    expect(html).toContain('href="/tickets/11111111-2222-4333-8444-555555555555"');
    expect(html).toContain('1 open');
  });

  it('counts the tabs and says so when nothing is open', () => {
    const html = renderToStaticMarkup(
      <TicketsScreen data={{ ...LIST, tickets: [], total: 0, open: 0 }} query={parseQuery({})} />,
    );
    expect(html).toContain('No open tickets');
    expect(html).toContain('Closed');
  });

  it('says a filter matched nothing, and offers Clear', () => {
    const html = renderToStaticMarkup(
      <TicketsScreen
        data={{ ...LIST, tickets: [], total: 0 }}
        query={parseQuery({ q: 'nope', kind: 'idea' })}
      />,
    );
    expect(html).toContain('No tickets match those filters.');
    expect(html).toContain('Clear');
  });

  it('shows a load failure as an alert, never as an empty list', () => {
    const html = renderToStaticMarkup(
      <TicketsScreen
        data={{ ...LIST, tickets: [], total: 0, problem: 'It broke.' }}
        query={parseQuery({})}
      />,
    );
    expect(html).toContain('It broke.');
    expect(html).not.toContain('No open tickets');
  });
});

describe('<TicketScreen> — /tickets/:id', () => {
  const data: TicketPageData = {
    ticket: TICKET,
    comments: [
      {
        id: 1,
        ticket_id: TICKET.id,
        kind: 'change',
        body: 'Status: New → In progress',
        author_id: 'u2',
        author_name: 'Gisela M',
        created_at: '2026-10-22T20:00:00Z',
      },
    ],
    problem: null,
  };

  it('shows the report, the thread and the follow-up controls', () => {
    const html = renderToStaticMarkup(<TicketScreen data={data} canWrite />);
    expect(html).toContain('Dragged an event and it disappeared.');
    expect(html).toContain('Status: New → In progress');
    expect(html).toContain('Gisela M');
    expect(html).toContain('Add an update');
    expect(html).toContain('href="https://www.loom.com/share/abc"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('disables status and severity for a login that cannot write', () => {
    const html = renderToStaticMarkup(<TicketScreen data={data} canWrite={false} />);
    expect(html).toMatch(/<select id="tk-status"[^>]*disabled/);
    expect(html).toMatch(/<select id="tk-severity"[^>]*disabled/);
    // Commenting stays open to every login.
    expect(html).toMatch(/<textarea id="tk-note"(?![^>]*disabled)/);
  });

  it('says so when the ticket cannot be found', () => {
    const html = renderToStaticMarkup(
      <TicketScreen data={{ ticket: null, comments: [], problem: null }} canWrite />,
    );
    expect(html).toContain('That ticket was not found.');
  });
});
