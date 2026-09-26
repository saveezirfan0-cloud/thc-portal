import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UK_ZONE, formatDateTimeIn } from '@thc/domain';
import type { LineupRow, PortalEvent, RoleSection } from '../rules';

/**
 * §11.2 against wireframes/client/event.html, state by state: the header's
 * downloads, the completed-state labels, the locked-feedback banner and the
 * feedback popup's copy. Static markup — the browser-only parts (the
 * "your time" line, the star clicks) are covered by event-window.test.tsx,
 * rules.test.ts and e2e/tests/client.portal.spec.ts.
 */
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch: _prefetch,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    prefetch?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../events/[id]/actions', () => ({ leaveFeedback: vi.fn() }));

const { EventScreen } = await import('../events/[id]/EventScreen');
const { FeedbackModal } = await import('../events/[id]/FeedbackModal');

const EVENT_ID = '60000000-0000-4000-8000-000000000001';

const gala = (over: Partial<PortalEvent> = {}): PortalEvent => ({
  id: EVENT_ID,
  title: 'Gala Dinner',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St, EC4V 5AJ',
  eventDate: '2026-09-19',
  poNumber: '4471-A',
  onsiteContact: 'Marco Vitale · Banqueting manager',
  startsAt: '2026-09-19T06:00:00Z', // 07:00 BST
  endsAt: '2026-09-19T22:30:00Z', // 23:30 BST
  status: 'upcoming',
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
    confirmed: 2,
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
    photoPath: null,
    sortKey: 'bello',
    feedbackGiven: false,
  },
  {
    bookingId: 'b-2',
    eventId: EVENT_ID,
    shiftId: 's-chef',
    role: 'Chef',
    startsAt: '2026-09-19T06:00:00Z',
    endsAt: '2026-09-19T14:00:00Z',
    name: 'Luca Moretti',
    photoPath: null,
    sortKey: 'moretti',
    feedbackGiven: true,
  },
];

const BEFORE = '2026-09-18T09:00:00Z';
const AFTER = '2026-09-21T09:00:00Z';

function screen(
  event: PortalEvent,
  now: string,
  documents = [] as { kind: 'allocation' | 'signout'; issuedAt: string }[],
) {
  return renderToStaticMarkup(
    <EventScreen
      event={event}
      sections={sections}
      lineup={lineup}
      photos={{}}
      now={now}
      documents={documents}
    />,
  );
}

const ALLOCATION = { kind: 'allocation' as const, issuedAt: '2026-09-17T15:30:00Z' };
const SIGNOUT = { kind: 'signout' as const, issuedAt: '2026-09-19T23:12:00Z' }; // 00:12 BST next day

describe('before the event (event.html:81-89)', () => {
  it('offers the allocation sheet in the header: a link once issued, disabled until then', () => {
    expect(screen(gala(), BEFORE)).toContain(
      '<button type="button" class="btn primary" disabled="" title="THC has not issued this document yet">↓ Download Allocation Sheet</button>',
    );
    expect(screen(gala(), BEFORE, [ALLOCATION])).toContain(
      `<a class="btn primary" href="/client/events/${EVENT_ID}/document?kind=allocation">↓ Download Allocation Sheet</a>`,
    );
    // Only the one button before the event — no timesheet yet.
    expect(screen(gala(), BEFORE, [ALLOCATION])).not.toContain('Signed Timesheet');
  });

  it('says when feedback opens, in UK time, and keeps the buttons disabled', () => {
    const markup = screen(gala(), BEFORE);
    expect(markup).toContain(
      'Feedback opens once the event has started — from 07:00 UK time on the day. Until then the “Leave feedback” buttons are disabled.',
    );
    expect(markup).toContain(
      'disabled="" title="Feedback opens once the event has started">Leave feedback</button>',
    );
    expect(markup).toContain('Confirmed staff');
    expect(markup).toContain('<span class="pill green">2 confirmed</span>');
  });
});

describe('completed (event.html:247-273)', () => {
  const completed = gala({ status: 'completed' });

  it('draws both downloads: the allocation sheet as history, the signed timesheet as primary', () => {
    const markup = screen(completed, AFTER, [ALLOCATION, SIGNOUT]);
    expect(markup).toContain(
      `<a class="btn" href="/client/events/${EVENT_ID}/document?kind=allocation">↓ Allocation Sheet</a>`,
    );
    expect(markup).toContain(
      `<a class="btn primary" href="/client/events/${EVENT_ID}/document?kind=signout">↓ Download Signed Timesheet</a>`,
    );
  });

  it('keeps the timesheet disabled until a final copy exists, without losing the allocation sheet', () => {
    const markup = screen(completed, AFTER, [ALLOCATION]);
    expect(markup).toContain('↓ Allocation Sheet</a>');
    expect(markup).toContain(
      '<button type="button" class="btn primary" disabled="" title="THC has not issued this document yet">↓ Download Signed Timesheet</button>',
    );
    expect(markup).not.toContain('Sign-out timesheet generated');
  });

  it('relabels the count "Staff on the day" and the role pill "worked"', () => {
    const markup = screen(completed, AFTER, [ALLOCATION, SIGNOUT]);
    expect(markup).toContain('<div class="k">Staff on the day</div>');
    expect(markup).not.toContain('Confirmed staff');
    expect(markup).toContain('<span class="pill">2 worked</span>');
    expect(markup).not.toContain('2 confirmed');
  });

  it('stamps when the sign-out timesheet was generated, UK-only (§1.8), from issued_at', () => {
    const markup = screen(completed, AFTER, [ALLOCATION, SIGNOUT]);
    const stamp = formatDateTimeIn(new Date(SIGNOUT.issuedAt), UK_ZONE);
    expect(stamp).toMatch(/^20 Sept?, 00:12$/);
    expect(markup).toContain(
      `<div class="k">Timesheet</div><div class="v">Sign-out timesheet generated ${stamp}`,
    );
    expect(markup).toContain('by email to the contacts on your client card');
  });

  it('marks a row already rated "✓ Feedback sent" and leaves the others live', () => {
    const markup = screen(completed, AFTER);
    expect(markup).toContain('✓ Feedback sent');
    expect(markup).toContain('<button type="button" class="btn sm fb">Leave feedback</button>');
    expect(markup).toContain('The event has started — you can now leave feedback');
  });
});

describe('cancelled', () => {
  it('has no download, no line-up and a neutral note', () => {
    const markup = screen(gala({ status: 'cancelled' }), AFTER, [ALLOCATION]);
    expect(markup).not.toContain('/document?kind=');
    expect(markup).not.toContain('Allocation Sheet');
    expect(markup).not.toContain('Leave feedback');
    expect(markup).toContain('This event was cancelled');
  });
});

describe('the feedback popup (event.html:223-229)', () => {
  const markup = renderToStaticMarkup(
    <FeedbackModal
      open
      eventId={EVENT_ID}
      bookingId="b-1"
      personName="Priya Sharma"
      role="Waiting Staff"
      eventTitle="Gala Dinner"
      eventDate="Fri 19 Sep 2026"
      onClose={() => {}}
    />,
  );

  it('is titled with the person and subtitled role · event · date', () => {
    expect(markup).toContain('aria-label="Feedback · Priya Sharma"');
    expect(markup).toContain('<h3>Feedback · Priya Sharma</h3>');
    expect(markup).toContain('Waiting Staff · Gala Dinner · Fri 19 Sep 2026');
  });

  it('asks for a star, explains who reads the comment, and says it cannot be withdrawn', () => {
    expect(markup).toContain('<span class="hint">Tap a star — 1 to 5, required</span>');
    expect(markup).toContain(
      'Optional · free text · seen by The Hospitality Company office, not by the worker.',
    );
    expect(markup).toContain('placeholder="What went well, what could be better?"');
    expect(markup).toContain(
      'Once submitted, feedback cannot be edited or withdrawn from the portal. If something needs correcting, contact the office.',
    );
  });

  it('submits with "Submit feedback" beside Cancel', () => {
    expect(markup).toContain('>Cancel</button>');
    expect(markup).toContain('>Submit feedback</button>');
    expect(markup).not.toContain('Send feedback');
  });
});
