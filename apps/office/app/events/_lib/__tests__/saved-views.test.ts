import { describe, expect, it } from 'vitest';
import type { EventFilterSet } from '../filters';
import {
  MAX_FILTER_TEXT,
  MAX_SAVED_VIEWS,
  MAX_VIEW_NAME,
  SAVED_VIEWS_KEY,
  type SavedView,
  type ViewStorage,
  activeSavedView,
  clearSavedViews,
  describeFilterSet,
  explainSavedViewError,
  findSavedView,
  isPermissionRefusal,
  normaliseViewName,
  parseSavedViews,
  readSavedViews,
  savedViewQuery,
  savedViewsFromRows,
  viewsToMove,
} from '../saved-views';

const CLIENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALL: EventFilterSet = { view: 'list', q: '', clientId: '', status: '' };
const CANCELLED: EventFilterSet = { view: 'month', q: '', clientId: CLIENT, status: 'cancelled' };

function memoryStorage(initial: Record<string, string> = {}): ViewStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const throwing: ViewStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

const view = (name: string, filters: EventFilterSet = ALL, id?: string): SavedView => ({
  ...(id ? { id } : {}),
  name,
  filters,
});

describe('naming', () => {
  it('trims, collapses whitespace and caps the length at the database limit', () => {
    expect(normaliseViewName('  Client   A \n cancelled ')).toBe('Client A cancelled');
    expect(normaliseViewName('x'.repeat(80))).toHaveLength(MAX_VIEW_NAME);
    expect(MAX_VIEW_NAME).toBe(60);
    expect(normaliseViewName('   ')).toBe('');
  });

  it('finds a view by name, case-insensitively', () => {
    const list = [view('Weddings'), view('Other')];
    expect(findSavedView(list, ' weddings ')?.name).toBe('Weddings');
    expect(findSavedView(list, 'Nope')).toBeUndefined();
  });
});

describe('which saved view is on screen', () => {
  it('matches on the filter set', () => {
    const list = [view('All'), view('Cancelled', CANCELLED)];
    expect(activeSavedView(list, { ...CANCELLED })?.name).toBe('Cancelled');
    expect(activeSavedView(list, { ...CANCELLED, view: 'week' })).toBeUndefined();
  });
});

describe('describeFilterSet', () => {
  const names = (id: string) => (id === CLIENT ? 'Savoy Events' : undefined);

  it('names the client, status, search and view', () => {
    expect(describeFilterSet({ ...CANCELLED, q: 'gala' }, names)).toBe(
      'Savoy Events · Cancelled · “gala” · Month',
    );
  });

  it('reads "All events" with no filters', () => {
    expect(describeFilterSet(ALL)).toBe('All events · List');
  });

  it('never shows a raw id for a client it cannot resolve', () => {
    expect(describeFilterSet({ ...ALL, clientId: 'gone' }, names)).toBe('Unknown client · List');
  });
});

describe('savedViewQuery — the same rules as office_saved_view_query_ok', () => {
  it('keeps exactly the four filter keys, trimmed', () => {
    const smuggled = {
      ...CANCELLED,
      q: ' gala ',
      redirect: 'https://evil.example',
    } as EventFilterSet;
    const result = savedViewQuery(smuggled);
    expect(result).toEqual({
      ok: true,
      query: { view: 'month', q: 'gala', clientId: CLIENT, status: 'cancelled' },
    });
    if (result.ok)
      expect(Object.keys(result.query).sort()).toEqual(['clientId', 'q', 'status', 'view']);
  });

  it('refuses a search over the limit, a control character, a non-UUID client and unknown values', () => {
    expect(savedViewQuery({ ...ALL, q: 'x'.repeat(MAX_FILTER_TEXT) }).ok).toBe(true);
    expect(savedViewQuery({ ...ALL, q: 'x'.repeat(MAX_FILTER_TEXT + 1) })).toEqual({
      ok: false,
      message: 'Shorten the search to 100 characters to save it.',
    });
    expect(savedViewQuery({ ...ALL, q: 'a\u0000b' }).ok).toBe(false);
    expect(savedViewQuery({ ...ALL, clientId: 'javascript:alert(1)' }).ok).toBe(false);
    expect(savedViewQuery({ ...ALL, status: 'draft' }).ok).toBe(false);
    expect(savedViewQuery({ ...ALL, view: 'year' as EventFilterSet['view'] }).ok).toBe(false);
  });
});

describe('rows from the table', () => {
  it('become views with their ids; bad rows and duplicate names are dropped', () => {
    expect(
      savedViewsFromRows([
        {
          id: 'r1',
          name: 'Weddings',
          query: { view: 'week', q: 'x', clientId: '', status: 'ongoing' },
        },
        { id: 'r2', name: 'weddings', query: { view: 'list' } },
        { id: 'r3', name: 'Broken', query: 'not an object' },
        { id: 'r4', name: 'Stale', query: { view: 'day', status: 'draft' } },
      ]),
    ).toEqual([
      {
        id: 'r1',
        name: 'Weddings',
        filters: { view: 'week', q: 'x', clientId: '', status: 'ongoing' },
      },
      { id: 'r4', name: 'Stale', filters: { view: 'day', q: '', clientId: '', status: '' } },
    ]);
    expect(savedViewsFromRows(null)).toEqual([]);
  });
});

describe('viewsToMove — this browser → the account', () => {
  it('moves the valid ones and skips names already saved', () => {
    const { views, skipped } = viewsToMove(
      [view('Weddings', CANCELLED), view('Mine'), view('Bad', { ...ALL, clientId: 'c-1' })],
      [view('mine', ALL, 'r1')],
    );
    expect(views).toEqual([
      { name: 'Weddings', query: { view: 'month', q: '', clientId: CLIENT, status: 'cancelled' } },
    ]);
    expect(skipped).toBe(2);
  });

  it('stops at the cap', () => {
    const remote = Array.from({ length: MAX_SAVED_VIEWS - 1 }, (_, i) =>
      view(`r${i}`, ALL, `id${i}`),
    );
    const { views, skipped } = viewsToMove([view('One'), view('Two')], remote);
    expect(views.map((v) => v.name)).toEqual(['One']);
    expect(skipped).toBe(1);
  });
});

describe('explaining a refusal', () => {
  it('turns the database reasons into sentences', () => {
    expect(explainSavedViewError({ code: '23514', message: 'saved_views_cap' })).toBe(
      'You already have 30 saved views. Delete one to save another.',
    );
    expect(explainSavedViewError({ code: '23505', message: 'duplicate key' })).toMatch(
      /already exists/,
    );
    expect(
      explainSavedViewError({ code: '23514', message: 'office_saved_views_query_shape' }),
    ).toMatch(/not valid/);
    expect(explainSavedViewError({ code: '42501', message: 'row-level security' })).toBe(
      'This login is not allowed to change saved views.',
    );
    expect(explainSavedViewError(null)).toMatch(/could not be reached/);
  });

  it('treats only a permission refusal as read-only', () => {
    expect(isPermissionRefusal({ code: '42501' })).toBe(true);
    expect(isPermissionRefusal({ code: '23505' })).toBe(false);
    expect(isPermissionRefusal(null)).toBe(false);
  });
});

describe('the old per-browser store', () => {
  it('survives nothing, junk and foreign shapes', () => {
    expect(parseSavedViews(null)).toEqual([]);
    expect(parseSavedViews('{not json')).toEqual([]);
    expect(parseSavedViews('{"name":"x"}')).toEqual([]);
  });

  it('drops bad entries, unknown views and duplicate names; clears an unknown status', () => {
    const raw = JSON.stringify([
      { name: 'Good', filters: { view: 'week', q: ' x ', clientId: 'c', status: 'ongoing' } },
      { name: 'good', filters: { view: 'list' } },
      { name: 'Bad view', filters: { view: 'year' } },
      { name: '', filters: { view: 'list' } },
      { id: 'forged', name: 'Stale status', filters: { view: 'day', status: 'draft' } },
      42,
      null,
    ]);
    expect(parseSavedViews(raw)).toEqual([
      { name: 'Good', filters: { view: 'week', q: 'x', clientId: 'c', status: 'ongoing' } },
      { name: 'Stale status', filters: { view: 'day', q: '', clientId: '', status: '' } },
    ]);
  });

  it('reads under the versioned key and clears it after the move', () => {
    const store = memoryStorage({
      [SAVED_VIEWS_KEY]: JSON.stringify([{ name: 'All', filters: ALL }]),
      other: 'kept',
    });
    expect(readSavedViews(store)).toEqual([{ name: 'All', filters: ALL }]);
    expect(clearSavedViews(store)).toBe(true);
    expect(store.data).toEqual({ other: 'kept' });
    expect(readSavedViews(store)).toEqual([]);
  });

  it('never throws when storage throws or is missing', () => {
    expect(readSavedViews(throwing)).toEqual([]);
    expect(clearSavedViews(throwing)).toBe(false);
    expect(readSavedViews(null)).toEqual([]);
    expect(clearSavedViews(undefined)).toBe(false);
  });
});
