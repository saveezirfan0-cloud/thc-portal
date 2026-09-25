import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MonitorRow, ViolationRow } from '../types';

// Outside Next there is no router; the dialog's action is server-only.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../actions', () => ({ resolveViolation: vi.fn() }));
// The reader is in Athens once mounted; a static render has no mount, so
// the hook is stubbed to what it would settle on.
vi.mock('../useViewerZone', () => ({ useViewerZone: () => 'Europe/Athens' }));

const { EventStrip, MonitorScreen } = await import('../MonitorScreen');

const row = (over: Partial<MonitorRow> = {}): MonitorRow => ({
  bookingId: 'b1',
  staffId: 's1',
  eventId: 'e1',
  eventTitle: 'Afternoon Tea',
  roleName: 'Waiting Staff',
  staffName: 'Sofia R.',
  photoUrl: null,
  startsAt: '2026-09-18T14:00:00Z',
  endsAt: '2026-09-18T20:00:00Z',
  checkInAt: null,
  checkOutAt: null,
  lastFixInside: null,
  lastFixAt: null,
  breaksCount: 0,
  lastBreakAt: null,
  lateCheckOut: false,
  status: 'due',
  ...over,
});

const violation = (over: Partial<ViolationRow> = {}): ViolationRow => ({
  id: 'v1',
  bookingId: 'b1',
  staffName: 'Luca M.',
  photoUrl: null,
  eventTitle: 'Conference Day 2',
  venueName: 'ExCeL London',
  roleName: 'Bar Staff',
  startsAt: '2026-09-18T11:00:00Z',
  endsAt: '2026-09-18T19:00:00Z',
  type: 'left_geofence',
  detectedAt: new Date().toISOString(),
  minutesLate: null,
  resolved: false,
  resolvedAt: null,
  resolvedByName: null,
  resolutionNote: null,
  actualFinishAt: null,
  checkInAt: '2026-09-18T12:58:00Z',
  checkOutAt: null,
  payrollExported: false,
  ...over,
});

describe('§9.5 the violation log', () => {
  it('makes an open entry a clickable, coral-highlighted row with Details alongside', () => {
    const html = renderToStaticMarkup(<MonitorScreen rows={[]} violations={[violation()]} />);
    expect(html).toContain('<tr class="violation clickable"');
    expect(html).toContain('>Details</button>');
  });

  it('dims a resolved entry instead of highlighting it, still clickable', () => {
    const html = renderToStaticMarkup(
      <MonitorScreen
        rows={[]}
        violations={[violation({ resolved: true, resolvedByName: 'Gisela M.' })]}
      />,
    );
    // Hidden until "Show resolved" is ticked (§9.5) …
    expect(html).not.toContain('<tr class=');
    expect(html).toContain('Nothing unresolved');
  });

  it('prints the Time column as "today HH:MM" in the reader’s zone', () => {
    const html = renderToStaticMarkup(<MonitorScreen rows={[]} violations={[violation()]} />);
    expect(html).toMatch(/<td class="mono sm">today \d\d:\d\d<\/td>/);
  });

  it('spells the day for an older entry', () => {
    const html = renderToStaticMarkup(
      <MonitorScreen rows={[]} violations={[violation({ detectedAt: '2020-01-15T19:48:00Z' })]} />,
    );
    expect(html).toContain('<td class="mono sm">Wed 15 · 21:48</td>');
  });
});

describe('§1.8 the event card on the monitor', () => {
  it('carries the event window in both zones, earliest start to latest end', () => {
    const html = renderToStaticMarkup(
      <EventStrip
        zone="Europe/Athens"
        rows={[
          row(),
          row({ bookingId: 'b2', roleName: 'Bar Staff', endsAt: '2026-09-18T22:00:00Z' }),
        ]}
      />,
    );
    expect(html).toContain('15:00 – 23:00 UK time');
    expect(html).toContain('<span class="l2">17:00 – 01:00 your time</span>');
  });

  it('drops the second line for a UK reader', () => {
    const html = renderToStaticMarkup(<EventStrip zone="Europe/London" rows={[row()]} />);
    expect(html).toContain('15:00 – 21:00 UK time');
    expect(html).not.toContain('your time');
  });
});
