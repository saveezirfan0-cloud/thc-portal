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

/**
 * Why a charge rate cannot be saved, or null when it can. A third decimal
 * is rejected rather than rounded: `numeric(8,2)` would turn £22.975 into
 * £22.98 silently, and every margin on this screen is derived from it.
 *
 * Pence are compared with a tolerance, not `!==`: in binary floating point
 * 19.99 × 100 is 1998.9999999999998, so an exact test refused one valid
 * rate in seven (£19.99, £16.10, £10.05) as "more than two decimals".
 * A real third decimal is at least 0.1p away from a whole penny.
 */
export function chargeRateProblem(rate: number): string | null {
  if (!Number.isFinite(rate)) return 'Enter a charge rate.';
  if (rate < 0) return 'A charge rate cannot be negative.';
  const pence = rate * 100;
  if (Math.abs(pence - Math.round(pence)) > 1e-6) {
    return 'A charge rate is in pounds and pence — two decimal places.';
  }
  if (rate > 1000) return 'A charge rate over £1,000.00 an hour is refused — check the figure.';
  return null;
}

/** What was typed in the £ field, as a number ("£22.50", "1,200.00"); NaN when it is not one. */
export function chargeValue(text: string): number {
  const trimmed = text.trim().replace(/^£/, '').replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/**
 * Why the typed charge rate cannot be saved, next to the field and with
 * Save disabled while it stands (release audit m8 — the error used to
 * come back from the server, at the top of the card, as "Enter a charge
 * rate." for anything that was not a number).
 */
export function chargeRateInputProblem(text: string): string | null {
  if (text.trim() === '') return 'Enter a charge rate.';
  const value = chargeValue(text);
  if (Number.isNaN(value)) return 'Enter the charge rate in pounds and pence, e.g. 22.50.';
  return chargeRateProblem(value);
}

/**
 * The margin an hour and as a share of the charge, from pence — the
 * preview a row shows while it is typed, before final_rate() has priced
 * it (release audit m8).
 */
export function marginPreview(
  chargePence: number,
  finalPence: number,
): { perHour: number; pct: number | null } {
  const perHour = (chargePence - finalPence) / 100;
  return {
    perHour,
    pct:
      chargePence > 0 ? Math.round(((chargePence - finalPence) / chargePence) * 1000) / 10 : null,
  };
}

/** "31.7%" / "−56.9%": a margin share, with a real minus too. */
export function signedPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—';
  return `${pct < 0 ? '−' : ''}${Math.abs(pct)}%`;
}

/** "+£4.21" / "−£5.69": a margin carries its sign, with a real minus (release audit D-M7). */
export function signedGbp(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return '—';
  return `${amount < 0 ? '−' : '+'}${gbp(Math.abs(amount))}`;
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
  const barred: QualifiedStaffRow[] = [];
  for (const row of rows) {
    // ADR-0146: barred here without being cleared here. The row's role is
    // only a key, so it belongs to no role group — it goes last, on its own.
    if (row.bar_only) {
      barred.push(row);
      continue;
    }
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
    .sort((a, b) => a.role.localeCompare(b.role))
    .concat(barred.length > 0 ? [{ role: BARRED_GROUP, workers: barred, count: 0 }] : []);
}

/** The group for workers barred at a client they are not cleared at (ADR-0146). */
export const BARRED_GROUP = 'Do not return · not cleared here';

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

/**
 * "+ New event for this client" (§9.7): the Shift Builder with this client
 * already picked — `/events/new` reads the parameter (events/new/preselect.ts).
 */
export function newEventHref(clientId: string): string {
  return `/events/new?client=${encodeURIComponent(clientId)}`;
}

/**
 * Every dress code already stored on any client's rate card, most-used first
 * (then A–Z), so the rate card can offer them instead of being retyped.
 * Compared case-insensitively; the first spelling seen is the one offered.
 */
export function dressCodeLibrary(lists: (string[] | null)[]): string[] {
  const seen = new Map<string, { code: string; uses: number }>();
  for (const list of lists) {
    for (const raw of list ?? []) {
      const code = raw.trim();
      if (!code) continue;
      const key = code.toLowerCase();
      const entry = seen.get(key);
      if (entry) entry.uses += 1;
      else seen.set(key, { code, uses: 1 });
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.uses - a.uses || a.code.localeCompare(b.code))
    .map((entry) => entry.code);
}

/**
 * The stored codes still worth offering while a row is being edited: not
 * already chosen, and containing what has been typed so far.
 */
export function dressCodeSuggestions(
  library: string[],
  chosen: string[],
  typed: string,
  limit = 8,
): string[] {
  const have = new Set(chosen.map((code) => code.toLowerCase()));
  const needle = typed.trim().toLowerCase();
  return library
    .filter((code) => !have.has(code.toLowerCase()) && code.toLowerCase().includes(needle))
    .slice(0, limit);
}

/**
 * The dress codes a newly added role starts with: the ones most of this
 * client's existing roles already carry (strictly more than half). A client
 * is usually dressed one way whatever the role, so the first role teaches
 * the rest; where its roles disagree there is nothing to learn and the
 * draft starts empty rather than guessing. Still editable before Save.
 */
export function defaultDressCodes(rows: { dress_codes: string[] | null }[]): string[] {
  const seen = new Map<string, { code: string; uses: number }>();
  for (const row of rows) {
    const own = new Set<string>();
    for (const raw of row.dress_codes ?? []) {
      const code = raw.trim();
      const key = code.toLowerCase();
      if (!code || own.has(key)) continue;
      own.add(key);
      const entry = seen.get(key);
      if (entry) entry.uses += 1;
      else seen.set(key, { code, uses: 1 });
    }
  }
  return [...seen.values()].filter((entry) => entry.uses * 2 > rows.length).map((e) => e.code);
}

/** How many workers the "+ Add staff" picker reads and draws at a time (release audit D-M6). */
export const PICKER_PAGE = 50;

/** What the picker's search box asks the database for. */
export interface PickerSearch {
  /** Each must be in the first or the last name. */
  words: string[];
  /** "THC-00873", "00873" or "873": that Employee ID, exactly. */
  employeeId: number | null;
}

/**
 * The picker's box, read for a narrow server search (go-live audit M2): it
 * used to filter the whole compliant directory in the browser, read off
 * `staff_directory_v`, which computes the weekly cap for every row only to
 * show a name. A number — bare or written "THC-00873" — is an Employee ID;
 * anything else is words, each matched in the first or the last name, so
 * "amara kalu" finds Amara Kalu. Characters PostgREST's filter syntax
 * reserves, and LIKE's own `%` and `_`, are dropped, never passed through:
 * only letters, digits, apostrophes and hyphens reach the query.
 */
export function pickerSearch(query: string): PickerSearch {
  const trimmed = query.trim();
  const id = /^(?:thc-?)?0*(\d{1,9})$/i.exec(trimmed);
  if (id) return { words: [], employeeId: Number(id[1]) };
  const words = trimmed
    .normalize('NFC')
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{M}\p{N}'’-]/gu, ''))
    .filter(Boolean)
    .slice(0, 4);
  return { words, employeeId: null };
}
