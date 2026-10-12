import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@thc/ui';
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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/** The reader's zone as `useViewerZone` reports it once mounted. */
let viewer = 'Europe/London';
vi.mock('@thc/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof Ui>()),
  useViewerZone: () => viewer,
}));
afterEach(() => {
  viewer = 'Europe/London';
});

const { EventScreen } = await import('../events/[id]/EventScreen');
const { FeedbackModal, COMMENT_MAX, isAlreadyLeft } = await import('../events/[id]/FeedbackModal');

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
      '<button type="button" class="btn primary" disabled="" title="THC has not issued this document yet">↓ Download Allocation Timesheet</button>',
    );
    expect(screen(gala(), BEFORE, [ALLOCATION])).toContain(
      `<a class="btn primary" href="/client/events/${EVENT_ID}/document?kind=allocation">↓ Download Allocation Timesheet</a>`,
    );
    // Only the one button before the event — no timesheet yet.
    expect(screen(gala(), BEFORE, [ALLOCATION])).not.toContain('Completed Timesheet');
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
      `<a class="btn" href="/client/events/${EVENT_ID}/document?kind=allocation">↓ Allocation Timesheet</a>`,
    );
    expect(markup).toContain(
      `<a class="btn primary" href="/client/events/${EVENT_ID}/document?kind=signout">↓ Download Completed Timesheet</a>`,
    );
  });

  it('keeps the timesheet disabled until a final copy exists, without losing the allocation sheet', () => {
    const markup = screen(completed, AFTER, [ALLOCATION]);
    expect(markup).toContain('↓ Allocation Timesheet</a>');
    expect(markup).toContain(
      '<button type="button" class="btn primary" disabled="" title="THC has not issued this document yet">↓ Download Completed Timesheet</button>',
    );
    expect(markup).not.toContain('Completed Allocation Timesheet generated');
  });

  it('relabels the count "Staff on the day" and the role pill "worked"', () => {
    const markup = screen(completed, AFTER, [ALLOCATION, SIGNOUT]);
    expect(markup).toContain('<div class="k">Staff on the day</div>');
    expect(markup).not.toContain('Confirmed staff');
    expect(markup).toContain('<span class="pill">2 worked</span>');
    expect(markup).not.toContain('2 confirmed');
  });

  it('stamps when the sign-out timesheet was generated, UK-only and labelled (§1.8), from issued_at', () => {
    const markup = screen(completed, AFTER, [ALLOCATION, SIGNOUT]);
    // 23:12 UTC on the 19th is 00:12 BST on the 20th; the day unpadded, as the list writes it.
    expect(markup).toContain(
      '<div class="k">Timesheet</div><div class="v">Completed Allocation Timesheet generated 20 Sep, 00:12 UK time</div>',
    );
    // Nothing claims who it was emailed to (ADR-0089).
    expect(markup).not.toContain('by email');
    expect(markup).not.toContain('client card</span></div></div><div><div class="k">Your on-site');
  });

  it('marks a row already rated with the disabled "✓ Feedback sent" button and leaves the others live', () => {
    const markup = screen(completed, AFTER);
    expect(markup).toMatch(
      /<button type="button" class="btn sm fb sent" disabled=""[^>]*>✓ Feedback sent<\/button>/,
    );
    expect(markup).toContain('<button type="button" class="btn sm fb">Leave feedback</button>');
    expect(markup).toContain('The event has started — you can now leave feedback');
  });
});

describe('cancelled', () => {
  it('has no download, no line-up and a neutral note', () => {
    const markup = screen(gala({ status: 'cancelled' }), AFTER, [ALLOCATION]);
    expect(markup).not.toContain('/document?kind=');
    expect(markup).not.toContain('Allocation Timesheet');
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

describe('arrival counts on the day (ADR-0053)', () => {
  const arrivals = {
    confirmed: 2,
    arrived: 1,
    bySection: { 's-chef': { confirmed: 2, arrived: 1 } },
  };
  const DURING = '2026-09-19T09:00:00Z';
  const render = (event: PortalEvent, now: string) =>
    renderToStaticMarkup(
      <EventScreen
        event={event}
        sections={sections}
        lineup={lineup}
        photos={{}}
        now={now}
        arrivals={arrivals}
      />,
    );

  it('shows the event total and the per-role count while the event is ongoing', () => {
    const markup = render(gala({ status: 'ongoing' }), DURING);
    // Header pill + the Chef panel's pill.
    expect(markup.match(/1 of 2 arrived/g)).toHaveLength(2);
  });

  it('shows nothing once the event is over, or before it starts, and never who', () => {
    expect(render(gala({ status: 'completed' }), AFTER)).not.toContain('arrived');
    expect(render(gala({ status: 'upcoming' }), BEFORE)).not.toContain('arrived');
  });
});

describe('"✓ Feedback sent" carries what was sent (event.html:251)', () => {
  const rated: LineupRow[] = lineup.map((l) =>
    l.feedbackGiven ? { ...l, feedbackRating: 4, feedbackSentAt: '2026-09-20T09:30:00Z' } : l,
  );
  const render = (rows: LineupRow[]) =>
    renderToStaticMarkup(
      <EventScreen
        event={gala({ status: 'completed' })}
        sections={sections}
        lineup={rows}
        photos={{}}
        now={AFTER}
      />,
    );

  it('writes the stars and the UK day under the role', () => {
    expect(render(rated)).toContain(
      '<div class="s">Chef · <span class="fb-sent">★★★★☆ sent 20 Sep</span></div>',
    );
  });

  it('says nothing more when the view returned neither', () => {
    const markup = render(lineup);
    expect(markup).toContain('✓ Feedback sent');
    expect(markup).not.toContain('fb-sent');
  });
});

describe('a removed worker (§1.7, event.html:276)', () => {
  const removed: LineupRow = {
    ...lineup[0]!,
    bookingId: 'b-3',
    name: 'Deleted account #1042',
    sortKey: 'zzz',
    feedbackGiven: false,
  };
  const markup = renderToStaticMarkup(
    <EventScreen
      event={gala({ status: 'completed' })}
      sections={sections}
      lineup={[...lineup, removed]}
      photos={{}}
      now={AFTER}
    />,
  );
  const row = markup.slice(markup.indexOf('Deleted account #1042') - 200);

  it('keeps the slot with no photo and the name muted', () => {
    expect(row).toContain('<span class="avatar lg deleted" title="Deleted account #1042">');
    expect(row).toContain('<div class="n muted">Deleted account #1042</div>');
  });

  it('cannot be rated, even after the event has started', () => {
    expect(row).toContain(
      '<button type="button" class="btn sm fb" disabled="" title="This account has been removed">Leave feedback</button>',
    );
  });
});

describe('the feedback banner', () => {
  it('gives a reader outside UK time their own clock and day for the unlock', () => {
    viewer = 'America/New_York';
    // 07:00 BST on Sat 19 Sep is 02:00 in New York, read on Fri 18 Sep: "tomorrow".
    expect(screen(gala(), BEFORE)).toContain(
      'from 07:00 UK time on the day (tomorrow 02:00 your time). Until then',
    );
  });

  it('says nothing about "your time" to a reader in a Crown Dependency', () => {
    viewer = 'Europe/Jersey';
    expect(screen(gala(), BEFORE)).not.toContain('your time');
  });

  it('stops inviting once every worker who can be rated has been', () => {
    const allRated = lineup.map((l) => ({ ...l, feedbackGiven: true }));
    const markup = renderToStaticMarkup(
      <EventScreen
        event={gala({ status: 'completed' })}
        sections={sections}
        lineup={allRated}
        photos={{}}
        now={AFTER}
      />,
    );
    expect(markup).not.toContain('you can now leave feedback');
  });

  it('stops inviting a week after the event ended, while the buttons stay live', () => {
    const markup = screen(gala({ status: 'completed' }), '2026-10-05T09:00:00Z');
    expect(markup).not.toContain('you can now leave feedback');
    expect(markup).toContain('<button type="button" class="btn sm fb">Leave feedback</button>');
  });
});

describe('the header (event.html .ehead)', () => {
  it('is a card stamped with when it was read', () => {
    const markup = screen(gala(), BEFORE);
    expect(markup).toContain('<div class="ehead">');
    expect(markup).toContain('as of <b>Fri 18 Sep 2026, 10:00 UK time</b>');
  });

  it('gives a reader abroad their own clock first, the UK one in brackets', () => {
    viewer = 'Europe/Berlin';
    expect(screen(gala(), BEFORE)).toContain(
      'as of <b>Fri 18 Sep 2026, 11:00 your time</b> (10:00 UK)',
    );
  });

  it('greys and strikes a cancelled event, with the day it was cancelled', () => {
    const markup = screen(
      gala({ status: 'cancelled', cancelledAt: '2026-09-16T10:00:00Z' }),
      AFTER,
    );
    expect(markup).toContain('<div class="ehead cancelled">');
    expect(markup).toContain('<h1><s>Gala Dinner</s></h1>');
    expect(markup).toContain('· cancelled 16 Sep');
  });
});

describe('the feedback popup, guarded', () => {
  const markup = renderToStaticMarkup(
    <FeedbackModal
      open
      eventId={EVENT_ID}
      bookingId="b-1"
      personName="Priya Sharma"
      photo="https://example.test/priya.jpg"
      role="Waiting Staff"
      eventTitle="Gala Dinner"
      eventDate="Fri 19 Sep 2026"
      onClose={() => {}}
    />,
  );

  it("shows the worker's face beside the subtitle", () => {
    expect(markup).toMatch(
      /<div class="fb-who"><span class="avatar[^"]*"[^>]*><img[^>]*priya\.jpg/,
    );
  });

  it('caps the comment at 2000 characters', () => {
    expect(COMMENT_MAX).toBe(2000);
    expect(markup).toContain('maxLength="2000"');
    // The counter appears only near the limit.
    expect(markup).not.toContain('fb-count');
  });

  it('draws each star as a radio', () => {
    expect(markup.match(/role="radio"/g)).toHaveLength(5);
  });

  it('recognises the "already left" refusal, by code or by the action\'s sentence', () => {
    expect(isAlreadyLeft({ code: '23505' })).toBe(true);
    expect(
      isAlreadyLeft({ error: 'Feedback has already been left for this person on this event.' }),
    ).toBe(true);
    expect(isAlreadyLeft({ error: 'That could not be saved.' })).toBe(false);
  });
});
