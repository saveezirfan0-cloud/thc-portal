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
  assignee_id: null,
  assignee_name: null,
  resolution: null,
  created_at: '2026-10-22T19:24:00Z',
  updated_at: '2026-10-22T19:24:00Z',
  resolved_at: null,
};

const LIST: TicketsPageData = {
  tickets: [TICKET],
  scopes: {},
  tracker: false,
  total: 1,
  open: 1,
  closed: 3,
  problem: null,
};

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

  it('shows the scope label and its filter to the login that tracks, and to nobody else', () => {
    const tracked = renderToStaticMarkup(
      <TicketsScreen
        data={{ ...LIST, tracker: true, scopes: { [TICKET.id]: 'against_scope' } }}
        query={parseQuery({})}
      />,
    );
    expect(tracked).toContain('Against scope');
    expect(tracked).toContain('Any scope label');
    expect(tracked).toContain('Monthly time report');
    const other = renderToStaticMarkup(
      <TicketsScreen data={LIST} query={parseQuery({ scope: 'addition' })} />,
    );
    expect(other).not.toContain('Any scope label');
    expect(other).not.toContain('Monthly time report');
    expect(other).not.toContain('Against scope');
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
        activity: 'note',
        body: 'Status: New → In progress',
        author_id: 'u2',
        author_name: 'Gisela M',
        created_at: '2026-10-22T20:00:00Z',
      },
    ],
    assignees: [{ id: 'u2', full_name: 'Gisela M.' }],
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

  it('lays the ticket out as triage, report, context and updates', () => {
    const html = renderToStaticMarkup(<TicketScreen data={data} canWrite />);
    for (const heading of ['Triage', 'Report', 'Context', 'Updates']) {
      expect(html, heading).toContain(`>${heading}</h3>`);
    }
    expect(html).toContain('Page it happened on');
    expect(html).toContain('/events');
    for (const type of ['Note', 'Email', 'Call', 'Meeting', 'Task']) {
      expect(html, type).toContain(`>${type}</button>`);
    }
    // Owner picker, from the office logins.
    expect(html).toContain('Gisela M.');
    expect(html).toContain('— Unassigned —');
  });

  it('draws nothing of the owner’s scope label and time for anyone else', () => {
    const html = renderToStaticMarkup(<TicketScreen data={data} canWrite />);
    expect(html).not.toContain('Scope and time');
    expect(html).not.toContain('Against the original scope');
    expect(html).not.toContain('Start timer');
    expect(html).not.toContain('Billable');
  });

  it('draws the scope label and the time for the login that tracks', () => {
    const html = renderToStaticMarkup(
      <TicketScreen
        data={data}
        canWrite
        tracking={{
          allowed: true,
          scope: { ticket_id: TICKET.id, label: 'addition', note: null },
          entries: [
            {
              id: 1,
              ticket_id: TICKET.id,
              worked_by: 'claude',
              worked_on: '2026-10-23',
              started_at: null,
              ended_at: null,
              minutes: 75,
              billable: true,
              note: 'after the email',
              logged_by: 'u2',
            },
          ],
          running: null,
          problem: null,
        }}
      />,
    );
    expect(html).toContain('Scope and time');
    expect(html).toContain('Internal — only you can see this');
    expect(html).toContain('Addition');
    expect(html).toContain('Start timer');
    expect(html).toContain('1h 15m');
    expect(html).toContain('Claude');
    expect(html).toContain('after the email');
  });

  it('offers Delete this report to an owner only', () => {
    expect(renderToStaticMarkup(<TicketScreen data={data} canWrite isOwner />)).toContain(
      'Delete this report',
    );
    expect(renderToStaticMarkup(<TicketScreen data={data} canWrite />)).not.toContain(
      'Delete this report',
    );
  });

  it('disables status and severity for a login that cannot write', () => {
    const html = renderToStaticMarkup(<TicketScreen data={data} canWrite={false} />);
    expect(html).toMatch(/<select id="tk-status"[^>]*disabled/);
    expect(html).toMatch(/<select id="tk-severity"[^>]*disabled/);
    // Commenting stays open to every login.
    expect(html).toMatch(/<select id="tk-kind"[^>]*disabled/);
    expect(html).toMatch(/<select id="tk-owner"[^>]*disabled/);
    expect(html).not.toContain('Save changes');
  });

  it('says so when the ticket cannot be found', () => {
    const html = renderToStaticMarkup(
      <TicketScreen data={{ ticket: null, comments: [], assignees: [], problem: null }} canWrite />,
    );
    expect(html).toContain('That ticket was not found.');
  });
});
