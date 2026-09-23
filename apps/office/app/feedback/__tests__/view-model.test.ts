import { describe, expect, it } from 'vitest';
import {
  clientMetaLine,
  clientStatus,
  eventLine,
  eventOptionLabel,
  hrefFor,
  ilikePattern,
  officeMetaLine,
  pageInfo,
  parseQuery,
  quoted,
  starString,
  starTone,
  ukDay,
  ukDayTime,
  ukNumericDate,
  ukStamp,
  uniqueEvents,
  validateDraft,
  workerSubline,
} from '../view-model';
import type { FeedbackEntry, FeedbackQuery } from '../types';

const ENTRY: FeedbackEntry = {
  id: 'f1',
  author_kind: 'client',
  rating: 2,
  text: 'Did not turn up and we were a person short on the terrace all night.',
  created_at: '2026-09-18T08:12:00Z',
  updated_at: null,
  read_at: null,
  read_by_name: null,
  unread: true,
  counts_toward_rating: false,
  editable: false,
  deletable: false,
  author_id: 'u1',
  author_name: 'Sophie L.',
  staff_id: 's1',
  staff_name: 'Kai N.',
  employee_id: 811,
  staff_removed: false,
  staff_removed_at: null,
  event_id: 'e1',
  event_title: 'Press Night',
  event_date: '2026-09-17',
  venue_name: 'Mandarin Oriental',
  client_id: 'c1',
  client_name: 'Mandarin Oriental',
  role_names: 'Waiting Staff',
};

const QUERY: FeedbackQuery = {
  tab: 'client',
  q: '',
  clientId: '',
  status: 'all',
  authorId: '',
  page: 1,
};

const UUID_A = '1a1a1a1a-0000-4000-8000-000000000001';

describe('stars (§9.10, §9.6 colour bands)', () => {
  it('always draws five glyphs', () => {
    expect(starString(2)).toBe('★★☆☆☆');
    expect(starString(5)).toBe('★★★★★');
    expect(starString(0)).toBe('☆☆☆☆☆');
    expect(starString(9)).toBe('★★★★★');
  });

  it('colours by the §9.6 bands, as the wireframe does', () => {
    expect(starTone(1)).toBe('coral');
    expect(starTone(2)).toBe('coral');
    expect(starTone(3)).toBe('amber');
    expect(starTone(4)).toBe('green');
    expect(starTone(5)).toBe('green');
  });
});

describe('UK dates (§1.8 record stamps)', () => {
  it('prints an event date as the wireframe does', () => {
    expect(ukDay('2026-09-17')).toBe('Thu 17 Sep');
  });

  it('prints the submission in UK time, not UTC — BST in September', () => {
    expect(ukDayTime('2026-09-18T08:12:00Z')).toBe('Fri 18 Sep 09:12');
  });

  it('crosses midnight in UK time where UTC would not', () => {
    expect(ukStamp('2026-09-17T22:50:00Z')).toBe('17 Sep 2026 · 23:50');
    expect(ukStamp('2026-09-17T23:30:00Z')).toBe('18 Sep 2026 · 00:30');
  });

  it('prints the profile feed date numerically', () => {
    expect(ukNumericDate('2026-09-06T10:20:00Z')).toBe('06.09.2026');
  });

  it('says nothing useful rather than "Invalid Date"', () => {
    expect(ukDay('not a date')).toBe('—');
  });
});

describe('row copy', () => {
  it('names the event, the client, the day and — on the client tab — the role', () => {
    expect(eventLine(ENTRY, true)).toBe(
      'Press Night · Mandarin Oriental · Thu 17 Sep · Waiting Staff',
    );
    expect(eventLine(ENTRY, false)).toBe('Press Night · Mandarin Oriental · Thu 17 Sep');
  });

  it('says so when an office entry is not tied to an event', () => {
    expect(
      eventLine(
        { ...ENTRY, author_kind: 'office', event_id: null, event_title: null, event_date: null },
        false,
      ),
    ).toBe('Not tied to an event');
  });

  it('attributes a client entry to the portal user', () => {
    expect(clientMetaLine(ENTRY)).toBe('from Sophie L. (client) · submitted Fri 18 Sep 09:12');
  });

  it('adds §1.7’s note once the worker has been removed', () => {
    expect(
      clientMetaLine({
        ...ENTRY,
        staff_removed: true,
        staff_removed_at: '2026-09-19T10:00:00Z',
        staff_name: 'Deleted account #1042',
      }),
    ).toBe(
      'from Sophie L. (client) · submitted Fri 18 Sep 09:12 · worker GDPR-removed 19 Sep — comment retained verbatim (§1.7)',
    );
  });

  it('marks an edited office entry', () => {
    const office = { ...ENTRY, author_kind: 'office' as const, created_at: '2026-09-13T16:30:00Z' };
    expect(officeMetaLine(office)).toBe('13 Sep 2026 · 17:30');
    expect(officeMetaLine({ ...office, updated_at: '2026-09-19T09:00:00Z' })).toBe(
      '13 Sep 2026 · 17:30 · edited 19 Sep',
    );
  });

  it('quotes a comment and leaves a stars-only entry without one', () => {
    expect(quoted('  Great  ')).toBe('“Great”');
    expect(quoted('   ')).toBeNull();
    expect(quoted(null)).toBeNull();
  });
});

describe('Mark as read and the rating (§9.10)', () => {
  it('an unread client entry says it is not in the rating', () => {
    expect(clientStatus(ENTRY)).toEqual({ tone: 'amber', label: 'Unread — not in rating' });
  });

  it('a read one names who read it and when', () => {
    expect(
      clientStatus({
        ...ENTRY,
        unread: false,
        read_at: '2026-09-07T08:00:00Z',
        read_by_name: 'Gisela M.',
        counts_toward_rating: true,
      }),
    ).toEqual({ tone: 'green', label: 'Read · Gisela M. · 07 Sep' });
  });
});

describe('the URL', () => {
  it('defaults to the client tab, first page, no filters', () => {
    expect(parseQuery({})).toEqual(QUERY);
  });

  it('reads every filter back', () => {
    expect(
      parseQuery({ tab: 'office', q: ' Amara ', author: UUID_A, page: '3', status: 'unread' }),
    ).toEqual({
      tab: 'office',
      q: 'Amara',
      clientId: '',
      status: 'unread',
      authorId: UUID_A,
      page: 3,
    });
  });

  it('ignores what it does not recognise rather than erroring', () => {
    expect(parseQuery({ tab: 'nope', status: 'maybe', client: "x' or 1=1", page: '-4' })).toEqual(
      QUERY,
    );
  });

  it('builds the bare route for the default', () => {
    expect(hrefFor(QUERY)).toBe('/feedback');
  });

  it('starts a new search on page 1', () => {
    expect(hrefFor({ ...QUERY, page: 7 }, { q: 'Kai' })).toBe('/feedback?q=Kai');
  });

  it('keeps the page when only the page changes', () => {
    expect(hrefFor({ ...QUERY, status: 'unread' }, { page: 2 })).toBe(
      '/feedback?status=unread&page=2',
    );
  });

  it('drops the other tab’s filters when the tab changes, but keeps the name search', () => {
    expect(
      hrefFor({ ...QUERY, q: 'Amara', clientId: UUID_A, status: 'read' }, { tab: 'office' }),
    ).toBe('/feedback?tab=office&q=Amara');
  });

  it('escapes the name search’s wildcards', () => {
    expect(ilikePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});

describe('paging', () => {
  it('says what is on screen', () => {
    expect(pageInfo(1, 312, 20)).toEqual({
      page: 1,
      pages: 16,
      from: 1,
      to: 20,
      label: 'Showing 1–20 of 312',
    });
    expect(pageInfo(16, 312, 20).label).toBe('Showing 301–312 of 312');
  });

  it('clamps a page past the end', () => {
    expect(pageInfo(40, 45, 20).page).toBe(3);
  });

  it('handles an empty list', () => {
    expect(pageInfo(1, 0)).toEqual({ page: 1, pages: 1, from: 0, to: 0, label: 'Nothing to show' });
  });
});

describe('the office form', () => {
  const draft = { staffId: 's1', rating: 4, text: 'Great night', eventId: '' };

  it('accepts a worker, stars and a comment, with no event', () => {
    expect(validateDraft(draft)).toBeNull();
  });

  it('asks for each of the three required fields', () => {
    expect(validateDraft({ ...draft, staffId: '' })).toMatch(/worker/);
    expect(validateDraft({ ...draft, rating: 0 })).toMatch(/stars/);
    expect(validateDraft({ ...draft, rating: 6 })).toMatch(/stars/);
    expect(validateDraft({ ...draft, text: '   ' })).toMatch(/comment/);
  });

  it('lists each event once, newest first', () => {
    const events = uniqueEvents([
      { id: 'a', title: 'Reception', date: '2026-09-04', client: 'Mandarin Oriental' },
      { id: 'b', title: 'Press Night', date: '2026-09-17', client: 'Mandarin Oriental' },
      { id: 'a', title: 'Reception', date: '2026-09-04', client: 'Mandarin Oriental' },
    ]);
    expect(events.map((e) => e.id)).toEqual(['b', 'a']);
    expect(eventOptionLabel(events[0]!)).toBe('Press Night · Mandarin Oriental · 17 Sep');
  });

  it('describes a typeahead match as the wireframe does', () => {
    expect(
      workerSubline({ employee_id: 811, role_names: ['Bar Staff'], status: 'compliant' }),
    ).toBe('THC-00811 · Bar Staff');
    expect(
      workerSubline({ employee_id: 602, role_names: ['Waiting Staff'], status: 'blocked' }),
    ).toBe('THC-00602 · Waiting Staff · blocked');
  });
});
