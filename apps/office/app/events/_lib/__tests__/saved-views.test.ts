import { describe, expect, it } from 'vitest';
import type { EventFilterSet } from '../filters';
import {
  MAX_SAVED_VIEWS,
  SAVED_VIEWS_KEY,
  type SavedView,
  type ViewStorage,
  activeSavedView,
  describeFilterSet,
  normaliseViewName,
  parseSavedViews,
  readSavedViews,
  removeSavedView,
  serialiseSavedViews,
  upsertSavedView,
  writeSavedViews,
} from '../saved-views';

const ALL: EventFilterSet = { view: 'list', q: '', clientId: '', status: '' };
const CANCELLED: EventFilterSet = { view: 'month', q: '', clientId: 'c-1', status: 'cancelled' };

function memoryStorage(initial: Record<string, string> = {}): ViewStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwing: ViewStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('naming', () => {
  it('trims, collapses whitespace and caps the length', () => {
    expect(normaliseViewName('  Client   A \n cancelled ')).toBe('Client A cancelled');
    expect(normaliseViewName('x'.repeat(80))).toHaveLength(40);
    expect(normaliseViewName('   ')).toBe('');
  });
});

describe('upsert and remove', () => {
  it('appends a new view', () => {
    const list = upsertSavedView([], 'Weddings', CANCELLED);
    expect(list).toEqual([{ name: 'Weddings', filters: CANCELLED }]);
  });

  it('replaces a view of the same name in place, case-insensitively', () => {
    const list = upsertSavedView(
      upsertSavedView(upsertSavedView([], 'Weddings', ALL), 'Other', ALL),
      'weddings',
      CANCELLED,
    );
    expect(list.map((view) => view.name)).toEqual(['weddings', 'Other']);
    expect(list[0]!.filters).toEqual(CANCELLED);
  });

  it('refuses a nameless view by returning the same list', () => {
    const list: SavedView[] = [];
    expect(upsertSavedView(list, '   ', ALL)).toBe(list);
  });

  it('drops the oldest past the cap', () => {
    let list: SavedView[] = [];
    for (let i = 0; i < MAX_SAVED_VIEWS + 2; i += 1) list = upsertSavedView(list, `v${i}`, ALL);
    expect(list).toHaveLength(MAX_SAVED_VIEWS);
    expect(list[0]!.name).toBe('v2');
  });

  it('removes by name, case-insensitively', () => {
    const list = upsertSavedView(upsertSavedView([], 'A', ALL), 'B', ALL);
    expect(removeSavedView(list, ' a ').map((view) => view.name)).toEqual(['B']);
  });
});

describe('which saved view is on screen', () => {
  it('matches on the filter set', () => {
    const list = upsertSavedView(upsertSavedView([], 'All', ALL), 'Cancelled', CANCELLED);
    expect(activeSavedView(list, { ...CANCELLED })?.name).toBe('Cancelled');
    expect(activeSavedView(list, { ...CANCELLED, view: 'week' })).toBeUndefined();
  });
});

describe('describeFilterSet', () => {
  const names = (id: string) => (id === 'c-1' ? 'Savoy Events' : undefined);

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

describe('parsing what is in storage', () => {
  it('round-trips', () => {
    const list = upsertSavedView(upsertSavedView([], 'All', ALL), 'Cancelled', CANCELLED);
    expect(parseSavedViews(serialiseSavedViews(list))).toEqual(list);
  });

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
      { name: 'Stale status', filters: { view: 'day', status: 'draft' } },
      42,
      null,
    ]);
    expect(parseSavedViews(raw)).toEqual([
      { name: 'Good', filters: { view: 'week', q: 'x', clientId: 'c', status: 'ongoing' } },
      { name: 'Stale status', filters: { view: 'day', q: '', clientId: '', status: '' } },
    ]);
  });
});

describe('storage is optional', () => {
  it('reads and writes through a working store under the versioned key', () => {
    const store = memoryStorage();
    const list = upsertSavedView([], 'All', ALL);
    expect(writeSavedViews(store, list)).toBe(true);
    expect(Object.keys(store.data)).toEqual([SAVED_VIEWS_KEY]);
    expect(readSavedViews(store)).toEqual(list);
  });

  it('never throws when storage throws or is missing', () => {
    expect(readSavedViews(throwing)).toEqual([]);
    expect(writeSavedViews(throwing, [])).toBe(false);
    expect(readSavedViews(null)).toEqual([]);
    expect(writeSavedViews(undefined, [])).toBe(false);
  });
});
