import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ALLOCATION_TIMING, WELCOME, documentPendingLine } from '../rules';
import type { LineupRow, PortalEvent } from '../rules';

/**
 * ADR-0134 N8 (the first-visit welcome) and N6 (the printable line-up).
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../events/[id]/actions', () => ({ leaveFeedback: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { WelcomePanel, WELCOME_KEY, rememberDismissed, welcomeDismissed } =
  await import('../WelcomePanel');
const { EventScreen } = await import('../events/[id]/EventScreen');

describe('N8 · the welcome', () => {
  it('says three things: what is here, when timesheets come, how feedback works', () => {
    expect(WELCOME.lines).toHaveLength(3);
    expect(WELCOME.lines[1]).toContain(ALLOCATION_TIMING);
    expect(WELCOME.lines[1]).toContain('Completed Timesheet');
    expect(WELCOME.lines[2]).toMatch(/once an event has started/);
  });

  it('uses the same timing words as the list’s quiet line (round 2)', () => {
    const event = { status: 'upcoming' as const, startsAt: '2026-10-20T16:00:00Z' };
    expect(documentPendingLine('allocation', event, new Date('2026-10-14T09:00:00Z'))).toBe(
      `Allocation Timesheet: ${ALLOCATION_TIMING}`,
    );
  });

  it('never speaks of money or of how THC chooses who to book', () => {
    const text = [WELCOME.title, ...WELCOME.lines].join(' ').toLowerCase();
    for (const word of ['£', 'rate', 'charge', 'margin', '/h', 'invited', 'unavailable', 'auto']) {
      expect(text).not.toContain(word);
    }
  });

  it('is drawn only once mounted, so a returning customer never sees it flash', () => {
    expect(renderToStaticMarkup(<WelcomePanel />)).toBe('');
  });

  it('remembers a dismissal per device, and survives storage that throws', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(welcomeDismissed(storage)).toBe(false);
    rememberDismissed(storage);
    expect(store.get(WELCOME_KEY)).toBe('1');
    expect(welcomeDismissed(storage)).toBe(true);

    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(welcomeDismissed(broken)).toBe(false);
    expect(() => rememberDismissed(broken)).not.toThrow();
    expect(welcomeDismissed(null)).toBe(false);
  });
});

const EVENT_ID = '60000000-0000-4000-8000-000000000001';
const gala = (over: Partial<PortalEvent> = {}): PortalEvent => ({
  id: EVENT_ID,
  title: 'Gala Dinner',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St',
  eventDate: '2026-09-19',
  poNumber: '4471-A',
  onsiteContact: null,
  startsAt: '2026-09-19T06:00:00Z',
  endsAt: '2026-09-19T22:30:00Z',
  status: 'upcoming',
  ...over,
});
const lineup: LineupRow[] = [
  {
    bookingId: 'b-1',
    eventId: EVENT_ID,
    shiftId: 's-1',
    role: 'Chef',
    startsAt: '2026-09-19T06:00:00Z',
    endsAt: '2026-09-19T14:00:00Z',
    name: 'Aisha Bello',
    sortKey: 'bello',
    feedbackGiven: false,
  },
];
const screen = (event: PortalEvent) =>
  renderToStaticMarkup(
    <EventScreen
      event={event}
      sections={[]}
      lineup={lineup}
      photos={{}}
      now="2026-09-18T09:00:00Z"
    />,
  );

describe('N6 · the printable line-up', () => {
  it('offers "Print line-up" in the header, and not for a cancelled event', () => {
    expect(screen(gala())).toContain('Print line-up');
    expect(screen(gala({ status: 'cancelled' }))).not.toContain('Print line-up');
  });

  it('prints the header and the faces by role, and none of the chrome', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'client-portal.css'),
      'utf8',
    );
    const print = css.slice(css.indexOf('@media print'));
    for (const hidden of [
      '.ctop',
      '.ehead .actions',
      '.ehead .back-link',
      '.alert',
      '.wrow .fb',
      '.rate-all-row',
      '.cp-welcome',
    ]) {
      expect(print).toContain(hidden);
    }
    expect(print).toContain('.wrow {\n    break-inside: avoid;');
    // Tokens only: no colour is written into the print rules.
    expect(print).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
  });
});
