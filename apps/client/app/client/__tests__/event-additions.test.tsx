import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LineupRow, PortalEvent, RoleSection } from '../rules';

/**
 * ADR-0134 N1–N3 on the event page: THC's on-the-day phone as a tap-to-call
 * link beside "Contact THC about this event" (hidden while unset), each
 * role's dress code in its panel, and who this event's timesheets go to in
 * the meta block. Nothing here is money, and nothing names a worker beyond
 * the line-up the page already shows.
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

const { EventScreen } = await import('../events/[id]/EventScreen');
const { recipientsLine, telHref } = await import('../contact');

const EVENT_ID = '60000000-0000-4000-8000-000000000001';
const BEFORE = '2026-09-18T09:00:00Z';

const gala = (over: Partial<PortalEvent> & { timesheetRecipients?: string[] } = {}) => ({
  id: EVENT_ID,
  title: 'Gala Dinner',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St, EC4V 5AJ',
  eventDate: '2026-09-19',
  poNumber: '4471-A',
  onsiteContact: 'Marco Vitale · Banqueting manager',
  startsAt: '2026-09-19T06:00:00Z',
  endsAt: '2026-09-19T22:30:00Z',
  status: 'upcoming' as const,
  ...over,
});

const sections: RoleSection[] = [
  {
    shiftId: 's-chef',
    eventId: EVENT_ID,
    role: 'Chef',
    startsAt: '2026-09-19T06:00:00Z',
    endsAt: '2026-09-19T14:00:00Z',
    headcount: 2,
    confirmed: 1,
    dressCode: 'Chef whites, black trousers',
  },
  {
    shiftId: 's-wait',
    eventId: EVENT_ID,
    role: 'Waiting Staff',
    startsAt: '2026-09-19T16:00:00Z',
    endsAt: '2026-09-19T22:30:00Z',
    headcount: 4,
    confirmed: 0,
    dressCode: null,
  },
];

const lineup: LineupRow[] = [
  {
    bookingId: 'b-1',
    eventId: EVENT_ID,
    shiftId: 's-chef',
    role: 'Chef',
    startsAt: '2026-09-19T06:00:00Z',
    endsAt: '2026-09-19T14:00:00Z',
    name: 'Aisha Bello',
    sortKey: 'bello',
    feedbackGiven: false,
  },
];

function page(event = gala(), thcPhone: string | null = null) {
  return renderToStaticMarkup(
    <EventScreen
      event={event}
      sections={sections}
      lineup={lineup}
      photos={{}}
      now={BEFORE}
      thcPhone={thcPhone}
    />,
  );
}

describe('N1 · THC on-the-day phone', () => {
  it('is a tel: link beside "Contact THC about this event", named for a screen reader', () => {
    const html = page(gala(), '+44 (0)20 7946 0000');
    expect(html).toContain('href="tel:+442079460000"');
    expect(html).toContain('aria-label="Call THC on +44 (0)20 7946 0000"');
    expect(html.indexOf('Contact THC about this event')).toBeLessThan(html.indexOf('Call THC'));
  });

  it('is hidden while the office has not set one, or it is not a number', () => {
    expect(page(gala(), null)).not.toContain('tel:');
    expect(page(gala(), 'ask at reception')).not.toContain('Call THC');
  });

  it('dials digits only, keeps a leading +, drops a UK (0)', () => {
    expect(telHref('020 7946 0000')).toBe('tel:02079460000');
    expect(telHref('+44 (0)20 7946-0000')).toBe('tel:+442079460000');
    expect(telHref('0207')).toBeNull();
    expect(telHref('')).toBeNull();
  });
});

describe('N2 · dress code per role', () => {
  it('heads the role panel that has one, and only that one', () => {
    const html = page();
    expect(html).toContain(
      '<p class="role-dress sm"><span class="k">Dress code</span> Chef whites, black trousers</p>',
    );
    expect(html.match(/role-dress/g)).toHaveLength(1);
  });

  it('never prints the office’s notes: there are none on the page to print', () => {
    expect(page()).not.toMatch(/notes/i);
  });
});

describe('N3 · who the timesheets go to', () => {
  it('lists the addresses in the meta block, each once', () => {
    const html = page(
      gala({
        timesheetRecipients: [
          'banqueting@leonardo.test',
          'Events@leonardo.test',
          'events@leonardo.test',
        ],
      }),
    );
    expect(html).toContain('Timesheets go to');
    // One per line, with a break opportunity after the "@".
    expect(html).toContain('<span class="addr">banqueting@<wbr/>leonardo.test</span>');
    const text = html.replace(/<wbr\/>/g, '');
    expect(text.match(/events@leonardo\.test/gi)).toHaveLength(1);
  });

  it('draws nothing without addresses, and nothing for a cancelled event', () => {
    expect(page(gala())).not.toContain('Timesheets go to');
    expect(
      page(gala({ status: 'cancelled', timesheetRecipients: ['banqueting@leonardo.test'] })),
    ).not.toContain('Timesheets go to');
  });

  it('dedupes without case and skips blanks', () => {
    expect(recipientsLine([' a@x.test ', 'A@x.test', '', 'b@y.test'])).toEqual([
      'a@x.test',
      'b@y.test',
    ]);
    expect(recipientsLine(undefined)).toEqual([]);
  });
});
