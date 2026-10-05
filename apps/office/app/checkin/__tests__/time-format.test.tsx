import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TimeFormatProvider } from '@thc/ui';
import type { MonitorRow, ViolationRow } from '../types';

/**
 * ADR-0085 on /checkin: every clock the monitor draws follows the
 * operator's choice, the zones do not change (§1.8: UK first with "UK time",
 * actual stamps in the viewer's zone), and the two typed fields in the
 * detail window are platform fields, not the browser's `datetime-local`
 * (which draws "5:00 PM" on a 12-hour device whatever was chosen).
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@thc/db/browser', () => ({ createClient: vi.fn() }));
vi.mock('../actions', () => ({ resolveViolation: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { MonitorTable } = await import('../MonitorTable');
const { MonitorScreen } = await import('../MonitorScreen');
const { ResolveModal } = await import('../ResolveModal');

const ROW: MonitorRow = {
  bookingId: 'b1',
  staffId: 's1',
  eventId: 'e1',
  eventTitle: 'Afternoon Tea',
  roleName: 'Waiting Staff',
  staffName: 'Nadia H.',
  photoUrl: null,
  startsAt: '2026-06-14T14:00:00Z', // 15:00 UK
  endsAt: '2026-06-14T20:00:00Z', // 21:00 UK
  checkInAt: '2026-06-14T14:05:00Z',
  checkOutAt: null,
  lastFixInside: true,
  lastFixAt: '2026-06-14T14:05:00Z',
  breaksCount: 0,
  lastBreakAt: null,
  lateCheckOut: false,
  status: 'on_shift',
};

const VIOLATION: ViolationRow = {
  id: 'v1',
  bookingId: 'b1',
  staffName: 'Omar S.',
  photoUrl: null,
  eventTitle: 'Press Night',
  venueName: 'Mandarin Oriental',
  roleName: 'Waiting Staff',
  startsAt: '2026-09-17T16:00:00Z',
  endsAt: '2026-09-17T22:30:00Z',
  type: 'no_checkout',
  detectedAt: '2026-09-17T19:48:00Z',
  minutesLate: null,
  resolved: false,
  resolvedAt: null,
  resolvedByName: null,
  resolutionNote: null,
  actualFinishAt: null,
  checkInAt: '2026-09-17T15:58:00Z',
  checkOutAt: null,
  payrollExported: false,
  flaggedAs: 'No check-out — Press Night',
};

const within = (format: '24h' | '12h', node: React.ReactNode) =>
  renderToStaticMarkup(<TimeFormatProvider format={format}>{node}</TimeFormatProvider>);

describe('the live monitor', () => {
  it('writes the window and the check-in stamp on a 24-hour clock by default', () => {
    const html = within('24h', <MonitorTable rows={[ROW]} />);
    expect(html).toContain('15:00 – 21:00 UK time');
    expect(html).toContain('15:05');
  });

  it('writes them on a 12-hour clock for an operator who chose it, still "UK time"', () => {
    const html = within('12h', <MonitorTable rows={[ROW]} />);
    expect(html).toContain('3:00 pm – 9:00 pm UK time');
    expect(html).toContain('3:05 pm');
    expect(html).not.toContain('15:00');
  });

  it('writes the violation log’s Time column and the event strip on the clock', () => {
    const html = within('12h', <MonitorScreen rows={[ROW]} violations={[VIOLATION]} />);
    // 19:48Z is 20:48 in London; the first paint is UK (D41).
    expect(html).toContain('8:48 pm');
    expect(html).toContain('3:00 pm UK');
  });
});

describe('the violation detail window', () => {
  it('has no browser datetime-local input; the typed finish is a date and a time field', () => {
    const html = within('24h', <ResolveModal violation={VIOLATION} onClose={() => {}} />);
    expect(html).not.toContain('datetime-local');
    expect(html).not.toContain('type="time"');
    expect(html).toContain('Actual finish (UK time)');
    expect(html).toContain('type="date"');
    expect(html).toContain('placeholder="HH:MM"');
  });

  it('asks for the time in the operator’s clock', () => {
    const html = within('12h', <ResolveModal violation={VIOLATION} onClose={() => {}} />);
    expect(html).toContain('placeholder="h:mm am/pm"');
    expect(html).toContain('Actual finish (UK time)');
  });

  it('writes the actual stamps on the chosen clock with "your time", not "UK time"', () => {
    const twelve = within('12h', <ResolveModal violation={VIOLATION} onClose={() => {}} />);
    expect(twelve).toMatch(/Detected[^]*?(?:\d{2} \w{3}, )\d{1,2}:48 [ap]m your time/);
    const twentyFour = within('24h', <ResolveModal violation={VIOLATION} onClose={() => {}} />);
    expect(twentyFour).not.toMatch(/\d [ap]m your time/);
  });

  it('keeps the audit stamps UK-only on either clock', () => {
    const resolved = {
      ...VIOLATION,
      resolved: true,
      resolvedAt: '2026-09-18T08:12:00Z',
      resolvedByName: 'Gisela B.',
      resolutionNote: 'Sent home by the client.',
      actualFinishAt: '2026-09-17T21:10:00Z',
    };
    const html = within('12h', <ResolveModal violation={resolved} onClose={() => {}} />);
    expect(html).toContain('18 Sep, 9:12 am UK');
    expect(html).toContain('17 Sep, 10:10 pm UK');
  });
});
