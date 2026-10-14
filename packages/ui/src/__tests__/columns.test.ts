import { describe, expect, it } from 'vitest';

import {
  isDefaultLayout,
  moveColumnTo,
  normaliseColumnPref,
  normaliseColumnPrefs,
  prefOf,
  resolveColumns,
  scaledMinWidth,
  setColumnVisible,
} from '../components/columns';
import type { ColumnDef } from '../components/columns';

/**
 * The column chooser's model (ADR-0139). What is stored is only the order
 * of the movable columns and the hidden ones; everything else comes from
 * the screen's declaration, so a stored choice survives the screen gaining,
 * losing or renaming a column.
 */
const DEFS: readonly ColumnDef[] = [
  { id: 'name', label: 'Venue', required: true },
  { id: 'address', label: 'Address' },
  { id: 'type', label: 'Type', width: 'm' },
  { id: 'radius', label: 'Geofence (m)', width: 's' },
  { id: 'margin', label: 'Avg margin', width: 's', finance: true },
  { id: 'added', label: 'Date added', width: 's', defaultVisible: false },
  { id: 'actions', label: 'Actions', required: true, width: 'm' },
];

const ids = (columns: { id: string; visible: boolean }[]) =>
  columns.map((column) => (column.visible ? column.id : `-${column.id}`));

describe('resolveColumns', () => {
  it('draws the declaration as it stands with no preference', () => {
    expect(ids(resolveColumns(DEFS, null))).toEqual([
      'name',
      'address',
      'type',
      'radius',
      'margin',
      '-added',
      'actions',
    ]);
  });

  it('holds the identifying column first and the actions last, visible, whatever is stored', () => {
    const columns = resolveColumns(DEFS, {
      order: ['actions', 'radius', 'name', 'type', 'address'],
      hidden: ['name', 'actions', 'type'],
    });
    // "margin" and "added" were not stored: each follows its declared
    // predecessor ("radius", then "margin").
    expect(ids(columns)).toEqual([
      'name',
      'radius',
      'margin',
      '-added',
      '-type',
      'address',
      'actions',
    ]);
    expect(columns[0]!.lock).toBe('start');
    expect(columns.at(-1)!.lock).toBe('end');
  });

  it('never offers a finance column to a login without finance (ADR-0061)', () => {
    const columns = resolveColumns(DEFS, { order: ['margin', 'address'], hidden: [] }, false);
    expect(columns.map((column) => column.id)).not.toContain('margin');
  });

  it('puts a column the preference does not know after its declared predecessor', () => {
    // Stored before "radius" existed: it lands after "type", where the screen put it.
    const columns = resolveColumns(DEFS, {
      order: ['type', 'address', 'margin', 'added'],
      hidden: [],
    });
    expect(ids(columns)).toEqual([
      'name',
      'type',
      'radius',
      'address',
      'margin',
      'added',
      'actions',
    ]);
  });

  it('gives an unknown column its own default visibility, and skips a stored id the screen dropped', () => {
    const columns = resolveColumns(DEFS, {
      order: ['gone', 'address', 'type', 'radius', 'margin'],
      hidden: ['gone'],
    });
    expect(ids(columns)).toEqual([
      'name',
      'address',
      'type',
      'radius',
      'margin',
      '-added',
      'actions',
    ]);
  });
});

describe('changing the columns', () => {
  const base = resolveColumns(DEFS, null);

  it('hides and shows a movable column but never a required one', () => {
    expect(ids(setColumnVisible(base, 'type', false))).toContain('-type');
    expect(ids(setColumnVisible(base, 'name', false))).toContain('name');
    expect(ids(setColumnVisible(base, 'added', true))).toContain('added');
  });

  it('moves within the movable columns only', () => {
    expect(ids(moveColumnTo(base, 'radius', 0)).slice(0, 3)).toEqual(['name', 'radius', 'address']);
    // Past the end is clamped: the actions column stays last.
    expect(ids(moveColumnTo(base, 'address', 99)).slice(-2)).toEqual(['address', 'actions']);
    // A held column does not move.
    expect(moveColumnTo(base, 'name', 3)).toBe(base);
  });

  it('stores only the movable order and the hidden ids, and knows the default', () => {
    const moved = moveColumnTo(setColumnVisible(base, 'type', false), 'radius', 0);
    expect(prefOf(moved)).toEqual({
      order: ['radius', 'address', 'type', 'margin', 'added'],
      hidden: ['type', 'added'],
    });
    expect(isDefaultLayout(DEFS, base)).toBe(true);
    expect(isDefaultLayout(DEFS, moved)).toBe(false);
    expect(isDefaultLayout(DEFS, resolveColumns(DEFS, prefOf(base)))).toBe(true);
  });
});

describe('the table minimum width (ADR-0136)', () => {
  it('scales the screen figure by the hints that are left', () => {
    const base = resolveColumns(DEFS, null);
    expect(scaledMinWidth(DEFS, base, '58rem')).toBe('58rem');
    const fewer = setColumnVisible(setColumnVisible(base, 'address', false), 'type', false);
    // 10 + 9 of 10+10+9+6.5+6.5+9 = 51 rem gone: 58 × 32/51.
    expect(scaledMinWidth(DEFS, fewer, '58rem')).toBe('36.5rem');
    expect(scaledMinWidth(DEFS, base, 'auto')).toBe('auto');
  });
});

describe('normalising what was stored', () => {
  it('accepts the shape and drops duplicates', () => {
    expect(normaliseColumnPref({ order: ['a', 'b', 'a'], hidden: ['b'] })).toEqual({
      order: ['a', 'b'],
      hidden: ['b'],
    });
  });

  it('reads anything else as the defaults', () => {
    for (const bad of [
      null,
      'x',
      [],
      { order: 'a' },
      { order: ['Bad Id'] },
      { order: [1] },
      { order: Array.from({ length: 51 }, (_, i) => `c${i}`) },
    ]) {
      expect(normaliseColumnPref(bad)).toBeNull();
    }
  });

  it('keeps only well-named lists', () => {
    expect(
      normaliseColumnPrefs({
        'staff.directory': { order: ['a'], hidden: [] },
        'Bad Key': { order: [], hidden: [] },
        venues: 'nope',
      }),
    ).toEqual({ 'staff.directory': { order: ['a'], hidden: [] } });
  });
});
