import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MonitorRow, ViolationRow } from '../types';

// Outside Next there is no router, no server and no Supabase; none is under test.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@thc/db/browser', () => ({ createClient: vi.fn() }));
vi.mock('../actions', () => ({ resolveViolation: vi.fn() }));

const { MonitorScreen } = await import('../MonitorScreen');

const VIOLATION: ViolationRow = {
  id: 'v1',
  bookingId: 'b1',
  staffName: 'Luca M.',
  photoUrl: 'https://signed/luca',
  eventTitle: 'Conference Day 2',
  venueName: 'ExCeL London',
  roleName: 'Bar Staff',
  startsAt: '2026-09-24T11:00:00Z',
  endsAt: '2026-09-24T19:00:00Z',
  type: 'left_geofence',
  detectedAt: '2026-09-24T15:12:00Z',
  minutesLate: null,
  resolved: false,
  resolvedAt: null,
  resolvedByName: null,
  resolutionNote: null,
  actualFinishAt: null,
  checkInAt: '2026-09-24T10:58:00Z',
  checkOutAt: null,
  payrollExported: false,
};

const ROW: MonitorRow = {
  bookingId: 'b1',
  staffId: 's1',
  eventId: 'e1',
  eventTitle: 'Conference Day 2',
  roleName: 'Bar Staff',
  staffName: 'Chloe D.',
  photoUrl: 'https://signed/chloe',
  startsAt: '2026-09-24T11:00:00Z',
  endsAt: '2026-09-24T19:00:00Z',
  checkInAt: '2026-09-24T11:21:00Z',
  checkOutAt: null,
  lastFixInside: true,
  lastFixAt: '2026-09-24T12:00:00Z',
  breaksCount: 0,
  lastBreakAt: null,
  lateCheckOut: false,
  status: 'on_shift',
};

describe('/checkin (§9.5)', () => {
  it('draws the selfie from its signed URL, never a storage path', () => {
    const html = renderToStaticMarkup(<MonitorScreen rows={[ROW]} violations={[VIOLATION]} />);
    expect(html).toContain('src="https://signed/chloe"');
    expect(html).toContain('src="https://signed/luca"');
  });

  it('falls back to initials when there is no photo', () => {
    const html = renderToStaticMarkup(
      <MonitorScreen rows={[]} violations={[{ ...VIOLATION, photoUrl: null }]} />,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('>LM<');
  });

  it('highlights an unresolved violation coral and makes the whole row open it', () => {
    const html = renderToStaticMarkup(<MonitorScreen rows={[]} violations={[VIOLATION]} />);
    expect(html).toContain('<tr class="violation clickable" tabindex="0"');
  });
});
