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
const { VerifyLateModal } = await import('../VerifyLateModal');

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
  locationSuspect: false,
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

  it('marks an arrival whose location is suspect, beside its check-in time', () => {
    const html = renderToStaticMarkup(
      <MonitorScreen rows={[{ ...ROW, locationSuspect: true }]} violations={[]} />,
    );
    expect(html).toMatch(/<span class="pill amber loc-flag"[^>]*>Location unverified<\/span>/);
  });

  it('shows no flag for a clean arrival, nor before anyone has arrived', () => {
    expect(renderToStaticMarkup(<MonitorScreen rows={[ROW]} violations={[]} />)).not.toContain(
      'Location unverified',
    );
    expect(
      renderToStaticMarkup(
        <MonitorScreen
          rows={[{ ...ROW, checkInAt: null, locationSuspect: true, status: 'due' }]}
          violations={[]}
        />,
      ),
    ).not.toContain('Location unverified');
  });

  it('highlights an unresolved violation coral and makes the whole row open it', () => {
    const html = renderToStaticMarkup(<MonitorScreen rows={[]} violations={[VIOLATION]} />);
    expect(html).toContain('<tr class="violation clickable" tabindex="0"');
  });

  describe('ADR-0184 signed out late', () => {
    const LATE: MonitorRow = {
      ...ROW,
      checkOutAt: '2026-09-24T20:15:00Z',
      lateCheckOut: true,
      status: 'checked_out',
    };

    it('keeps the red pill and asks the office to verify, with a Verify button', () => {
      const html = renderToStaticMarkup(<MonitorScreen rows={[LATE]} violations={[]} />);
      expect(html).toMatch(/<span class="pill coral"[^>]*>Checked out/);
      expect(html).toContain('Signed out late — verify with the worker');
      expect(html).toContain('>Verify<');
      expect(html).not.toContain('Over weekly limit');
      // Nothing on the screen says the pay stops at the end any more.
      expect(html).not.toMatch(/scheduled end/i);
    });

    it('warns on the board when the overrun takes the worker past their weekly limit', () => {
      const html = renderToStaticMarkup(
        <MonitorScreen rows={[{ ...LATE, weekHours: 49, weekCapHours: 48 }]} violations={[]} />,
      );
      expect(html).toContain('Over weekly limit: 49 h of 48 h');
    });

    it('once verified, the pill is neutral and the line says who verified it', () => {
      const html = renderToStaticMarkup(
        <MonitorScreen
          rows={[
            {
              ...LATE,
              lateCheckOutVerifiedAt: '2026-09-25T08:00:00Z',
              lateCheckOutVerifiedByName: 'Sam S.',
            },
          ]}
          violations={[]}
        />,
      );
      expect(html).toContain('<span class="pill">Checked out 21:15</span>');
      expect(html).toContain('Signed out late · verified by Sam S.');
      expect(html).not.toContain('>Verify<');
    });

    it('lists the fortnight’s late sign-outs still to verify', () => {
      const html = renderToStaticMarkup(
        <MonitorScreen
          rows={[]}
          violations={[]}
          lateCheckOuts={[
            {
              bookingId: 'b9',
              staffName: 'Grace L.',
              photoUrl: null,
              eventTitle: 'Gala Dinner',
              venueName: 'The Dorchester',
              roleName: 'Waiting Staff',
              startsAt: '2026-09-23T11:00:00Z',
              endsAt: '2026-09-23T15:00:00Z',
              checkInAt: '2026-09-23T11:00:00Z',
              checkOutAt: '2026-09-23T16:15:00Z',
              finishByOffice: false,
              minutesPastEnd: 75,
              verifiedAt: null,
              verifiedByName: null,
              note: null,
              weekHours: 21.25,
              weekCapHours: 20,
            },
          ]}
        />,
      );
      expect(html).toContain('Signed out late — verify with the worker · last 14 days');
      expect(html).toContain('Grace L.');
      expect(html).toContain('1 h 15 min past the end');
      // RULE-20: the paid overrun took her past her weekly limit.
      expect(html).toContain('Over weekly limit: 21 h 15 of 20 h');
    });

    it('shows no list when there is nothing to verify', () => {
      expect(renderToStaticMarkup(<MonitorScreen rows={[]} violations={[]} />)).not.toContain(
        'last 14 days',
      );
    });
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

    it('in the Verify window: the scheduled end is UK with "your time" under it, the sign-out your time (ADR-0184)', () => {
      const html = renderToStaticMarkup(
        <VerifyLateModal
          target={{
            bookingId: 'b1',
            staffName: 'Chloe D.',
            eventTitle: 'Conference Day 2',
            roleName: 'Bar Staff',
            endsAt: '2026-09-24T19:00:00Z',
            checkOutAt: '2026-09-24T20:15:00Z',
          }}
          onClose={() => {}}
        />,
      );
      // 19:00Z is 20:00 UK and 22:00 in Athens; the sign-out 20:15Z is 23:15 there.
      expect(html).toMatch(/20:00 UK time<span class="l2">[^<]*22:00 your time<\/span>/);
      expect(html).toContain('23:15 your time');
      expect(html).toContain('1 h 15 min past the end');
      expect(html).not.toContain('paid up to 4 h');
      expect(html).not.toContain('Over weekly limit');
    });

    it('warns in the Verify window when the overrun took the worker past their weekly limit', () => {
      const html = renderToStaticMarkup(
        <VerifyLateModal
          target={{
            bookingId: 'b1',
            staffName: 'Chloe D.',
            eventTitle: 'Conference Day 2',
            roleName: 'Bar Staff',
            endsAt: '2026-09-24T19:00:00Z',
            checkOutAt: '2026-09-24T20:15:00Z',
            weekHours: 21.25,
            weekCapHours: 20,
          }}
          onClose={() => {}}
        />,
      );
      expect(html).toContain('Over weekly limit: 21 h 15 of 20 h');
    });

    it('tells the manager a finish past end + 4 h is not paid beyond it', () => {
      const html = renderToStaticMarkup(
        <ResolveModal violation={{ ...VIOLATION, type: 'no_checkout' }} onClose={() => {}} />,
      );
      expect(html).toContain('Time more than 4 hours after the scheduled end is not paid.');
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
