import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Client } from '../types';

vi.mock('../actions', () => ({
  createClientRecord: vi.fn(),
  updateClientRecord: vi.fn(),
}));

const { ClientModal } = await import('../ClientModal');

const CLIENT = {
  id: 'client-1',
  name: 'Leonardo Royal St Paul’s',
  contact_name: 'James H.',
  phone: '+44 20 7629 8888',
  staff_contact_point: 'Banqueting manager',
  contact_emails: ['events@leonardo-stpauls.example'],
  pays_breaks: false,
  pays_buffer: true,
  rate_card_roles: [],
  rate_card_count: 0,
  event_count: 0,
} as unknown as Client;

/**
 * §9.7: the New client modal lists "Contact emails (several, 2–3 people)";
 * the card's Edit opens "allocation email(s)" — the addresses the allocation
 * sheet and timesheet go to (§11.4). Same column, two names, as the two
 * wireframes draw them (clients.html, client-card.html).
 */
describe('the client modal names the emails as §9.7 does', () => {
  it('New client: "Contact emails · 2–3 people"', () => {
    const markup = renderToStaticMarkup(
      <ClientModal client={null} onClose={() => undefined} onSaved={() => undefined} />,
    );
    expect(markup).toContain('Contact emails');
    expect(markup).toContain('2–3 people');
    expect(markup).not.toContain('Allocation email(s)');
  });

  it('Edit client: "Allocation email(s)"', () => {
    const markup = renderToStaticMarkup(
      <ClientModal client={CLIENT} onClose={() => undefined} onSaved={() => undefined} />,
    );
    expect(markup).toContain('Allocation email(s)');
    expect(markup).not.toContain('Contact emails');
    expect(markup).toContain('Edit client');
  });
});
