// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MonitorRow, ViolationRow } from '../types';

// Outside Next there is no router, no server and no Supabase; none is under test.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@thc/db/browser', () => ({ createClient: vi.fn() }));
vi.mock('../actions', () => ({ resolveViolation: vi.fn() }));

// A manager reading from Athens (UTC+3 in September; the UK is UTC+1), so
// every §1.8 rule below has a two-hour gap to show up in.
vi.mock('@thc/domain', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  viewerZone: () => 'Europe/Athens',
}));

const { MonitorScreen } = await import('../MonitorScreen');

/**
 * The monitor reads the reader's zone with `useViewerZone()` (audit D41):
 * UK on the server render, the browser's zone once mounted. The §1.8 zone
 * cases below are therefore MOUNTED renders — a static render would only
 * ever show the UK first paint (zones.test.tsx pins that half).
 */
function mounted(node: ReactNode): string {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  const html = container.innerHTML;
  act(() => root.unmount());
  container.remove();
  return html;
}
const { ResolveModal } = await import('../ResolveModal');

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

  describe('§1.8 zones, read from Athens', () => {
    it('shows the Due pill in the viewer’s own zone with no suffix, beside the UK window', () => {
      const html = mounted(
        <MonitorScreen
          rows={[{ ...ROW, checkInAt: null, lastFixInside: null, lastFixAt: null, status: 'due' }]}
          violations={[]}
        />,
      );
      // 11:00Z is 12:00 UK and 14:00 in Athens.
      expect(html).toContain('Due 14:00');
      expect(html).not.toContain('Due 12:00');
      expect(html).toContain('12:00 – 20:00 UK time');
      expect(html).toContain('14:00 – 22:00 your time');
    });

    it('shows an actual check-in stamp in the viewer’s zone only', () => {
      const html = mounted(<MonitorScreen rows={[ROW]} violations={[]} />);
      expect(html).toContain('class="stamp">14:21<');
    });

    it('in the detail window: Detected / Checked in / Checked out are "your time", the audit stamps UK', () => {
      const html = renderToStaticMarkup(
        <ResolveModal
          violation={{
            ...VIOLATION,
            type: 'no_checkout',
            checkOutAt: '2026-09-24T19:30:00Z',
            resolved: true,
            resolvedAt: '2026-09-25T08:05:00Z',
            resolvedByName: 'Gisela M.',
            resolutionNote: 'Client confirmed she left at 20:30.',
            actualFinishAt: '2026-09-24T19:30:00Z',
          }}
          onClose={() => {}}
        />,
      );
      // 15:12Z → 18:12 Athens; 10:58Z → 13:58; 19:30Z → 22:30.
      expect(html).toContain('18:12 your time');
      expect(html).toContain('13:58 your time');
      expect(html).toContain('22:30 your time');
      expect(html).not.toContain('16:12 UK');
      // Resolved at 08:05Z is 09:05 UK; the entered finish 19:30Z is 20:30 UK.
      expect(html).toContain('09:05 UK');
      expect(html).toContain('20:30 UK');
      expect(html).toContain('Resolved by Gisela M.');
    });

    it('labels the finish input UK time because everything else on the window is not', () => {
      const html = renderToStaticMarkup(
        <ResolveModal violation={{ ...VIOLATION, type: 'no_checkout' }} onClose={() => {}} />,
      );
      expect(html).toContain('Actual finish (UK time)');
      expect(html).toContain('no check-out recorded');
    });
  });
});
