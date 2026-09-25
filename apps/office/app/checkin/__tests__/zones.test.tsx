import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MonitorRow, ViolationRow } from '../types';

/**
 * §1.8 on /checkin (audit D30, D41) and the detail window's stamps.
 *
 * The reader is in Athens (UK + 2 in summer). `viewerZone()` answers with
 * that zone wherever it is called — which is exactly the server-render bug
 * D41 describes, so nothing that renders on the server may call it: the
 * first paint must be UK, with the reader's zone arriving on mount. The
 * detail window is the one exception: it only mounts on a click in the
 * browser, so it reads `viewerZone()` directly (main's choice, kept).
 */
vi.mock('@thc/domain', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  viewerZone: () => 'Europe/Athens',
}));
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
const { statusLabel } = await import('../status');

const ROW: MonitorRow = {
  bookingId: 'b1',
  staffId: 's1',
  eventId: 'e1',
  eventTitle: 'Afternoon Tea',
  roleName: 'Waiting Staff',
  staffName: 'Nadia H.',
  photoUrl: null,
  startsAt: '2026-06-14T14:00:00Z', // 15:00 UK, 17:00 Athens
  endsAt: '2026-06-14T20:00:00Z',
  checkInAt: null,
  checkOutAt: null,
  lastFixInside: null,
  lastFixAt: null,
  breaksCount: 0,
  lastBreakAt: null,
  lateCheckOut: false,
  status: 'due',
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
  type: 'left_early',
  detectedAt: '2026-09-17T19:48:00Z',
  minutesLate: null,
  resolved: false,
  resolvedAt: null,
  resolvedByName: null,
  resolutionNote: null,
  actualFinishAt: null,
  checkInAt: '2026-09-17T15:58:00Z',
  checkOutAt: '2026-09-17T19:48:00Z',
  payrollExported: false,
  flaggedAs: 'Checked out early — Press Night',
};

describe('the Due pill (§1.8, D30)', () => {
  it('shows the scheduled start on the viewer’s own clock, with no zone suffix', () => {
    const athens = (iso: string) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Athens',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(iso));
    expect(statusLabel(ROW, athens)).toBe('Due 17:00');
  });

  it('a checked-out row carries the recorded stamp the same way', () => {
    expect(
      statusLabel({ ...ROW, status: 'checked_out', checkOutAt: '2026-06-14T20:05:00Z' }, () => 'X'),
    ).toBe('Checked out X');
  });
});

describe('first paint is UK, never the server’s zone (D41)', () => {
  it('MonitorTable does not read viewerZone() during render', () => {
    const html = renderToStaticMarkup(<MonitorTable rows={[ROW]} />);
    // Server render: the Due pill and the window are UK; no "your time" line
    // until the browser has said where it is.
    expect(html).toContain('Due 15:00');
    expect(html).toContain('15:00 – 21:00 UK time');
    expect(html).not.toContain('your time');
  });

  it('nor does the violation log', () => {
    const html = renderToStaticMarkup(<MonitorScreen rows={[]} violations={[VIOLATION]} />);
    // 19:48 UTC = 20:48 UK; 22:48 would be Athens.
    expect(html).toContain('20:48');
    expect(html).not.toContain('22:48');
  });
});

describe('the violation log (D50)', () => {
  it('renders the page it was given, with the pager only when there is one', () => {
    const one = renderToStaticMarkup(<MonitorScreen rows={[]} violations={[VIOLATION]} />);
    expect(one).not.toContain('Older');
    const more = renderToStaticMarkup(
      <MonitorScreen
        rows={[]}
        violations={[VIOLATION]}
        log={{ showResolved: true, page: 2 }}
        hasMore
      />,
    );
    expect(more).toContain('href="/checkin?resolved=1&amp;page=3"');
    expect(more).toContain('href="/checkin?resolved=1"');
    expect(more).toContain('Page 2');
  });

  it('Show resolved reflects the URL, unticked by default', () => {
    const html = renderToStaticMarkup(<MonitorScreen rows={[]} violations={[]} />);
    expect(html).toContain('Nothing unresolved');
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
  });
});

describe('the detail window (§9.5)', () => {
  it('carries the "Flagged as" line and the stamps as actual instants', () => {
    const html = renderToStaticMarkup(<ResolveModal violation={VIOLATION} onClose={() => {}} />);
    expect(html).toContain('Flagged as');
    expect(html).toContain('Checked out early — Press Night');
    // Viewer-local ("your time"). The window only ever mounts on a click in
    // the browser, so it reads viewerZone() directly: Athens here.
    expect(html).toContain('17 Sep, 18:58 your time');
    expect(html).toContain('17 Sep, 22:48 your time');
    expect(html).not.toContain('16:58 UK');
  });

  it('composes "Flagged as" itself when the row does not carry it', () => {
    const { flaggedAs: _omit, ...bare } = VIOLATION;
    const html = renderToStaticMarkup(<ResolveModal violation={bare} onClose={() => {}} />);
    expect(html).toContain('Checked out early — Press Night');
  });

  it('asks a No-show for the arrival, required and with a finish once the shift has ended (D17)', () => {
    const html = renderToStaticMarkup(
      <ResolveModal
        violation={{ ...VIOLATION, type: 'no_show', checkInAt: null, checkOutAt: null }}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('Arrived at (UK time)');
    expect(html).toContain('Actual finish (UK time)');
    expect(html).toContain('The shift has ended');
  });

  it('a No-show on a shift still running takes an optional arrival and no finish', () => {
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const html = renderToStaticMarkup(
      <ResolveModal
        violation={{ ...VIOLATION, type: 'no_show', endsAt: later, checkInAt: null }}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('Arrived at (UK time)');
    expect(html).toContain('Leave empty to register them as arriving now');
    expect(html).not.toContain('Actual finish (UK time)');
  });
});
