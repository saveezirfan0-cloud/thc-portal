import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Client } from '../types';

// The list reads its state from the URL; each test sets the query string.
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
  usePathname: () => '/clients',
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('../actions', () => ({ createClientRecord: vi.fn(), updateClientRecord: vi.fn() }));
vi.mock('../[id]/actions', () => ({ archiveClient: vi.fn(), restoreClient: vi.fn() }));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ crumbs, children }: { crumbs: React.ReactNode; children: React.ReactNode }) => (
    <div>
      <div data-crumbs>{crumbs}</div>
      {children}
    </div>
  ),
}));

const { ClientsScreen } = await import('../ClientsScreen');
const { ArchiveClient } = await import('../[id]/ArchiveClient');

const client = (over: Partial<Client>): Client => ({
  id: 'c1',
  name: 'The Dorchester',
  contact_name: 'James H.',
  phone: '+44 20 7629 8888',
  staff_contact_point: 'Events Office',
  contact_emails: ['events@dorchester.example'],
  pays_breaks: false,
  pays_buffer: true,
  rate_card_roles: ['Bar Staff'],
  rate_card_count: 1,
  event_count: 2,
  avg_margin_pct: 34.9,
  created_at: '2026-09-18T10:00:00Z',
  created_by: 'u1',
  created_by_name: 'Gisela M.',
  archived_at: null,
  ...over,
});

const CLIENTS = [
  client({}),
  client({ id: 'c2', name: 'Old Wharf Events', archived_at: '2026-10-01T09:00:00Z' }),
];

const render = (query: string, clients: Client[] = CLIENTS) => {
  search = query;
  return renderToStaticMarkup(<ClientsScreen problem={null} clients={clients} />);
};

describe('/clients — archived clients (ADR-0185)', () => {
  it('hides archived clients by default and counts only the active ones', () => {
    const markup = render('');
    expect(markup).toContain('The Dorchester');
    expect(markup).not.toContain('Old Wharf Events');
    expect(markup).toMatch(/<b>1 client<\/b>/);
    expect(markup).toContain('1 archived');
  });

  it('shows only archived clients, marked, when asked', () => {
    const markup = render('status=archived');
    expect(markup).toContain('Old Wharf Events');
    expect(markup).not.toContain('The Dorchester');
    expect(markup).toContain('Archived</span>');
  });

  it('shows everyone under "all"', () => {
    const markup = render('status=all');
    expect(markup).toContain('The Dorchester');
    expect(markup).toContain('Old Wharf Events');
  });

  it('says so when every client is archived, rather than "No clients yet"', () => {
    const markup = render('', [CLIENTS[1]!]);
    expect(markup).toContain('Every client is archived');
    expect(markup).not.toContain('No clients yet');
  });

  it('treats a stray status value as "active"', () => {
    const markup = render('status=nonsense');
    expect(markup).not.toContain('Old Wharf Events');
  });
});

describe("the client card's Archive control (ADR-0185)", () => {
  const props = { clientId: 'c1', name: 'The Dorchester', canWrite: true };

  it('offers Archive for a client with nothing still to come', () => {
    const markup = renderToStaticMarkup(
      <ArchiveClient {...props} archivedAt={null} upcoming={0} />,
    );
    expect(markup).toContain('Archive client');
  });

  it('explains instead of offering it while an event is still to come', () => {
    const markup = renderToStaticMarkup(
      <ArchiveClient {...props} archivedAt={null} upcoming={2} />,
    );
    expect(markup).not.toContain('Archive client');
    expect(markup).toContain('2 events today or');
  });

  it('shows the archived state with Restore, and the date in UK terms', () => {
    const markup = renderToStaticMarkup(
      <ArchiveClient {...props} archivedAt="2026-10-01T09:00:00Z" upcoming={0} />,
    );
    expect(markup).toContain('Archived on 1 Oct 2026');
    expect(markup).toContain('Restore client');
  });

  it('is text, not a control, for a viewer (ADR-0060)', () => {
    const live = renderToStaticMarkup(
      <ArchiveClient {...props} canWrite={false} archivedAt={null} upcoming={0} />,
    );
    expect(live).toBe('');
    const archived = renderToStaticMarkup(
      <ArchiveClient {...props} canWrite={false} archivedAt="2026-10-01T09:00:00Z" upcoming={0} />,
    );
    expect(archived).toContain('Archived on');
    expect(archived).not.toContain('Restore client');
  });
});
