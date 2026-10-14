'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * A directory's search, tab, filters, sort and page, kept in the URL
 * (release audit L1, m5) — so Back from a detail page, a reload and a
 * shared link all land on the list exactly as it was left.
 *
 * /feedback, /activity, /inbox and /reports read their query on the server
 * and navigate with `router.push`. The lists here filter rows already on
 * the page (tens of clients, ~1,000 workers), so a round trip per keystroke
 * would buy nothing: the screen keeps its state in React and MIRRORS it to
 * the address bar with the History API. That is also why none of these
 * pages becomes "query-navigated" in ADR-0109's sense — a filter change
 * never asks the router for a new page, so a loading.tsx or a <Suspense>
 * above the list cannot freeze it.
 *
 * - Every value is a string; `defaults` names the keys this list owns and
 *   their default. A default is never written: an untouched list is the
 *   bare path.
 * - Typing in a search box `replace`s the entry (Back is not spammed with
 *   one entry per letter); a tab, filter, sort or page change `push`es one,
 *   as /feedback's filters do.
 * - Back/Forward between two states of the list, or a link to the bare
 *   path while the list is open, are read back from the URL.
 * - Keys this list does not own (e.g. `/staff?view=student` from
 *   /compliance) are left alone.
 */
export type QueryValues = Readonly<Record<string, string>>;
export type HistoryMode = 'push' | 'replace';

/** The list's values from a query string, defaults filled in. */
export function readQuery<K extends string>(
  search: string,
  defaults: Readonly<Record<K, string>>,
): Record<K, string> {
  const params = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const key of Object.keys(defaults) as K[]) out[key] = params.get(key) ?? defaults[key];
  return out as Record<K, string>;
}

/**
 * The query string for `values`: keys the list does not own kept as they
 * are, the list's own keys in `defaults` order, defaults left out. No
 * leading "?".
 */
export function writeQuery<K extends string>(
  current: string,
  defaults: Readonly<Record<K, string>>,
  values: Readonly<Record<K, string>>,
): string {
  const params = new URLSearchParams(current);
  const keys = Object.keys(defaults) as K[];
  for (const key of keys) params.delete(key);
  for (const key of keys) {
    const value = values[key] ?? defaults[key];
    if (value !== defaults[key]) params.set(key, value);
  }
  return params.toString();
}

function same(a: QueryValues, b: QueryValues): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** `value` if it is one of `allowed`, else `fallback` — for a hand-edited URL. */
export function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A 1-based `?page=` as the zero-based page a screen counts in. */
export function pageIndex(value: string): number {
  const page = Number.parseInt(value, 10);
  return Number.isFinite(page) && page > 1 ? page - 1 : 0;
}

/** The zero-based page as the `?page=` value ("1" is the default and is omitted). */
export function pageParam(index: number): string {
  return String(Math.max(0, index) + 1);
}

/** A rows-per-page value from the URL, if it is one of the pager's sizes. */
export function sizeOf<T extends number>(value: string, sizes: readonly T[], fallback: T): T {
  const size = Number(value);
  return (sizes as readonly number[]).includes(size) ? (size as T) : fallback;
}

/**
 * `[values, set]`. `defaults` must be a module constant (it is read once
 * per URL change, not compared by identity on every render).
 */
export function useListQuery<K extends string>(
  defaults: Readonly<Record<K, string>>,
): [Record<K, string>, (patch: Partial<Record<K, string>>, mode?: HistoryMode) => void] {
  // Both are null outside the App Router (a unit test rendering the screen
  // bare): the list then starts from its defaults.
  const params = useSearchParams() as URLSearchParams | null;
  const pathname = usePathname() as string | null;
  const search = params?.toString() ?? '';
  const [values, setValues] = useState<Record<K, string>>(() => readQuery(search, defaults));
  const latest = useRef(values);
  // Query strings this hook has written and the router has not caught up
  // with yet: when `search` reports one of them it is our own write, not a
  // Back or a link, and must not overwrite a newer keystroke.
  const written = useRef<string[]>([]);

  useEffect(() => {
    const ours = written.current.indexOf(search);
    if (ours >= 0) {
      written.current = written.current.slice(ours + 1);
      return;
    }
    written.current = [];
    const next = readQuery(search, defaults);
    if (!same(next, latest.current)) {
      latest.current = next;
      setValues(next);
    }
  }, [search, defaults]);

  const set = useCallback(
    (patch: Partial<Record<K, string>>, mode: HistoryMode = 'push') => {
      const next = { ...latest.current, ...patch } as Record<K, string>;
      if (same(next, latest.current)) return;
      latest.current = next;
      setValues(next);
      const query = writeQuery(window.location.search, defaults, next);
      if (query === window.location.search.replace(/^\?/, '')) return;
      written.current.push(query);
      const url = `${pathname ?? window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
      if (mode === 'replace') window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    },
    [defaults, pathname],
  );

  return [values, set];
}
