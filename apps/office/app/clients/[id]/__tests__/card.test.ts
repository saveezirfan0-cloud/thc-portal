import { describe, expect, it } from 'vitest';
import { gbp, gbpRound, grantedHow, groupByRole, marginTone, matchesEventFilter } from '../card';
import type { ClientEventRow, QualifiedStaffRow } from '../types';

const worker = (over: Partial<QualifiedStaffRow>): QualifiedStaffRow => ({
  staff_id: 'w1',
  display_name: 'Amara K.',
  employee_id: 873,
  photo_path: null,
  status: 'compliant',
  rating: 4.6,
  reliability: 98,
  role_names: ['Waiting Staff'],
  role_ids: ['r1'],
  qualification_ids: ['q1'],
  do_not_return: false,
  first_granted_at: '2026-09-05T00:00:00Z',
  last_granted_at: '2026-09-05T00:00:00Z',
  granted_how: 'automatic',
  granted_by_name: null,
  granted_from_event_title: 'Gala Dinner',
  granted_from_event_date: '2026-09-05',
  notes: null,
  ...over,
});

const event = (over: Partial<ClientEventRow>): ClientEventRow => ({
  id: 'e1',
  title: 'Gala Dinner',
  po_number: '4471-A',
  event_date: '2026-09-19',
  starts_at: '2026-09-19T06:00:00Z',
  ends_at: '2026-09-19T22:30:00Z',
  venue_name: 'Leonardo Royal Hotel',
  cancelled_at: null,
  status: 'upcoming',
  section_count: 3,
  roles_summary: 'Chef 2 (+0) · Waiting Staff 12 (+2)',
  margin_gbp: 939,
  margin_pct: 32.2,
  ...over,
});

describe('money (§9.7)', () => {
  it('writes pounds and pence', () => {
    expect(gbp(7.28)).toBe('£7.28');
    expect(gbp(1012.5)).toBe('£1,012.50');
  });

  it('shows a dash where there is no figure, never £0.00', () => {
    // A cancelled event has no margin. Printing £0.00 claims it earned
    // nothing, which is a different statement from "this does not apply".
    expect(gbp(null)).toBe('—');
    expect(gbpRound(null)).toBe('—');
  });

  it('rounds the events column to whole pounds', () => {
    expect(gbpRound(938.6)).toBe('£939');
  });
});

describe('margin tone', () => {
  it('separates making money from not', () => {
    expect(marginTone(32.2)).toBe('green');
    expect(marginTone(-4)).toBe('coral');
  });

  it('has no opinion where there is no margin', () => {
    expect(marginTone(null)).toBe('none');
  });
});

describe('the per-role pool counter (§9.7, §3.4)', () => {
  it('counts a worker under every role they hold here', () => {
    const groups = groupByRole([worker({ role_names: ['Waiting Staff', 'Host'] })]);
    expect(groups.map((g) => g.role)).toEqual(['Host', 'Waiting Staff']);
    expect(groups.every((g) => g.count === 1)).toBe(true);
  });

  it('does not count somebody who is barred from the client', () => {
    // The counter is what tells a manager whether Wave 1 can fill the
    // section. Counting people who cannot be sent overstates the pool by
    // exactly the ones auto-assign will refuse.
    const groups = groupByRole([
      worker({ staff_id: 'a' }),
      worker({ staff_id: 'b', do_not_return: true }),
    ]);
    expect(groups[0]?.count).toBe(1);
    expect(groups[0]?.workers).toHaveLength(2);
  });
});

describe('how a qualification was granted (§9.7)', () => {
  it('names the manager on a manual grant', () => {
    expect(grantedHow(worker({ granted_how: 'manual', granted_by_name: 'Gisela M.' }))).toBe(
      'manual by Gisela M.',
    );
  });

  it('names the event on an automatic one', () => {
    expect(grantedHow(worker({}))).toBe('automatically from Gala Dinner');
  });

  it('still says how, where the event has since gone', () => {
    expect(grantedHow(worker({ granted_from_event_title: null }))).toBe(
      'automatically after a clean shift',
    );
  });
});

describe('the events filter (§9.7)', () => {
  it('keeps everything on All', () => {
    expect(matchesEventFilter(event({ status: 'cancelled' }), 'all')).toBe(true);
  });

  it('counts an ongoing event as upcoming — it has not been delivered yet', () => {
    expect(matchesEventFilter(event({ status: 'ongoing' }), 'upcoming')).toBe(true);
    expect(matchesEventFilter(event({ status: 'upcoming' }), 'upcoming')).toBe(true);
    expect(matchesEventFilter(event({ status: 'completed' }), 'upcoming')).toBe(false);
  });

  it('keeps cancelled events reachable rather than hiding them', () => {
    expect(matchesEventFilter(event({ status: 'cancelled' }), 'cancelled')).toBe(true);
  });
});
