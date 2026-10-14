'use client';

import { clsx } from 'clsx';
import {
  Fragment,
  createContext,
  use,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Checkbox } from './Controls';
import { TableScroll } from './Table';
import type { TableScrollProps } from './Table';
import {
  isDefaultLayout,
  moveColumnTo,
  movablePosition,
  normaliseColumnPref,
  normaliseColumnPrefs,
  prefOf,
  resolveColumns,
  scaledMinWidth,
  setColumnVisible,
  widthClass,
} from './columns';
import type { ColumnDef, ColumnPref, ColumnPrefs, ResolvedColumn } from './columns';

/* ---------------------------------------------------------------------
   Persistence: one provider per app, per signed-in person (ADR-0139)
   --------------------------------------------------------------------- */

/** The server's answer, or the promise of it (the root layout does not wait for it). */
export type ColumnPrefsSource = ColumnPrefs | PromiseLike<ColumnPrefs>;

/**
 * Saves one list's choice; `null` is "back to the default". A refusal or a
 * thrown error leaves the choice on screen and it is sent again later.
 */
export type SaveColumnPref = (
  listKey: string,
  pref: ColumnPref | null,
) => Promise<{ ok: boolean } | void>;

interface ColumnPrefsStore {
  source: ColumnPrefsSource;
  /** Changes made on this page load, newer than whatever the server said. */
  local: Readonly<Record<string, ColumnPref | null>>;
  set: (listKey: string, pref: ColumnPref | null) => void;
  /** Sends a list's queued change now, without waiting for the quiet spell. */
  flush: (listKey: string) => void;
}

const ColumnPrefsContext = createContext<ColumnPrefsStore | null>(null);

function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Holds every list's column choice for the signed-in person.
 *
 * - `prefs` is read on the server, so a list's first paint already has the
 *   person's columns — no flash of the defaults. A promise is fine: the
 *   lists resolve it with `use()`, so the layout above never waits.
 * - A change shows at once (optimistic) and is saved after `delay` ms of
 *   quiet, one call per list. A save that fails — offline, a lapsed
 *   session — stays queued and is sent again when the browser is back
 *   online, on the next change, or when the page is hidden.
 * - It lives in the root layout, so a choice made on one list is still
 *   there after navigating away and back, before any refresh.
 */
export function ColumnPrefsProvider({
  prefs,
  save,
  delay = 600,
  children,
}: {
  prefs: ColumnPrefsSource;
  save: SaveColumnPref;
  delay?: number;
  children: ReactNode;
}) {
  const [local, setLocal] = useState<Record<string, ColumnPref | null>>({});
  const saveRef = useRef(save);
  saveRef.current = save;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, ColumnPref | null>());

  const flush = useCallback((listKey: string) => {
    const timer = timers.current.get(listKey);
    if (timer) clearTimeout(timer);
    timers.current.delete(listKey);
    if (!pending.current.has(listKey)) return;
    const value = pending.current.get(listKey) ?? null;
    Promise.resolve()
      .then(() => saveRef.current(listKey, value))
      .then((result) => {
        if (result && result.ok === false) return;
        // Only if nothing newer was queued while this one was in flight.
        if (pending.current.get(listKey) === value) pending.current.delete(listKey);
      })
      .catch(() => {
        /* kept in `pending`: sent again online, on the next change or on pagehide */
      });
  }, []);

  const set = useCallback(
    (listKey: string, pref: ColumnPref | null) => {
      setLocal((current) => ({ ...current, [listKey]: pref }));
      pending.current.set(listKey, pref);
      const timer = timers.current.get(listKey);
      if (timer) clearTimeout(timer);
      timers.current.set(
        listKey,
        setTimeout(() => flush(listKey), delay),
      );
    },
    [delay, flush],
  );

  useEffect(() => {
    const all = () => {
      for (const key of [...pending.current.keys()]) flush(key);
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') all();
    };
    window.addEventListener('online', all);
    window.addEventListener('pagehide', all);
    document.addEventListener('visibilitychange', onHide);
    const timerMap = timers.current;
    return () => {
      window.removeEventListener('online', all);
      window.removeEventListener('pagehide', all);
      document.removeEventListener('visibilitychange', onHide);
      for (const timer of timerMap.values()) clearTimeout(timer);
    };
  }, [flush]);

  const store = useMemo(() => ({ source: prefs, local, set, flush }), [prefs, local, set, flush]);
  return <ColumnPrefsContext.Provider value={store}>{children}</ColumnPrefsContext.Provider>;
}

const NO_PREFS: ColumnPrefs = {};
/** Normalised once per server answer, not once per list. */
const normalised = new WeakMap<object, ColumnPrefs>();
function cleanPrefs(raw: ColumnPrefs): ColumnPrefs {
  let clean = normalised.get(raw);
  if (!clean) {
    clean = normaliseColumnPrefs(raw);
    normalised.set(raw, clean);
  }
  return clean;
}

/* ---------------------------------------------------------------------
   useColumns — a list's resolved columns and the verbs that change them
   --------------------------------------------------------------------- */

export interface Columns<Id extends string = string> {
  listKey: string;
  /** Every column this login is offered, in order, each marked visible or not. */
  columns: ResolvedColumn<Id>[];
  /** The columns to draw, in order. */
  visible: ResolvedColumn<Id>[];
  /** Is this column drawn? */
  has: (id: Id) => boolean;
  setVisible: (id: Id, visible: boolean) => void;
  /** To `index` among the movable columns. */
  moveTo: (id: Id, index: number) => void;
  /** One place up (-1) or down (+1). */
  move: (id: Id, delta: number) => void;
  reset: () => void;
  /** Saves now what is still waiting for the quiet spell (the dialog closed). */
  flush: () => void;
  isDefault: boolean;
  /**
   * The table's minimum width for what is shown, from the screen's figure
   * for its default set (ADR-0136): `minWidth("56rem")`. `extraRem` is a
   * lead cell that is not a chooser column.
   */
  minWidth: (full: string, extraRem?: number) => string;
}

export interface UseColumnsOptions {
  /**
   * May this login see money (ADR-0061, `officeCan(role, 'finance')`)?
   * Without it a `finance` column is neither drawn nor offered. Defaults
   * to true: a screen that has no money columns need not ask.
   */
  finance?: boolean;
}

/**
 * A list's columns, as this person left them. `listKey` names the list —
 * and the view, where its columns differ ("staff.inactive"); `defs` is the
 * screen's one declaration of its columns, in their default order, and
 * must be a stable (module-level) array.
 *
 * Outside a `ColumnPrefsProvider` (a component test, a preview) the choice
 * lives in the component and is not saved.
 */
export function useColumns<Id extends string>(
  listKey: string,
  defs: readonly ColumnDef<Id>[],
  options: UseColumnsOptions = {},
): Columns<Id> {
  const finance = options.finance ?? true;
  const store = useContext(ColumnPrefsContext);
  const raw = store ? (isThenable(store.source) ? use(store.source) : store.source) : NO_PREFS;
  const server = cleanPrefs(raw ?? NO_PREFS);
  const [own, setOwn] = useState<ColumnPref | null>(null);

  const stored: ColumnPref | null = store
    ? listKey in store.local
      ? (store.local[listKey] ?? null)
      : (server[listKey] ?? null)
    : own;

  const columns = useMemo(
    () => resolveColumns(defs, normaliseColumnPref(stored), finance),
    [defs, stored, finance],
  );
  const isDefault = useMemo(
    () => isDefaultLayout(defs, columns, finance),
    [defs, columns, finance],
  );

  const commit = (next: ResolvedColumn<Id>[]) => {
    if (next === columns) return;
    const pref = isDefaultLayout(defs, next, finance) ? null : prefOf(next);
    if (store) store.set(listKey, pref);
    else setOwn(pref);
  };

  return {
    listKey,
    columns,
    visible: columns.filter((column) => column.visible),
    has: (id) => columns.some((column) => column.id === id && column.visible),
    setVisible: (id, visible) => commit(setColumnVisible(columns, id, visible)),
    moveTo: (id, index) => commit(moveColumnTo(columns, id, index)),
    move: (id, delta) => {
      const { index } = movablePosition(columns, id);
      if (index !== -1) commit(moveColumnTo(columns, id, index + delta));
    },
    reset: () => {
      if (store) store.set(listKey, null);
      else setOwn(null);
    },
    flush: () => store?.flush(listKey),
    isDefault,
    minWidth: (full, extraRem = 0) => scaledMinWidth(defs, columns, full, finance, extraRem),
  };
}

/* ---------------------------------------------------------------------
   Rendering helpers: a screen declares its cells once, by column id
   --------------------------------------------------------------------- */

/** The header cells, in the chosen order: hint class, the def's classes, the label. */
export function ColumnHeads<Id extends string>({ columns }: { columns: Columns<Id> }) {
  return (
    <>
      {columns.visible.map((column) => (
        <th
          key={column.id}
          className={clsx(widthClass(column), column.className) || undefined}
          aria-label={column.blankHeader ? column.label : undefined}
        >
          {column.blankHeader ? null : column.label}
        </th>
      ))}
    </>
  );
}

/** A row's cells, in the chosen order. A cell the row does not give is left out. */
export function ColumnCells<Id extends string>({
  columns,
  cells,
}: {
  columns: Columns<Id>;
  cells: Partial<Record<Id, ReactNode>>;
}) {
  return (
    <>
      {columns.visible.map((column) => (
        <Fragment key={column.id}>{cells[column.id] ?? null}</Fragment>
      ))}
    </>
  );
}

/* ---------------------------------------------------------------------
   For server-rendered lists: the same pieces keyed by list
   ---------------------------------------------------------------------
   A server component cannot call `useColumns`, and the hook's result
   (functions) cannot cross to the client as a prop. These take what can —
   the list key and the plain column declaration — and each resolves the
   columns itself from the shared `ColumnPrefsProvider`, so a server page
   keeps rendering its rows and its cells on the server. */

export interface ColumnListProps<Id extends string = string> {
  /** The list key, as `useColumns` takes it ("events.list"). */
  list: string;
  /** The screen's declaration, in the default order. Plain data. */
  defs: readonly ColumnDef<Id>[];
  /** May this login see money (ADR-0061)? Defaults to true. */
  finance?: boolean;
}

/** `ColumnHeads` for a server-rendered table. */
export function ColumnHeadsFor<Id extends string>({ list, defs, finance }: ColumnListProps<Id>) {
  return <ColumnHeads columns={useColumns(list, defs, { finance: finance ?? true })} />;
}

/** `ColumnCells` for a server-rendered row: the cells are rendered on the server. */
export function ColumnCellsFor<Id extends string>({
  list,
  defs,
  finance,
  cells,
}: ColumnListProps<Id> & { cells: Partial<Record<Id, ReactNode>> }) {
  return (
    <ColumnCells columns={useColumns(list, defs, { finance: finance ?? true })} cells={cells} />
  );
}

/** `ColumnChooser` for a server-rendered list's toolbar. */
export function ColumnChooserFor<Id extends string>({
  list,
  defs,
  finance,
  label,
  className,
}: ColumnListProps<Id> & { label?: string; className?: string }) {
  return (
    <ColumnChooser
      columns={useColumns(list, defs, { finance: finance ?? true })}
      label={label}
      className={className}
    />
  );
}

/**
 * `TableScroll` whose minimum width follows the columns shown (ADR-0136):
 * `minWidth` is the screen's figure for its default set.
 */
export function TableScrollFor<Id extends string>({
  list,
  defs,
  finance,
  minWidth,
  extraRem,
  ...rest
}: ColumnListProps<Id> & TableScrollProps & { minWidth: string; extraRem?: number }) {
  const columns = useColumns(list, defs, { finance: finance ?? true });
  return <TableScroll {...rest} minWidth={columns.minWidth(minWidth, extraRem)} />;
}

/* ---------------------------------------------------------------------
   ColumnChooser — the "Columns" button and its dialog
   --------------------------------------------------------------------- */

export interface ColumnChooserProps<Id extends string = string> {
  columns: Columns<Id>;
  /** The list's name, under the dialog's title ("Staff"). */
  label?: string;
  className?: string;
}

const TABBABLE =
  'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * "Columns": a pill-ghost button in a list's toolbar that opens a labelled
 * dialog — a popover under the button on a desktop, a sheet from the
 * bottom on a phone, where the list is cards and the same choice decides
 * which fields a card shows and in what order.
 *
 * - A tick per column shows or hides it; the identifying first column and
 *   the actions column are ticked, disabled and held in place.
 * - Reorder three ways, never by drag alone: the drag handle (mouse, pen,
 *   touch), the Move up / Move down buttons, and Alt+↑ / Alt+↓ on any
 *   control in the row.
 * - Focus is trapped while it is open; Escape, Done, × or a click outside
 *   close it and focus returns to the button.
 * - Every change is announced in a polite live region ("Column Venue
 *   hidden", "Venue moved to position 3 of 6").
 */
export function ColumnChooser<Id extends string>({
  columns,
  label,
  className,
}: ColumnChooserProps<Id>) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState<Id | null>(null);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** Where focus goes after a move re-renders the list. */
  const refocus = useRef<{ id: string; control: string } | null>(null);
  const baseId = useId();
  const dialogId = `${baseId}-dialog`;
  const titleId = `${baseId}-title`;

  const all = columns.columns;
  const shown = all.filter((column) => column.visible).length;

  const announce = (text: string) =>
    // The same sentence twice is still read twice: a trailing no-break
    // space makes it a change.
    setMessage((current) => (current === text ? `${text}\u00a0` : text));

  // Closing the dialog is "done": what was changed is saved now rather than
  // after the quiet spell, so leaving the page straight away loses nothing.
  const flushRef = useRef(columns.flush);
  flushRef.current = columns.flush;
  const close = useCallback(() => {
    setOpen(false);
    setDragging(null);
    flushRef.current();
    triggerRef.current?.focus();
  }, []);

  // Where the popover sits: under the button, right edges aligned. A phone
  // draws it as a sheet and ignores this.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPlace({
        top: Math.round(rect.bottom + 6),
        right: Math.max(8, Math.round(window.innerWidth - rect.right)),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true, capture: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, { capture: true });
    };
  }, [open]);

  // Focus in on open; Escape, Tab trapping and a click outside while open.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const first =
      dialog?.querySelector<HTMLElement>('li:not([data-locked]) input') ??
      dialog?.querySelector<HTMLElement>(TABBABLE);
    (first ?? dialog)?.focus();

    const onKey = (event: globalThis.KeyboardEvent) => {
      const box = dialogRef.current;
      if (!box) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(box.querySelectorAll<HTMLElement>(TABBABLE)).filter(
        (element) => element.tabIndex >= 0,
      );
      if (items.length === 0) return;
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof Node && box.contains(active);
      if (event.shiftKey && (!inside || active === head)) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && (!inside || active === tail)) {
        event.preventDefault();
        head.focus();
      }
    };
    const onPointer = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (dialogRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
      setDragging(null);
      flushRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open, close]);

  // After a move, the same control in the same row has focus again (React
  // moves the row's node, and a moved node loses focus in some browsers).
  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want || !open) return;
    refocus.current = null;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-col-id="${want.id}"]`);
    const control =
      (want.control === 'check'
        ? null
        : row?.querySelector<HTMLElement>(`button[data-ctl="${want.control}"]:not([disabled])`)) ??
      row?.querySelector<HTMLElement>('input');
    control?.focus();
  });

  const toggle = (column: ResolvedColumn<Id>, on: boolean) => {
    if (column.required) return;
    columns.setVisible(column.id, on);
    announce(`Column ${column.label} ${on ? 'shown' : 'hidden'}`);
  };

  const moveBy = (column: ResolvedColumn<Id>, delta: number, control: string) => {
    const { index, count } = movablePosition(all, column.id);
    const to = index + delta;
    if (index === -1 || to < 0 || to >= count) return;
    refocus.current = { id: column.id, control };
    columns.move(column.id, delta);
    announce(`${column.label} moved to position ${to + 1} of ${count}`);
  };

  const onRowKey = (column: ResolvedColumn<Id>) => (event: KeyboardEvent<HTMLLIElement>) => {
    if (!event.altKey || column.lock) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const control = (event.target as HTMLElement).getAttribute('data-ctl') ?? 'check';
    moveBy(column, event.key === 'ArrowUp' ? -1 : 1, control);
  };

  // Drag by the handle: the row follows the pointer's height among the
  // movable rows; the move is announced when it is let go.
  const onHandleDown = (column: ResolvedColumn<Id>) => (event: PointerEvent<HTMLSpanElement>) => {
    if (column.lock || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(column.id);
  };
  const onHandleMove = (column: ResolvedColumn<Id>) => (event: PointerEvent<HTMLSpanElement>) => {
    if (dragging !== column.id) return;
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('li[data-movable]') ?? [],
    ).filter((row) => row.dataset['colId'] !== column.id);
    let to = 0;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (event.clientY > rect.top + rect.height / 2) to += 1;
    }
    if (to !== movablePosition(all, column.id).index) columns.moveTo(column.id, to);
  };
  const onHandleUp = (column: ResolvedColumn<Id>) => (event: PointerEvent<HTMLSpanElement>) => {
    if (dragging !== column.id) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(null);
    const { index, count } = movablePosition(all, column.id);
    announce(`${column.label} moved to position ${index + 1} of ${count}`);
  };

  const { count } = movablePosition(all, '');
  const popStyle = place
    ? ({ '--pop-top': `${place.top}px`, '--pop-right': `${place.right}px` } as CSSProperties)
    : undefined;

  const dialog = open ? (
    <div className="colchooser-layer">
      <div className="colchooser-scrim" aria-hidden="true" onClick={close} />
      <div
        ref={dialogRef}
        id={dialogId}
        className="colchooser-pop"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={popStyle}
      >
        <div className="colchooser-head">
          <div>
            <h3 id={titleId}>Columns{label ? ` · ${label}` : ''}</h3>
            <p className="xs muted">
              {shown} of {all.length} shown · drag, use the arrows or Alt+↑ / Alt+↓ to reorder
            </p>
          </div>
          <button type="button" className="btn ghost sm icon" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <ul ref={listRef} className="colchooser-list" aria-label="Columns, in order">
          {all.map((column) => {
            const { index } = movablePosition(all, column.id);
            const locked = Boolean(column.lock);
            return (
              <li
                key={column.id}
                data-col-id={column.id}
                data-movable={locked ? undefined : ''}
                data-locked={locked ? '' : undefined}
                className={clsx('colchooser-row', dragging === column.id && 'dragging')}
                onKeyDown={onRowKey(column)}
              >
                <span
                  className={clsx('colchooser-handle', locked && 'off')}
                  aria-hidden="true"
                  title={locked ? undefined : 'Drag to reorder'}
                  onPointerDown={onHandleDown(column)}
                  onPointerMove={onHandleMove(column)}
                  onPointerUp={onHandleUp(column)}
                  onPointerCancel={onHandleUp(column)}
                >
                  <svg viewBox="0 0 10 16" width="10" height="16" focusable="false">
                    <circle cx="2.5" cy="3" r="1.4" />
                    <circle cx="7.5" cy="3" r="1.4" />
                    <circle cx="2.5" cy="8" r="1.4" />
                    <circle cx="7.5" cy="8" r="1.4" />
                    <circle cx="2.5" cy="13" r="1.4" />
                    <circle cx="7.5" cy="13" r="1.4" />
                  </svg>
                </span>
                <div className="colchooser-check">
                  <Checkbox
                    checked={column.visible}
                    disabled={Boolean(column.required)}
                    onChange={(on) => toggle(column, on)}
                  >
                    {column.label}
                    {column.required ? (
                      <span className="sub">
                        Always shown{column.lock === 'start' ? ' · first' : ''}
                        {column.lock === 'end' ? ' · last' : ''}
                      </span>
                    ) : null}
                  </Checkbox>
                </div>
                {locked ? null : (
                  <span className="colchooser-moves">
                    <button
                      type="button"
                      className="btn ghost sm icon"
                      data-ctl="up"
                      aria-label={`Move ${column.label} up`}
                      disabled={index <= 0}
                      onClick={() => moveBy(column, -1, 'up')}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm icon"
                      data-ctl="down"
                      aria-label={`Move ${column.label} down`}
                      disabled={index >= count - 1}
                      onClick={() => moveBy(column, 1, 'down')}
                    >
                      ↓
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="colchooser-foot">
          <button
            type="button"
            className="btn ghost sm"
            disabled={columns.isDefault}
            onClick={() => {
              columns.reset();
              announce('Columns reset to default');
            }}
          >
            Reset to default
          </button>
          <button type="button" className="btn primary sm" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className={clsx('colchooser', className)}>
      <button
        ref={triggerRef}
        type="button"
        className={clsx('btn ghost sm colchooser-btn', !columns.isDefault && 'changed')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={`Columns — ${shown} of ${all.length} shown`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
          <path d="M6 2.5v11M10 2.5v11" />
        </svg>
        Columns
        {columns.isDefault ? null : (
          <span className="colchooser-count" aria-hidden="true">
            {shown}/{all.length}
          </span>
        )}
      </button>
      <span className="colchooser-live" role="status" aria-live="polite">
        {message}
      </span>
      {dialog && typeof document !== 'undefined' ? createPortal(dialog, document.body) : null}
    </div>
  );
}
