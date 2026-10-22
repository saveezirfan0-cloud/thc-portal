import type { ReactNode } from 'react';
import { use } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /events/:id paints the board and streams each section's candidate pool
 * (ADR-0161, after ADR-0109). Two things ADR-0109 exists for are pinned:
 *
 *   · an unknown event is a REAL 404: `notFound()` is called by the page
 *     itself, from the board's first read, before any boundary streams;
 *   · the pool is behind its own Suspense: while `auto_assign_candidates`
 *     is still out, the section's header and Confirmed are drawn, with the
 *     pool's skeleton in its place — the pool never holds the line-up.
 */
const state = vi.hoisted(() => ({
  load: null as unknown,
  pools: 0,
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../[id]/board-data', () => ({
  loadBoard: async () => state.load,
}));
vi.mock('../../_lib/timeFormat', () => ({ currentTimeFormat: async () => '24h' }));
vi.mock('../[id]/document-autosend', () => ({
  // Never answers: the hint line streams, so the board must not wait for it.
  loadAutosendHints: () => new Promise(() => {}),
}));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ title, children }: { title: ReactNode; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('../../_components/AutoRefresh', () => ({ AutoRefresh: () => null }));
vi.mock('../../_components/history/RecordHistory', () => ({ RecordHistory: () => null }));
vi.mock('../_components/ViewerZone', () => ({ ViewerZone: () => null }));
for (const name of [
  'AutoAssignSwitch',
  'CancelEvent',
  'DocumentActions',
  'DocumentRecipients',
  'MessageStaff',
  'BookingActions',
]) {
  vi.doMock(`../[id]/_components/${name}`, () => ({ [name]: () => null }));
}
vi.mock('../[id]/_components/Attendance', () => ({
  AttendancePills: () => null,
  AttendanceStamp: () => null,
}));
vi.mock('../[id]/_components/RoleBlock', () => ({
  RoleBlock: ({ heading, children }: { heading: ReactNode; children: ReactNode }) => (
    <section>
      <header>{heading}</header>
      {children}
    </section>
  ),
}));
vi.mock('../[id]/_components/SectionPools', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  const never = new Promise<never>(() => {});
  return {
    ...actual,
    // The pool is still being ranked when the page is sent.
    SectionPools: () => {
      state.pools += 1;
      return use(never);
    },
  };
});

const { default: Page } = await import('../[id]/page');

const BOOKED = {
  staffId: 'w-1',
  name: 'Grace L.',
  roles: ['Waiter'],
  photoUrl: null,
  bookingId: 'b-1',
  status: 'confirmed',
  source: 'manual',
  createdAt: '2099-06-01T09:00:00Z',
  confirmedAt: '2099-06-01T09:00:00Z',
  dayBeforeConfirmedAt: null,
  appliedAt: null,
  qualified: false,
  noShow: false,
  reconfirmRequired: false,
  offer: null,
  attendance: { kind: 'none' },
};

function board(sections = 1) {
  return {
    problem: null,
    event: {
      id: 'ev-1',
      title: 'Gala Dinner',
      date: '2099-07-03',
      clientId: 'c-1',
      clientName: 'Acme',
      nameBadges: false,
      clientContactEmails: [],
      documentRecipients: null,
      venueName: 'Hall',
      venueAddress: '1 Street',
      poNumber: '',
      notes: '',
      onsiteContact: '',
      autoAssign: true,
      requiredLanguages: ['English'],
      seriesLabel: null,
      paysBreaks: true,
      paysBuffer: true,
      cancelledAt: null,
      cancelReason: '',
      payrollExportedAt: null,
      weights: { show: 0.3, rating: 0.25, proximity: 0.25, fair: 0.1, venue: 0.1 },
      known: { people: new Map(), roleNames: new Map() },
      sections: Array.from({ length: sections }, (_, n) => ({
        id: `sec-${n}`,
        roleId: 'r-1',
        roleName: n === 0 ? 'Waiter' : 'Bar Staff',
        startsAt: '2099-07-03T16:00:00Z',
        endsAt: '2099-07-03T22:00:00Z',
        headcount: 4,
        buffer: 1,
        chargeRate: null,
        payRate: null,
        dressCode: '',
        autoAssign: true,
        requiredGender: null,
        sameStaffAllDays: false,
        allocationPerHour: 7,
        confirmed: n === 0 ? [BOOKED] : [],
        invited: [],
        applied: [],
        handovers: [],
        escalation: false,
        poolInput: {
          shiftId: `sec-${n}`,
          escalation: false,
          applications: [],
          ended: [],
          live: [],
        },
      })),
    },
  };
}

beforeEach(() => {
  state.pools = 0;
});

describe('/events/:id streams the pool behind the line-up', () => {
  it('answers an unknown event with notFound() before anything streams', async () => {
    state.load = { event: null, problem: null };
    await expect(Page({ params: Promise.resolve({ id: 'missing' }) })).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
  });

  it('a failed read is said in the shell, never a 404', async () => {
    state.load = { event: null, problem: 'The event could not be read.' };
    const html = renderToString(await Page({ params: Promise.resolve({ id: 'ev-1' }) }));
    expect(html).toContain('The event could not be read.');
    // ADR-0195: the way back is offered here too.
    expect(html).toContain('Back to Scheduling');
  });

  it('draws the header and Confirmed while every section’s pool is still out', async () => {
    state.load = board(2);
    const html = renderToString(await Page({ params: Promise.resolve({ id: 'ev-1' }) }));
    expect(html).toContain('<h1>Gala Dinner</h1>');
    expect(html).toContain('Grace L.');
    // ADR-0195: the board's way back to Scheduling (plain /events until mount).
    expect(html).toMatch(/<a href="\/events"[^>]*>.*Back to Scheduling/);
    // One boundary per section, each holding its own skeleton (React may
    // try a suspended component more than once, so the count is a floor).
    expect(state.pools).toBeGreaterThanOrEqual(2);
    expect(html).toContain('Ranking the Waiter candidate pool');
    expect(html).toContain('Ranking the Bar Staff candidate pool');
    expect(html.match(/role="status"/g)).toHaveLength(2);
  });

  it('asks for no pool on a cancelled event, which draws none', async () => {
    const cancelled = board(1);
    cancelled.event.cancelledAt = '2099-06-20T10:00:00Z' as unknown as null;
    state.load = cancelled;
    const html = renderToString(await Page({ params: Promise.resolve({ id: 'ev-1' }) }));
    expect(html).toContain('This event is cancelled.');
    expect(state.pools).toBe(0);
    expect(html).not.toContain('candidate pool');
  });
});
