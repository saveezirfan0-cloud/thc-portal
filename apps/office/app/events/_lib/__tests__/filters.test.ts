import { describe, expect, it } from 'vitest';
import {
  applyFilterSet,
  eventsHref,
  filterSetOf,
  isIsoDate,
  parseEventQuery,
  sameFilterSet,
} from '../filters';

const TODAY = '2026-09-25';

describe('parseEventQuery — the URL is the state (§3.1)', () => {
  it('defaults to List at today with no filters', () => {
    expect(parseEventQuery({}, TODAY)).toEqual({
      view: 'list',
      date: TODAY,
      q: '',
      clientId: '',
      status: '',
    });
  });

  it('reads every parameter', () => {
    expect(
      parseEventQuery(
        { view: 'week', date: '2026-10-02', q: ' gala ', client: 'c-1', status: 'cancelled' },
        TODAY,
      ),
    ).toEqual({
      view: 'week',
      date: '2026-10-02',
      q: 'gala',
      clientId: 'c-1',
      status: 'cancelled',
    });
  });

  it('takes the first of a repeated parameter', () => {
    expect(parseEventQuery({ view: ['day', 'month'] }, TODAY).view).toBe('day');
  });

  it('falls back rather than failing on a stale or mistyped link', () => {
    const query = parseEventQuery({ view: 'year', date: '2026-02-30', status: 'draft' }, TODAY);
    expect(query.view).toBe('list');
    expect(query.date).toBe(TODAY);
    expect(query.status).toBe('');
  });
});

describe('isIsoDate', () => {
  it('accepts real dates only', () => {
    expect(isIsoDate('2026-09-25')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('25/09/2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});

describe('eventsHref', () => {
  it('always writes view and date, and leaves empty filters out', () => {
    expect(eventsHref({ view: 'month', date: TODAY })).toBe('/events?view=month&date=2026-09-25');
  });

  it('round-trips through parseEventQuery', () => {
    const query = {
      view: 'day' as const,
      date: '2026-10-01',
      q: 'Savoy & co',
      clientId: 'c-9',
      status: 'upcoming',
    };
    const href = eventsHref(query);
    expect(href).toBe('/events?view=day&date=2026-10-01&q=Savoy+%26+co&client=c-9&status=upcoming');
    const params = Object.fromEntries(new URL(href, 'https://x.test').searchParams);
    expect(parseEventQuery(params, TODAY)).toEqual(query);
  });
});

describe('filter sets — what a saved view keeps', () => {
  const query = parseEventQuery(
    { view: 'week', date: '2026-10-02', q: 'gala', client: 'c-1', status: 'upcoming' },
    TODAY,
  );

  it('keeps the filters and the view, not the date', () => {
    expect(filterSetOf(query)).toEqual({
      view: 'week',
      q: 'gala',
      clientId: 'c-1',
      status: 'upcoming',
    });
  });

  it('applies to the period on screen, whatever period it was saved on', () => {
    const onScreen = parseEventQuery({ view: 'list', date: '2026-12-01' }, TODAY);
    expect(applyFilterSet(onScreen, filterSetOf(query))).toEqual({
      ...filterSetOf(query),
      date: '2026-12-01',
    });
  });

  it('compares search case- and whitespace-insensitively', () => {
    expect(sameFilterSet(filterSetOf(query), { ...filterSetOf(query), q: ' GALA ' })).toBe(true);
    expect(sameFilterSet(filterSetOf(query), { ...filterSetOf(query), view: 'month' })).toBe(false);
  });
});
