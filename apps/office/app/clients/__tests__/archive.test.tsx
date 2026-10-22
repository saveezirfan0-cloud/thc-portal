import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Client } from '../types';

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => '/clients',
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('../actions', () => ({
  createClientRecord: vi.fn(),
  updateClientRecord: vi.fn(),
  archiveClientRecord: vi.fn(),
  restoreClientRecord: vi.fn(),
}));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ children, crumbs }: { children: React.ReactNode; crumbs?: React.ReactNode }) => (
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

const render = (query: string) => {
  search = query;
  return renderToStaticMarkup(
    <ClientsScreen
      problem={null}
      clients={[
        client({}),
        client({ id: 'c2', name: 'Old Hotel', archived_at: '2026-10-01T09:00:00Z' }),
      ]}
    />,
  );
};

describe('/clients — archived clients (ADR-0195)', () => {
  it('hides an archived client by default and counts only the live ones', () => {
    const html = render('');
    expect(html).toContain('The Dorchester');
    expect(html).not.toContain('Old Hotel');
    expect(html).toContain('(+1 archived)');
  });

  it('shows archived clients on request, marked Archived', () => {
    const html = render('status=archived');
    expect(html).not.toContain('The Dorchester');
    expect(html).toContain('Old Hotel');
    expect(html).toContain('Archived');
  });

  it('shows everyone under status=all', () => {
    const html = render('status=all');
    expect(html).toContain('The Dorchester');
    expect(html).toContain('Old Hotel');
  });
});

describe('the client card control (ADR-0195)', () => {
  it('offers Archive on a live client and Restore on an archived one', () => {
    const live = renderToStaticMarkup(
      <ArchiveClient clientId="c1" name="X" archivedAt={null} canWrite />,
    );
    expect(live).toContain('Archive');
    expect(live).not.toContain('Restore');
    const archived = renderToStaticMarkup(
      <ArchiveClient clientId="c1" name="X" archivedAt="2026-10-01T09:00:00Z" canWrite />,
    );
    expect(archived).toContain('Restore');
  });

  it('draws nothing for a viewer', () => {
    expect(
      renderToStaticMarkup(
        <ArchiveClient clientId="c1" name="X" archivedAt={null} canWrite={false} />,
      ),
    ).toBe('');
  });
});
