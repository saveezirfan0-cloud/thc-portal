import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Client } from '../types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => '/clients',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../actions', () => ({ createClientRecord: vi.fn(), updateClientRecord: vi.fn() }));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { ClientsScreen } = await import('../ClientsScreen');

const CLIENT: Client = {
  id: 'c1',
  name: 'Mandarin Oriental Hotel Hyde Park, London',
  contact_name: 'Alvaro J.',
  phone: '0207 235 2000',
  staff_contact_point: 'Alvaro J.',
  contact_emails: ['events@mandarin.example'],
  pays_breaks: true,
  pays_buffer: false,
  rate_card_roles: ['Waiting Staff'],
  rate_card_count: 1,
  event_count: 3,
  avg_margin_pct: null,
  created_at: '2026-10-05T10:00:00Z',
  created_by: null,
  created_by_name: null,
  one_off: false,
};

describe('a client row opens the card (clients.html tr.clickable)', () => {
  it('marks every row clickable and keeps the name as a link to the card', () => {
    const html = renderToStaticMarkup(<ClientsScreen problem={null} clients={[CLIENT]} />);
    expect(html).toMatch(/<tr class="clickable">/);
    expect(html).toContain('href="/clients/c1"');
  });
});
