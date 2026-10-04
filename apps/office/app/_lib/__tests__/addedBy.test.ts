import { describe, expect, it } from 'vitest';
import {
  ADDED_BY_ANYONE,
  ADDED_BY_NOBODY,
  NO_ADDED_FILTER,
  addedByOptions,
  addedFilterActive,
  formatDateAdded,
  matchesAdded,
  ukDateKey,
} from '../addedBy';
import type { Added } from '../addedBy';

const row = (over: Partial<Added> = {}): Added => ({
  created_at: '2026-10-04T12:00:00Z',
  created_by: 'u1',
  created_by_name: 'Gisela M.',
  ...over,
});

describe('the Date added stamp is UK time (§1.8)', () => {
  it('puts 23:30 UTC in BST on the next UK day', () => {
    // 4 Oct 2026 23:30 UTC is 5 Oct 00:30 BST.
    expect(ukDateKey('2026-10-04T23:30:00Z')).toBe('2026-10-05');
    expect(formatDateAdded('2026-10-04T23:30:00Z')).toBe('5 Oct 2026');
  });

  it('keeps 23:30 UTC on the same day in winter, when UK is UTC', () => {
    expect(ukDateKey('2026-12-04T23:30:00Z')).toBe('2026-12-04');
  });

  it('spells September "Sep", not ICU\'s "Sept"', () => {
    expect(formatDateAdded('2026-09-18T10:00:00Z')).toBe('18 Sep 2026');
  });
});

describe('addedByOptions', () => {
  it('lists each manager once, by name, and notes rows with nobody recorded', () => {
    const { managers, hasNobody } = addedByOptions([
      row({ created_by: 'u2', created_by_name: 'Zoe K.' }),
      row(),
      row(),
      row({ created_by: null, created_by_name: null }),
    ]);
    expect(managers).toEqual([
      { value: 'u1', label: 'Gisela M.' },
      { value: 'u2', label: 'Zoe K.' },
    ]);
    expect(hasNobody).toBe(true);
  });

  it('offers no "nobody" choice when every row has an author', () => {
    expect(addedByOptions([row()]).hasNobody).toBe(false);
  });

  it('treats an author whose name cannot be read as nobody, not as a blank option', () => {
    const { managers, hasNobody } = addedByOptions([row({ created_by_name: null })]);
    expect(managers).toEqual([]);
    expect(hasNobody).toBe(true);
  });
});

describe('matchesAdded', () => {
  it('passes everything with no filter', () => {
    expect(matchesAdded(row(), NO_ADDED_FILTER)).toBe(true);
    expect(matchesAdded(row({ created_by: null, created_by_name: null }), NO_ADDED_FILTER)).toBe(
      true,
    );
  });

  it('filters by the manager who added it', () => {
    expect(matchesAdded(row(), { ...NO_ADDED_FILTER, by: 'u1' })).toBe(true);
    expect(matchesAdded(row(), { ...NO_ADDED_FILTER, by: 'u2' })).toBe(false);
  });

  it('"nobody" finds only rows with no recorded author', () => {
    const filter = { ...NO_ADDED_FILTER, by: ADDED_BY_NOBODY };
    expect(matchesAdded(row(), filter)).toBe(false);
    expect(matchesAdded(row({ created_by: null, created_by_name: null }), filter)).toBe(true);
  });

  it('the date range is inclusive at both ends, in UK days', () => {
    const r = row({ created_at: '2026-10-04T23:30:00Z' }); // 5 Oct in the UK
    expect(matchesAdded(r, { by: ADDED_BY_ANYONE, from: '2026-10-05', to: '2026-10-05' })).toBe(
      true,
    );
    expect(matchesAdded(r, { by: ADDED_BY_ANYONE, from: '2026-10-06', to: '' })).toBe(false);
    expect(matchesAdded(r, { by: ADDED_BY_ANYONE, from: '', to: '2026-10-04' })).toBe(false);
  });

  it('combines the two filters', () => {
    const filter = { by: 'u1', from: '2026-10-01', to: '2026-10-31' };
    expect(matchesAdded(row(), filter)).toBe(true);
    expect(matchesAdded(row({ created_at: '2026-09-30T12:00:00Z' }), filter)).toBe(false);
    expect(matchesAdded(row({ created_by: 'u2' }), filter)).toBe(false);
  });
});

describe('addedFilterActive', () => {
  it('is false for the empty filter and true once any part is set', () => {
    expect(addedFilterActive(NO_ADDED_FILTER)).toBe(false);
    expect(addedFilterActive({ ...NO_ADDED_FILTER, by: 'u1' })).toBe(true);
    expect(addedFilterActive({ ...NO_ADDED_FILTER, from: '2026-10-01' })).toBe(true);
    expect(addedFilterActive({ ...NO_ADDED_FILTER, to: '2026-10-01' })).toBe(true);
  });
});
