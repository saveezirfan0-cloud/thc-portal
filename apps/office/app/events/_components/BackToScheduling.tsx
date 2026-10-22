'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CalendarView } from '../calendar';

/**
 * "← Back to Week · Mon 12 Oct – Sun 18 Oct 2026" on the event board (ADR-0195).
 *
 * Every state of /events is already a URL (`_lib/filters.ts`), but the board
 * only knew `/events` — the sidebar and the "Scheduling" crumb both opened
 * the default List at today, so a manager who opened an event from a week
 * three weeks out had to find that week again. The Scheduling page now leaves
 * its current URL in this tab's sessionStorage, and the board's back button
 * and crumb read it.
 *
 * sessionStorage, not a query parameter: the way back survives Edit, a
 * refresh and every other page the board links to without threading a
 * parameter through each of them, and it is per tab, so two tabs on two weeks
 * each go back to their own. Read after mount only; the server render (and
 * any browser that throws on storage) links to plain `/events`.
 */

export const SCHEDULING_RETURN_KEY = 'thc.events.return.v1';

export interface SchedulingReturn {
  href: string;
  label: string;
}

const VIEW_NAME: Record<CalendarView, string> = {
  list: 'List',
  month: 'Month',
  week: 'Week',
  day: 'Day',
};

/** "Week · Mon 12 Oct – Sun 18 Oct 2026". */
export function schedulingReturnLabel(view: CalendarView, period: string): string {
  return `${VIEW_NAME[view]} · ${period}`;
}

/**
 * The stored value, or null. Only this app's own Scheduling URL is ever
 * followed — a value that is not `/events?…` (hand-edited, or from an older
 * build) is ignored rather than linked to.
 */
export function readSchedulingReturn(raw: string | null): SchedulingReturn | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const { href, label } = value as Record<string, unknown>;
    if (typeof href !== 'string' || typeof label !== 'string') return null;
    if (href !== '/events' && !href.startsWith('/events?')) return null;
    return { href, label: label.slice(0, 80) };
  } catch {
    return null;
  }
}

/**
 * The URL to come back to. A period opened at today is kept without its
 * date, so a tab left on today's Week goes back to the week of the day it is
 * opened on, as the sidebar's Scheduling does (ADR-0167), not to a stale one.
 */
export function schedulingReturnHref(href: string, date: string, today: string): string {
  if (date !== today) return href;
  const [path, search = ''] = href.split('?');
  const params = new URLSearchParams(search);
  params.delete('date');
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path!;
}

/** Mounted on /events: keeps the period, view and filters on screen as the way back. */
export function RememberSchedulingView({ href, label }: SchedulingReturn) {
  useEffect(() => {
    try {
      window.sessionStorage.setItem(SCHEDULING_RETURN_KEY, JSON.stringify({ href, label }));
    } catch {
      // Private mode or a full quota: the board falls back to /events.
    }
  }, [href, label]);
  return null;
}

function useSchedulingReturn(): SchedulingReturn | null {
  const [target, setTarget] = useState<SchedulingReturn | null>(null);
  useEffect(() => {
    try {
      setTarget(readSchedulingReturn(window.sessionStorage.getItem(SCHEDULING_RETURN_KEY)));
    } catch {
      setTarget(null);
    }
  }, []);
  return target;
}

/**
 * The board's way back to Scheduling, at the view it was opened from.
 * `crumb` is the "Scheduling" link in the top bar; the default is the button
 * above the Event panel.
 */
export function BackToScheduling({ variant = 'button' }: { variant?: 'button' | 'crumb' }) {
  const target = useSchedulingReturn();
  const href = target?.href ?? '/events';
  if (variant === 'crumb') {
    return (
      <Link href={href} title={target ? `Back to ${target.label}` : undefined}>
        Scheduling
      </Link>
    );
  }
  return (
    <Link className="btn sm" href={href}>
      <span aria-hidden="true">←</span> {target ? `Back to ${target.label}` : 'Back to Scheduling'}
    </Link>
  );
}
