import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeRequestView } from '../types';

// Outside Next there is no router, no server and no layout context.
vi.mock('next/navigation', () => ({
  usePathname: () => '/staff/requests',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../actions', () => ({ decideChangeRequest: vi.fn(), changeEvidenceLink: vi.fn() }));

const { RequestsScreen, PendingCard, DecidedTable } = await import('../RequestsScreen');

/** ADR-0038 · wireframes/backoffice/change-requests.html. */
const row = (over: Partial<ChangeRequestView> = {}): ChangeRequestView => ({
  id: 'r1',
  staff_id: 's1',
  kind: 'name',
  status: 'pending',
  display_name: 'Amara Kalu',
  employee_id: 873,
  removed: false,
  staff_status: 'compliant',
  rtw_branch: 'uk_irish',
  right_to_work_until: null,
  current_first_name: 'Amara',
  current_last_name: 'Kalu',
  current_photo_path: null,
  proposed_first_name: 'Amara',
  proposed_last_name: 'Okafor',
  proposed_photo_path: null,
  evidence_path: 's1/change-requests/marriage-certificate.jpg',
  worker_note: 'Married in August.',
  previous_value: null,
  created_at: '2026-09-18T13:37:00Z',
  decided_at: null,
  decided_by_name: null,
  decision_reason: null,
  current_photo_url: null,
  proposed_photo_url: null,
  ...over,
});

describe('/staff/requests — Pending', () => {
  it('shows a name request now → requested, with its evidence, note and both buttons', () => {
    const html = renderToStaticMarkup(<PendingCard row={row()} onDecide={() => undefined} />);
    expect(html).toContain('Amara Kalu');
    expect(html).toContain('Amara Okafor');
    expect(html).toContain('marriage-certificate.jpg ↗');
    expect(html).toContain('Married in August.');
    expect(html).toContain('THC-00873');
    expect(html).toContain('Requested Fri 18 Sep · 14:37 UK time');
    expect(html).toContain('>Reject<');
    expect(html).toContain('>Approve<');
  });

  it('shows a photo request as the two signed photos side by side', () => {
    const html = renderToStaticMarkup(
      <PendingCard
        row={row({
          kind: 'photo',
          proposed_first_name: null,
          proposed_last_name: null,
          evidence_path: null,
          current_photo_url: 'https://signed/old',
          proposed_photo_url: 'https://signed/new',
          worker_note: 'New haircut',
        })}
        onDecide={() => undefined}
      />,
    );
    expect(html).toContain('src="https://signed/old"');
    expect(html).toContain('src="https://signed/new"');
    expect(html).toContain('Note from Amara');
    expect(html).toContain('issued PDFs keep the old photo');
  });

  it('lists the queue oldest first', () => {
    const html = renderToStaticMarkup(
      <RequestsScreen
        pending={[
          row({ id: 'later', display_name: 'Later Person', created_at: '2026-09-18T13:37:00Z' }),
          row({ id: 'first', display_name: 'First Person', created_at: '2026-09-17T08:12:00Z' }),
        ]}
        decided={[]}
        problem={null}
      />,
    );
    expect(html.indexOf('First Person')).toBeLessThan(html.indexOf('Later Person'));
  });

  it('has an empty state', () => {
    const html = renderToStaticMarkup(<RequestsScreen pending={[]} decided={[]} problem={null} />);
    expect(html).toContain('No change requests waiting');
  });
});

describe('/staff/requests — Decided', () => {
  it('shows each decision, its reason and who made it', () => {
    const html = renderToStaticMarkup(
      <DecidedTable
        rows={[
          row({
            id: 'a',
            status: 'approved',
            current_last_name: 'Okafor',
            previous_value: { firstName: 'Amara', lastName: 'Kalu' },
            decided_at: '2026-09-18T15:02:00Z',
            decided_by_name: 'Gisela M.',
          }),
          row({
            id: 'b',
            kind: 'photo',
            status: 'rejected',
            decided_at: '2026-09-18T09:12:00Z',
            decided_by_name: 'Gisela M.',
            decision_reason: 'Your face is partly covered.',
          }),
          row({ id: 'c', status: 'withdrawn', decided_at: '2026-09-02T11:05:00Z' }),
          row({
            id: 'd',
            status: 'withdrawn',
            removed: true,
            display_name: 'Deleted account #1042',
            decided_at: '2026-08-20T08:00:00Z',
          }),
        ]}
      />,
    );
    expect(html).toContain('Amara Kalu → Amara Okafor');
    expect(html).toContain('Approved');
    expect(html).toContain('Your face is partly covered.');
    expect(html).toContain('Gisela M.');
    expect(html).toContain('— the worker');
    expect(html).toContain('GDPR removal');
    expect(html).toContain('— anonymised');
    expect(html).toContain('18.09.2026 16:02');
  });
});
