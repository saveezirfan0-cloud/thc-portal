/**
 * The column chooser's model (ADR-0139) — pure, no React, so the Back
 * Office's server action and the database's own checks can share the same
 * shape and limits.
 *
 * A screen declares its columns once, in their default order. What a
 * person changes is stored as a `ColumnPref` per list: the order of the
 * movable columns and which are hidden. Nothing else — never the labels or
 * the widths — so a column renamed in code keeps its place, a new column
 * appears where the screen put it, and a removed one is simply skipped.
 */

/** A column width hint, the classes `TableScroll`'s fixed layout reads (ADR-0136). */
export type ColumnWidth = 'xs' | 's' | 'm' | 'l' | 'xl';

export interface ColumnDef<Id extends string = string> {
  /** Stable key, stored in the preference: lower case, digits, "-" or "_". */
  id: Id;
  /** The column's name in the chooser (and the header, unless the screen draws its own). */
  label: string;
  /**
   * The identifying first column (Name / Event / Client) or the row's
   * actions: always shown, and never moved out of first / last place. A
   * required column before every optional one stays first; one after them
   * stays last.
   */
  required?: boolean;
  /** Shown until the person hides it. Defaults to true. */
  defaultVisible?: boolean;
  /** The width hint (`.col-xs` … `.col-xl`); also how much of the table's minimum it is. */
  width?: ColumnWidth;
  /**
   * How much of the table's minimum width the column takes, in rem, when a
   * screen sizes it with a class of its own (`.col-phone`, `.ev-c-date`).
   * Defaults to the hint's width, or 10rem with no hint.
   */
  rem?: number;
  /**
   * Money (ADR-0061): never offered, never drawn, for a login without the
   * finance permission. The chooser does not even name it.
   */
  finance?: boolean;
  /** Extra classes on the header cell (`num`, `money`, `cell-actions`, a screen's own). */
  className?: string;
  /** The header cell is drawn empty and named by `aria-label` (an actions column). */
  blankHeader?: boolean;
}

/** One list's choice: the movable columns in order, and the hidden ones. */
export interface ColumnPref {
  order: string[];
  hidden: string[];
}

/** Every list's choice, keyed by list ("staff.directory", "compliance.radar"). */
export type ColumnPrefs = Record<string, ColumnPref>;

/** What the database and the server action accept (20261014193000). */
export const LIST_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
export const COLUMN_ID_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;
export const MAX_COLUMNS_PER_LIST = 50;

/** The widths in `.col-xs` … `.col-xl` (components.css), in rem. */
const WIDTH_REM: Readonly<Record<ColumnWidth, number>> = {
  xs: 4.5,
  s: 6.5,
  m: 9,
  l: 12,
  xl: 16,
};
const UNHINTED_REM = 10;

/** The `.col-*` class for a column's hint, or undefined. */
export function widthClass(def: Pick<ColumnDef, 'width'>): string | undefined {
  return def.width ? `col-${def.width}` : undefined;
}

/** How much of the table's minimum width a column takes, in rem. */
export function columnRem(def: Pick<ColumnDef, 'width' | 'rem'>): number {
  return def.rem ?? (def.width ? WIDTH_REM[def.width] : UNHINTED_REM);
}

/**
 * A stored preference made safe: an object with `order` and `hidden`,
 * string ids of the right shape, no duplicates, at most 50 of each.
 * Anything else — a hand-edited row, an older shape — reads as null
 * (the defaults), never as an error on screen.
 */
export function normaliseColumnPref(value: unknown): ColumnPref | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const ids = (list: unknown): string[] | null => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) return null;
    const out: string[] = [];
    for (const id of list) {
      if (typeof id !== 'string' || !COLUMN_ID_PATTERN.test(id)) return null;
      if (!out.includes(id)) out.push(id);
    }
    return out.length > MAX_COLUMNS_PER_LIST ? null : out;
  };
  const order = ids(record['order']);
  const hidden = ids(record['hidden']);
  if (!order || !hidden) return null;
  return { order, hidden };
}

/** Every list's preference, made safe; a malformed entry is dropped. */
export function normaliseColumnPrefs(value: unknown): ColumnPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: ColumnPrefs = {};
  for (const [key, pref] of Object.entries(value as Record<string, unknown>)) {
    if (!LIST_KEY_PATTERN.test(key)) continue;
    const clean = normaliseColumnPref(pref);
    if (clean) out[key] = clean;
  }
  return out;
}

export interface ResolvedColumn<Id extends string = string> extends ColumnDef<Id> {
  visible: boolean;
  /** Where a required column is held: first, or last. */
  lock?: 'start' | 'end';
}

/** The columns a login may be offered at all (ADR-0061). */
export function offeredColumns<Id extends string>(
  defs: readonly ColumnDef<Id>[],
  finance: boolean,
): ColumnDef<Id>[] {
  return defs.filter((def) => finance || !def.finance);
}

/**
 * Splits the declared columns into the ones held first, the movable middle
 * and the ones held last. A required column in the middle cannot be hidden
 * but may be moved.
 */
function partition<Id extends string>(defs: readonly ColumnDef<Id>[]) {
  let first = 0;
  while (first < defs.length && defs[first]!.required) first += 1;
  let last = defs.length;
  while (last > first && defs[last - 1]!.required) last -= 1;
  return {
    start: defs.slice(0, first),
    middle: defs.slice(first, last),
    end: defs.slice(last),
  };
}

/**
 * The columns in the order to draw them, each marked visible or not.
 *
 * - Held columns stay at their end, always visible.
 * - The middle follows the stored order; a column the preference does not
 *   know (added to the screen since) goes in after its declared
 *   predecessor and takes its own `defaultVisible`.
 * - A stored id the screen no longer declares, or a finance column for a
 *   login without finance, is skipped.
 */
export function resolveColumns<Id extends string>(
  defs: readonly ColumnDef<Id>[],
  pref: ColumnPref | null | undefined,
  finance = true,
): ResolvedColumn<Id>[] {
  const offered = offeredColumns(defs, finance);
  const { start, middle, end } = partition(offered);
  const byId = new Map(middle.map((def) => [def.id as string, def]));

  let order: ColumnDef<Id>[];
  if (pref) {
    order = [];
    for (const id of pref.order) {
      const def = byId.get(id);
      if (def && !order.includes(def)) order.push(def);
    }
    middle.forEach((def, index) => {
      if (order.includes(def)) return;
      // After the nearest declared predecessor that is already placed.
      let at = 0;
      for (let back = index - 1; back >= 0; back -= 1) {
        const placed = order.indexOf(middle[back]!);
        if (placed !== -1) {
          at = placed + 1;
          break;
        }
      }
      order.splice(at, 0, def);
    });
  } else {
    order = [...middle];
  }

  const known = new Set(pref?.order ?? []);
  const hidden = new Set(pref?.hidden ?? []);
  const visibleOf = (def: ColumnDef<Id>) => {
    if (def.required) return true;
    if (pref && (known.has(def.id) || hidden.has(def.id))) return !hidden.has(def.id);
    return def.defaultVisible !== false;
  };

  return [
    ...start.map((def) => ({ ...def, visible: true, lock: 'start' as const })),
    ...order.map((def) => ({ ...def, visible: visibleOf(def) })),
    ...end.map((def) => ({ ...def, visible: true, lock: 'end' as const })),
  ];
}

/** The preference that draws `columns` (held columns are not stored). */
export function prefOf(columns: readonly ResolvedColumn[]): ColumnPref {
  const movable = columns.filter((column) => !column.lock);
  return {
    order: movable.map((column) => column.id),
    hidden: movable.filter((column) => !column.visible).map((column) => column.id),
  };
}

/** True when `columns` are exactly what the screen declares by default. */
export function isDefaultLayout<Id extends string>(
  defs: readonly ColumnDef<Id>[],
  columns: readonly ResolvedColumn<Id>[],
  finance = true,
): boolean {
  const base = resolveColumns(defs, null, finance);
  return (
    base.length === columns.length &&
    base.every(
      (column, index) =>
        column.id === columns[index]!.id && column.visible === columns[index]!.visible,
    )
  );
}

/** Shows or hides one movable column. A held column is left as it is. */
export function setColumnVisible<Id extends string>(
  columns: readonly ResolvedColumn<Id>[],
  id: Id,
  visible: boolean,
): ResolvedColumn<Id>[] {
  return columns.map((column) =>
    column.id === id && !column.required ? { ...column, visible } : column,
  );
}

/**
 * Moves a movable column to `index` among the movable ones (clamped), so a
 * held column can never be passed. Returns the same array when nothing moves.
 */
export function moveColumnTo<Id extends string>(
  columns: readonly ResolvedColumn<Id>[],
  id: Id,
  index: number,
): ResolvedColumn<Id>[] {
  const start = columns.filter((column) => column.lock === 'start');
  const end = columns.filter((column) => column.lock === 'end');
  const movable = columns.filter((column) => !column.lock);
  const from = movable.findIndex((column) => column.id === id);
  if (from === -1) return columns as ResolvedColumn<Id>[];
  const to = Math.max(0, Math.min(movable.length - 1, index));
  if (to === from) return columns as ResolvedColumn<Id>[];
  const next = [...movable];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return [...start, ...next, ...end];
}

/** The movable columns' positions: where `id` is (0-based) and how many there are. */
export function movablePosition(
  columns: readonly ResolvedColumn[],
  id: string,
): { index: number; count: number } {
  const movable = columns.filter((column) => !column.lock);
  return { index: movable.findIndex((column) => column.id === id), count: movable.length };
}

/**
 * The table's minimum width for the columns now shown: the screen's figure
 * for its default set, scaled by what is left (ADR-0136's `--tbl-min`). A
 * table with columns hidden can then stop scrolling sideways; with more
 * shown than by default it asks for more. `extraRem` is what is not a
 * chooser column — a lead cell with a tick box or an avatar.
 */
export function scaledMinWidth(
  defs: readonly ColumnDef[],
  columns: readonly ResolvedColumn[],
  full: string,
  finance = true,
  extraRem = 0,
): string {
  const match = /^(\d+(?:\.\d+)?)rem$/.exec(full.trim());
  if (!match) return full;
  const base = resolveColumns(defs, null, finance)
    .filter((column) => column.visible)
    .reduce((sum, column) => sum + columnRem(column), extraRem);
  const now = columns
    .filter((column) => column.visible)
    .reduce((sum, column) => sum + columnRem(column), extraRem);
  if (base <= 0) return full;
  const rem = Math.round(Number(match[1]) * (now / base) * 2) / 2;
  return `${Math.max(20, rem)}rem`;
}
