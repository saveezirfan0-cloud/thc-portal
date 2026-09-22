import type { ClientEventRow, QualifiedStaffRow, RateCardRow } from './types';

/**
 * The client card's presentation rules (§9.7). Pure, so the money ones can
 * be driven directly.
 */

/** £ with two decimals, the only way money is written on this screen. */
export function gbp(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return '—';
  return `£${amount.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** A whole-pound figure, for the events list's margin column. */
export function gbpRound(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return '—';
  return `£${Math.round(amount).toLocaleString('en-GB')}`;
}

/**
 * §9.7's margin colour. The threshold is not a scope rule — the scope
 * never names a target margin — so this only separates "making money"
 * from "not", which is the one judgement the figure supports on its own.
 */
export function marginTone(pct: number | null): 'green' | 'coral' | 'none' {
  if (pct === null) return 'none';
  return pct > 0 ? 'green' : 'coral';
}

/**
 * The per-role counter §9.7 asks for — "Waiting Staff · 34 qualified" —
 * which is what tells a manager whether auto-assign can fill that role
 * section from Wave 1 alone (§3.4).
 *
 * A worker marked Do not return is NOT counted. They are excluded from
 * the client outright, so counting them would overstate the first-choice
 * pool by exactly the people who cannot be sent.
 */
export function groupByRole(
  rows: QualifiedStaffRow[],
): { role: string; workers: QualifiedStaffRow[]; count: number }[] {
  const groups = new Map<string, QualifiedStaffRow[]>();
  for (const row of rows) {
    for (const role of row.role_names) {
      const list = groups.get(role);
      if (list) list.push(row);
      else groups.set(role, [row]);
    }
  }
  return [...groups.entries()]
    .map(([role, workers]) => ({
      role,
      workers,
      count: workers.filter((worker) => !worker.do_not_return).length,
    }))
    .sort((a, b) => a.role.localeCompare(b.role));
}

/** How §9.7 words the provenance of a qualification. */
export function grantedHow(row: QualifiedStaffRow): string {
  if (row.granted_how === 'manual') {
    return row.granted_by_name ? `manual by ${row.granted_by_name}` : 'manual';
  }
  return row.granted_from_event_title
    ? `automatically from ${row.granted_from_event_title}`
    : 'automatically after a clean shift';
}

export type EventFilter = 'all' | 'upcoming' | 'completed' | 'cancelled';

export function matchesEventFilter(row: ClientEventRow, filter: EventFilter): boolean {
  if (filter === 'all') return true;
  // Ongoing belongs with upcoming: it has not been delivered yet, and a
  // manager filtering for "upcoming" is looking for work still to happen.
  if (filter === 'upcoming') return row.status === 'upcoming' || row.status === 'ongoing';
  return row.status === filter;
}

/**
 * Sorting the rate card by margin is the one thing a manager does with it
 * that is not editing, so the comparator lives here rather than inline. A
 * role with no charge rate has no margin and sorts last either way — it is
 * not the best-performing role in the list.
 */
export function byMargin(a: RateCardRow, b: RateCardRow): number {
  return (b.margin_pct ?? -Infinity) - (a.margin_pct ?? -Infinity);
}
