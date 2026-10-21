import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceEvent, InvoiceEventDetail, InvoiceLine, InvoiceViolation } from '../data';

/**
 * /reports/invoicing/:eventId (ADR-0172): what each status shows, and who
 * may mark an event reviewed. The figures and the status come from the
 * database (pgTAP 902); this pins the page's reading of them.
 */

const state = vi.hoisted(() => ({
  role: 'manager' as string | null,
  detail: null as unknown as InvoiceEventDetail,
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({
    title,
    crumbs,
    children,
  }: {
    title: ReactNode;
    crumbs?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{crumbs}</p>
      {children}
    </div>
  ),
}));
vi.mock('../../_components/NotAvailable', () => ({
  NotAvailable: ({ needs }: { needs: string }) => <p>not-available:{needs}</p>,
}));
vi.mock('../../_components/officeUser', () => ({ currentOfficeRole: async () => state.role }));
vi.mock('../../_lib/timeFormat', () => ({ currentTimeFormat: async () => '24h' }));
vi.mock('../_components/zone', () => ({
  ViewerZone: () => null,
  ScheduledWindow: ({ startsAt }: { startsAt: string }) => <span>window:{startsAt}</span>,
  ActualTime: ({ at }: { at: string | null }) => <span>at:{at ?? '—'}</span>,
}));
vi.mock('../invoicing/[eventId]/SignOffForm', () => ({
  SignOffForm: ({ fingerprint, again }: { fingerprint: string; again: boolean }) => (
    <form>
      sign-off:{fingerprint}:{again ? 'again' : 'first'}
    </form>
  ),
}));
vi.mock('../data', () => ({ loadInvoiceEvent: async () => state.detail }));

const { default: Page } = await import('../invoicing/[eventId]/page');

const ID = '0a0a0a0a-0000-4000-8000-000000000001';

function event(over: Partial<InvoiceEvent> = {}): InvoiceEvent {
  return {
    event_id: ID,
    event_date: '2026-10-14',
    event_title: 'Waiting M&E',
    client_name: 'Leonardo Hotel St Pauls',
    po_number: 'PO-4471',
    venue_name: 'Leonardo Hotel St Pauls',
    cancelled: false,
    last_end_at: '2026-10-14T22:00:00Z',
    check_out_closes_at: '2026-10-15T02:00:00Z',
    shifts: 3,
    billable_shifts: 2,
    pending: 0,
    no_shows: 1,
    turned_away: 0,
    payable_min: 480,
    invoicing: '183.76',
    violations: 1,
    unresolved: 1,
    no_checkouts: 0,
    status: 'review',
    fingerprint: 'fp-1',
    signed_off_at: null,
    signed_off_by_name: null,
    signoff_note: null,
    signed_invoicing: null,
    signoff_stale: false,
    ...over,
  };
}

function line(over: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    booking_id: crypto.randomUUID(),
    staff_name: 'Tom Reid',
    employee_id: 91001,
    removed: false,
    role_name: 'Waiting Staff',
    shift_date: '2026-10-14',
    starts_at: '2026-10-14T18:00:00Z',
    ends_at: '2026-10-14T22:00:00Z',
    check_in_at: '2026-10-14T18:00:00Z',
    check_out_at: '2026-10-14T22:00:00Z',
    kind: 'worked',
    status: 'settled',
    late_check_in: false,
    early_check_out: false,
    no_check_out_unresolved: false,
    unpaid_break_min: 0,
    payable_min: 240,
    floor_applied: false,
    charge_rate: '22.97',
    invoicing: '91.88',
    ...over,
  };
}

const noShow: InvoiceViolation = {
  violation_id: crypto.randomUUID(),
  booking_id: crypto.randomUUID(),
  staff_name: 'Absent Worker',
  employee_id: 91006,
  role_name: 'Waiting Staff',
  type: 'no_show',
  detected_at: '2026-10-14T18:30:00Z',
  minutes_late: null,
  resolved: false,
  resolved_at: null,
  resolved_by_name: null,
  resolution_note: null,
  actual_finish_at: null,
};

async function render(): Promise<string> {
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: ID }) }));
}

beforeEach(() => {
  state.role = 'manager';
  state.detail = {
    problem: null,
    event: event(),
    lines: [
      line(),
      line({ staff_name: 'Priya Sharma' }),
      line({ kind: 'no_show', payable_min: 0, invoicing: '0' }),
    ],
    violations: [noShow],
  };
});

describe('/reports/invoicing/:eventId', () => {
  it('Needs review: lists the violation unresolved and offers the sign-off to a manager', async () => {
    const html = await render();
    expect(html).toContain('Needs review');
    expect(html).toContain('No-show');
    expect(html).toContain('Unresolved');
    expect(html).toContain('No-show · not charged');
    expect(html).toContain('£183.76');
    expect(html).toContain('PO <b>PO-4471</b>');
    expect(html).toContain('sign-off:fp-1:first');
    // Not ready: no CSV yet.
    expect(html).not.toContain('Download CSV');
  });

  it('a viewer reads it but cannot sign off', async () => {
    state.role = 'viewer';
    const html = await render();
    expect(html).toContain('Needs review');
    expect(html).not.toContain('sign-off:');
    expect(html).toContain('Only an owner or a manager can mark an event reviewed.');
  });

  it('a scheduler holds no finance and is turned away', async () => {
    state.role = 'scheduler';
    expect(await render()).toBe('<p>not-available:finance</p>');
  });

  it('Ready: shows who signed it off and the CSV, and no form', async () => {
    state.detail.event = event({
      status: 'ready',
      signed_off_at: '2026-10-15T09:12:00Z',
      signed_off_by_name: 'Gisela',
      signoff_note: 'No-show not charged',
      signed_invoicing: '183.76',
    });
    const html = await render();
    expect(html).toContain('Ready to invoice');
    expect(html).toContain('Marked reviewed by <b>Gisela</b>');
    expect(html).toContain('No-show not charged');
    expect(html).toContain(
      `/reports/export?report=invoicing&amp;from=2026-10-14&amp;to=2026-10-14&amp;event=${ID}`,
    );
    expect(html).not.toContain('sign-off:');
  });

  it('a stale sign-off says so and asks for the review again', async () => {
    state.detail.event = event({
      signed_off_at: '2026-10-15T09:12:00Z',
      signed_off_by_name: 'Gisela',
      signoff_note: 'ok',
      signoff_stale: true,
    });
    const html = await render();
    expect(html).toContain('Changed since it was marked reviewed');
    expect(html).toContain('sign-off:fp-1:again');
  });

  it('Missing check-out: the pending line has no amount and there is no sign-off', async () => {
    state.detail.event = event({ status: 'missing', pending: 1 });
    state.detail.lines = [
      line({ status: 'pending', payable_min: null, invoicing: null, check_out_at: null }),
    ];
    const html = await render();
    expect(html).toContain('Missing check-out');
    expect(html).toContain('Pending');
    expect(html).toContain('No check-out');
    expect(html).not.toContain('sign-off:');
  });

  it('a stale-fix No check-out shows the recorded finish and says it is unresolved', async () => {
    state.detail.event = event({ status: 'missing', no_checkouts: 1 });
    state.detail.lines = [
      line({ check_out_at: '2026-10-14T18:05:00Z', no_check_out_unresolved: true }),
    ];
    const html = await render();
    expect(html).toContain('Missing check-out');
    expect(html).toContain('at:2026-10-14T18:05:00Z');
    expect(html).toContain('No check-out · unresolved');
    expect(html).not.toContain('sign-off:');
  });

  it('shows an overrun as its own line under the shift, priced from its own minutes (ADR-0184)', async () => {
    // £17.35/h, 465 minutes of which 75 past the end: 112.78 + 21.69.
    state.detail = {
      ...state.detail,
      lines: [
        line({
          ends_at: '2026-10-14T22:00:00Z',
          check_out_at: '2026-10-14T23:15:00Z',
          payable_min: 465,
          charge_rate: '17.35',
          invoicing: '134.47',
          overrun_min: 75,
          overrun_invoicing: '21.69',
          late_check_out: true,
          late_check_out_verified: false,
        }),
      ],
    };
    const html = await render();
    expect(html).toContain('Overrun – Waiting Staff');
    expect(html).toContain('window:2026-10-14T22:00:00Z');
    expect(html).toContain('>6.50<');
    expect(html).toContain('£112.78');
    expect(html).toContain('>1.25<');
    expect(html).toContain('£21.69');
    expect(html).toContain('Signed out late · not verified');
  });

  it('a verified late sign-out says so', async () => {
    state.detail = {
      ...state.detail,
      lines: [
        line({
          check_out_at: '2026-10-14T22:45:00Z',
          payable_min: 285,
          invoicing: '109.11',
          overrun_min: 45,
          overrun_invoicing: '17.23',
          late_check_out: true,
          late_check_out_verified: true,
        }),
      ],
    };
    expect(await render()).toContain('Signed out late · verified');
  });

  it('an unknown event is not found', async () => {
    state.detail = { problem: null, event: null, lines: [], violations: [] };
    await expect(render()).rejects.toThrow('NOT_FOUND');
  });
});
