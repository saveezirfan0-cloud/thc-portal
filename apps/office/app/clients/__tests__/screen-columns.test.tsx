import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Client } from '../types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
  usePathname: () => '/clients',
}));
vi.mock('../actions', () => ({ createClientRecord: vi.fn(), updateClientRecord: vi.fn() }));
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
  event_count: 2,
  avg_margin_pct: 34.9,
  created_at: '2026-09-18T10:00:00Z',
  created_by: 'u1',
  created_by_name: 'Gisela M.',
  ...over,
});

const render = (ratesVisible: boolean) =>
  renderToStaticMarkup(
    <ClientsScreen
      ratesVisible={ratesVisible}
      problem={null}
      clients={[
        client({}),
        client({
          id: 'c2',
          name: 'Riverside Rooms',
          rate_card_roles: [],
          created_by: null,
          created_by_name: null,
        }),
      ]}
    />,
  );

describe('/clients directory — Date added and Added by (§9.7)', () => {
  it('has the two new columns after Avg margin', () => {
    expect(render(true)).toMatch(/Avg margin<\/th><th>Date added<\/th><th>Added by<\/th>/);
  });

  it('keeps them, and still hides the margin, for a scheduler without finance', () => {
    const markup = render(false);
    expect(markup).not.toContain('Avg margin');
    expect(markup).toMatch(/Events<\/th><th>Date added<\/th><th>Added by<\/th>/);
  });

  it('prints the UK date, the manager, and an em dash where nobody was recorded', () => {
    const markup = render(true);
    expect(markup).toContain('18 Sep 2026');
    expect(markup).toContain('>Gisela M.<');
    expect(markup).toMatch(/data-label="Added by"[^>]*><span class="muted">—<\/span>/);
  });

  it('offers the filters, including "No rate card yet" when a client has none', () => {
    const markup = render(true);
    for (const label of [
      'Filter by break policy',
      'Filter by buffer policy',
      'Filter by rate card role',
      'Filter by who added',
      'Added from (UK date)',
      'Added to (UK date)',
    ]) {
      expect(markup).toContain(`aria-label="${label}"`);
    }
    expect(markup).toContain('>No rate card yet<');
    expect(markup).not.toContain('Clear filters');
  });
});
