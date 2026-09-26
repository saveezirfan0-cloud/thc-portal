import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from './data';

/**
 * "11 of 13 arrived" (ADR-0053) — the client-approved addition to §11.
 *
 * COUNTS ONLY. `client_arrivals_v` carries four columns (shift_id, event_id,
 * confirmed, arrived) and nothing else: no name, no check-in time, no Late /
 * No-show label per person, no location. This loader cannot leak what the
 * view does not have, and it asks for the four columns by name.
 *
 * The same ADR-0004 path as `data.ts`: the anon-key server client under the
 * caller's own session, reading an owner-rights view that applies
 * `client_portal_visible()` in its own body. There is deliberately no
 * `client_id` filter here — the database decides which events come back.
 * `check_logs`, `bookings` and `shift_requirements` stay closed to the client
 * role and are never read from this app.
 *
 * The view also decides WHEN: it returns no row before the event's earliest
 * role start and none for a cancelled event, so an event missing from the
 * map simply has nothing to show yet.
 *
 * This is an addition to the page, never a reason for it to fail: no
 * project, a query error or a thrown client all come back as an empty map.
 */

/** One role section, or an event's total: counts, never people. */
export interface ArrivalCount {
  /** Confirmed line-up — the same number as `client_role_sections_v.confirmed`. */
  confirmed: number;
  /** Of those, how many have a check-in recorded for this shift. */
  arrived: number;
}

export interface EventArrivals extends ArrivalCount {
  /** Keyed by role-section id (`shift_id`), for the per-role figure (RULE-18). */
  bySection: Record<string, ArrivalCount>;
}

export type ArrivalsByEvent = Record<string, EventArrivals>;

const ARRIVAL_COLUMNS = 'shift_id, event_id, confirmed, arrived';

export interface ArrivalRow {
  shift_id: string;
  event_id: string;
  confirmed: number | string | null;
  arrived: number | string | null;
}

function count(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Rows of `client_arrivals_v` → per-event totals with their sections. Pure. */
export function groupArrivals(rows: readonly ArrivalRow[]): ArrivalsByEvent {
  const out: ArrivalsByEvent = {};
  for (const r of rows) {
    if (!r || typeof r.event_id !== 'string' || typeof r.shift_id !== 'string') continue;
    const confirmed = count(r.confirmed);
    // Never more arrived than confirmed: the view guarantees it, the screen
    // should not be the place that finds out otherwise.
    const arrived = Math.min(count(r.arrived), confirmed);
    const ev = (out[r.event_id] ??= { confirmed: 0, arrived: 0, bySection: {} });
    const prev = ev.bySection[r.shift_id];
    if (prev) {
      ev.confirmed -= prev.confirmed;
      ev.arrived -= prev.arrived;
    }
    ev.bySection[r.shift_id] = { confirmed, arrived };
    ev.confirmed += confirmed;
    ev.arrived += arrived;
  }
  return out;
}

/**
 * Arrival counts for the caller's own started events.
 *
 * `eventIds` narrows the read (the event page passes its one id); omitted, it
 * reads every row the view returns for this caller (the list). An empty list
 * asks for nothing and makes no request.
 */
export async function loadArrivals(eventIds?: string[]): Promise<ArrivalsByEvent> {
  if (!supabaseConfigured()) return {};
  if (eventIds && eventIds.length === 0) return {};

  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the
       generated types predate this view (see data.ts). */
    const supabase = createClient(await cookies()) as any;
    let query = supabase.from('client_arrivals_v').select(ARRIVAL_COLUMNS);
    if (eventIds) query = query.in('event_id', eventIds);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return {};
    return groupArrivals(data as ArrivalRow[]);
  } catch {
    return {};
  }
}
