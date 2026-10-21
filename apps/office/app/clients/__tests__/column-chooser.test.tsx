// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ColumnPrefsProvider } from '@thc/ui';
import type { Client } from '../types';

/**
 * /clients with the column chooser (ADR-0139). Avg margin is money: a
 * login without finance is never offered it (ADR-0061); a stored choice is
 * on the first paint.
 */

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
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const heads = () => Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent);

function mount(ratesVisible: boolean) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(<ClientsScreen clients={[CLIENT]} problem={null} ratesVisible={ratesVisible} />),
  );
  act(() => document.querySelector<HTMLButtonElement>('.colchooser-btn')!.click());
  return document.querySelector<HTMLElement>('[role="dialog"]')!;
}

describe('/clients column chooser', () => {
  it('offers Avg margin only to a login with finance (ADR-0061)', () => {
    expect(mount(true).textContent).toContain('Avg margin');
    act(() => root!.unmount());
    root = null;
    const dialog = mount(false);
    expect(dialog.textContent).not.toContain('Avg margin');
    expect(dialog.textContent).toContain('Phone');
    expect(heads()).not.toContain('Avg margin');
  });

  it('holds Client first and hides a column on a tick', () => {
    const dialog = mount(true);
    const tick = (name: string) =>
      Array.from(dialog.querySelectorAll<HTMLInputElement>('input')).find((input) =>
        input.closest('label')!.textContent!.startsWith(name),
      )!;
    expect(tick('Client').disabled).toBe(true);
    act(() => tick('Phone').click());
    expect(heads()).not.toContain('Phone');
    expect(heads()[0]).toBe('Client');
  });

  it('paints a stored choice on the first, server-rendered paint', () => {
    const html = renderToStaticMarkup(
      <ColumnPrefsProvider
        prefs={{
          clients: {
            order: ['events', 'contact', 'phone', 'roles', 'policies', 'margin', 'added', 'by'],
            hidden: ['phone', 'policies'],
          },
        }}
        save={async () => ({ ok: true })}
      >
        <ClientsScreen clients={[CLIENT]} problem={null} ratesVisible />
      </ColumnPrefsProvider>,
    );
    const order = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((match) => match[1]);
    expect(order).toEqual([
      'Client',
      'Events',
      'Contact',
      'Rate card roles',
      'Avg margin',
      'Date added',
      'Added by',
    ]);
  });
});
