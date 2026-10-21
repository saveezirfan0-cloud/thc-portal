import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Client } from '../types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => '/clients',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../actions', () => ({
  createClientRecord: vi.fn(),
  updateClientRecord: vi.fn(),
  setClientsOneOff: vi.fn(),
}));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { ClientsScreen } = await import('../ClientsScreen');

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
  event_count: 12,
  avg_margin_pct: 34.9,
  created_at: '2026-09-18T10:00:00Z',
  created_by: 'u1',
  created_by_name: 'Gisela M.',
  one_off: false,
  ...over,
});

const clients = [
  client({}),
  client({ id: 'c2', name: 'Smith Birthday Party', event_count: 1, one_off: true }),
  client({ id: 'c3', name: 'Jones Wedding', event_count: 1, one_off: true }),
];

const render = (canWrite: boolean) =>
  renderToStaticMarkup(<ClientsScreen problem={null} clients={clients} canWrite={canWrite} />);

/** ADR-0186: the directory leads with regular clients. */
describe('/clients directory — one-off clients (ADR-0186)', () => {
  it('lists regular clients first and files the one-off ones under their own view', () => {
    const markup = render(true);
    expect(markup).toContain('The Dorchester');
    expect(markup).not.toContain('Smith Birthday Party');
    expect(markup).not.toContain('Jones Wedding');
    expect(markup).toContain('>Regular clients (1)<');
    expect(markup).toContain('>One-off clients (2)<');
    expect(markup).toContain('>All clients (3)<');
  });

  it('does not call the default view a filter', () => {
    expect(render(true)).not.toContain('Clear filters');
  });

  it('offers the "ordered once or never" filter', () => {
    const markup = render(true);
    expect(markup).toContain('aria-label="Filter by how often the client has ordered"');
    expect(markup).toContain('>Ordered once or never<');
  });

  it('draws the bulk button for an office role that may write, and not for a viewer', () => {
    expect(render(true)).toContain('Mark the 1 shown as one-off');
    expect(render(false)).not.toContain('as one-off');
  });
});
