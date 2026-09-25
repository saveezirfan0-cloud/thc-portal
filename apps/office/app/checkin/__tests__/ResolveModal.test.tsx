import { renderToStaticMarkup } from 'react-dom/server';
import { formatDateTimeIn } from '@thc/domain';
import { describe, expect, it, vi } from 'vitest';
import type { ViolationRow } from '../types';

// The dialog's submit path is a server action (`@thc/db/server`, which is
// `server-only`); the zone choice under test never reaches it.
vi.mock('../actions', () => ({ resolveViolation: vi.fn() }));

const { ResolveModal } = await import('../ResolveModal');

/**
 * §1.8's "operational versus audit" split inside one window: Detected,
 * Checked in and Checked out follow the reader's zone (checkin.html:
 * "18:58 your time"); "Resolved by" and the finish a manager entered are
 * records of a decision already taken and stay UK.
 */
const violation = (over: Partial<ViolationRow> = {}): ViolationRow => ({
  id: 'v1',
  bookingId: 'b1',
  staffName: 'Omar S.',
  photoUrl: null,
  eventTitle: 'Press Night',
  venueName: 'Mandarin Oriental',
  roleName: 'Waiting Staff',
  // 17:00 – 23:30 UK, BST.
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
  ...over,
});

const render = (v: ViolationRow, zone: string) =>
  renderToStaticMarkup(<ResolveModal violation={v} zone={zone} onClose={() => {}} />);

// The date part comes from the same formatter the window uses, because
// ICU spells the short month "Sep" or "Sept" depending on the runtime.
const dt = (iso: string, zone: string) => formatDateTimeIn(new Date(iso), zone);

describe('the violation window read from Athens', () => {
  const zone = 'Europe/Athens';

  it('shows Detected, Checked in and Checked out in the reader’s zone, single line', () => {
    const html = render(violation(), zone);
    expect(html).toContain(`${dt('2026-09-17T15:58:00Z', zone)} your time`);
    expect(html).toContain(`${dt('2026-09-17T19:48:00Z', zone)} your time`);
    expect(dt('2026-09-17T15:58:00Z', zone)).toMatch(/18:58$/);
    expect(html).not.toContain('16:58');
    expect(html).not.toContain('20:48');
  });

  it('shows the scheduled window dual, like every scheduled time', () => {
    const html = render(violation(), zone);
    const uk = 'Europe/London';
    expect(html).toContain(
      `${dt('2026-09-17T16:00:00Z', uk)} – ${dt('2026-09-17T22:30:00Z', uk)} UK time`,
    );
    expect(html).toContain(
      `(${dt('2026-09-17T16:00:00Z', zone)} – ${dt('2026-09-17T22:30:00Z', zone)} your time)`,
    );
    expect(dt('2026-09-17T22:30:00Z', zone)).toMatch(/^18 Sept?, 01:30$/);
  });

  it('keeps the audit records in UK time', () => {
    const html = render(
      violation({
        type: 'no_checkout',
        resolved: true,
        resolvedAt: '2026-09-16T17:40:00Z',
        resolvedByName: 'Gisela M.',
        resolutionNote: 'Phoned Grace.',
        actualFinishAt: '2026-09-16T15:10:00Z',
      }),
      zone,
    );
    const uk = 'Europe/London';
    expect(html).toContain(`Resolved by Gisela M. · ${dt('2026-09-16T17:40:00Z', uk)} UK time`);
    expect(html).toContain(`${dt('2026-09-16T15:10:00Z', uk)} UK time`);
    expect(dt('2026-09-16T15:10:00Z', uk)).toMatch(/16:10$/);
    expect(html).not.toContain('19:10');
  });

  it('carries the as-built "Flagged as" line (§9.5)', () => {
    expect(render(violation(), zone)).toContain('Left early — Press Night');
  });
});

describe('the violation window read from the UK', () => {
  it('labels the stamps UK time and drops the second window line', () => {
    const uk = 'Europe/London';
    const html = render(violation(), uk);
    expect(html).toContain(`${dt('2026-09-17T15:58:00Z', uk)} UK time`);
    expect(html).toContain(`${dt('2026-09-17T19:48:00Z', uk)} UK time`);
    expect(dt('2026-09-17T15:58:00Z', uk)).toMatch(/16:58$/);
    expect(html).not.toContain('your time');
  });

  it('still labels the typed finish "(UK time)" (§1.8 input rule)', () => {
    expect(render(violation({ type: 'no_checkout', checkOutAt: null }), 'Europe/London')).toContain(
      'Actual finish (UK time)',
    );
  });
});
