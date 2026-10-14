import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerRequestRow } from '../types';

// Outside Next there is no server; the action is not under test.
vi.mock('../actions', () => ({ markRequestHandled: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { WorkerRequests } = await import('../WorkerRequests');

const row = (over: Partial<WorkerRequestRow> = {}): WorkerRequestRow => ({
  id: 'r1',
  client_id: 'c1',
  staff_id: 's1',
  worker_name: 'Aisha Bello',
  employee_id: 10231,
  worker_removed: false,
  event_id: 'e1',
  event_title: 'Gala Dinner',
  event_date: '2026-09-19',
  role: 'Waiting Staff',
  note: 'Brilliant with the VIP table',
  requested_by_name: 'Marco Vitale',
  created_at: '2026-09-20T08:15:00Z',
  handled_at: null,
  ...over,
});

/** ADR-0135 §2: the Client Portal's "Request again" messages on the client card. */
describe('Requests from the Client Portal (ADR-0135 §2)', () => {
  it('lists an open request with who, where, the note and who asked, and Mark handled', () => {
    const html = renderToStaticMarkup(<WorkerRequests clientId="c1" rows={[row()]} canWrite />);
    expect(html).toContain('href="/staff/s1"');
    expect(html).toContain('Aisha Bello');
    expect(html).toContain('href="/events/e1"');
    expect(html).toContain('Waiting Staff · 19.09.2026');
    expect(html).toContain('Brilliant with the VIP table');
    expect(html).toContain('by Marco Vitale');
    expect(html).toContain('20.09.2026 09:15 UK time');
    expect(html).toContain('Mark handled');
    expect(html).toContain('1 open');
    expect(html).toContain('not a booking');
  });

  it('shows a handled request as handled, with no button', () => {
    const html = renderToStaticMarkup(
      <WorkerRequests
        clientId="c1"
        rows={[row({ handled_at: '2026-09-21T10:00:00Z' })]}
        canWrite
      />,
    );
    expect(html).toContain('Handled 21.09.2026');
    expect(html).not.toContain('Mark handled');
    expect(html).toContain('0 open');
  });

  it('gives a viewer no button (ADR-0060)', () => {
    const html = renderToStaticMarkup(
      <WorkerRequests clientId="c1" rows={[row()]} canWrite={false} />,
    );
    expect(html).not.toContain('Mark handled');
    expect(html).toContain('Open');
  });

  it('does not link a removed worker', () => {
    const html = renderToStaticMarkup(
      <WorkerRequests
        clientId="c1"
        rows={[row({ worker_name: 'Deleted account #1042', worker_removed: true })]}
        canWrite
      />,
    );
    expect(html).not.toContain('href="/staff/s1"');
    expect(html).toContain('Deleted account #1042');
  });

  it('says so when there are none', () => {
    const html = renderToStaticMarkup(<WorkerRequests clientId="c1" rows={[]} canWrite />);
    expect(html).toContain('No requests yet');
  });
});
