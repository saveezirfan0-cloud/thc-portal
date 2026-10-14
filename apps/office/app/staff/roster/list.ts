/**
 * The invite list's filter and export (/staff/roster, ADR-0138): who is on
 * it, cut by group, by where they stand, and by a search, and the same cut
 * as a CSV. Pure, so the screen, the export route and the vitest suite all
 * read the one definition.
 *
 * Where a row stands, from the report (ADR-0123), first match wins:
 * - **applied**: somebody applied with the listed email and the row is kept
 *   for their Payroll ID;
 * - **match**: nobody applied with that email, but somebody of the same name
 *   applied under another one ("Possible match"), so they probably have;
 * - **waiting**: neither: invited, not applied yet.
 */
import { textCell } from '@thc/pdf/csv';
import type { RosterEntry } from './data';
import type { RosterMatch, RosterReportData } from './report';

export type RosterGroupFilter = 'all' | 'spudbros' | 'thc';
export type RosterStanding = 'waiting' | 'match' | 'applied';
export type RosterStandingFilter = 'all' | RosterStanding;

export const GROUP_FILTERS: readonly RosterGroupFilter[] = ['all', 'spudbros', 'thc'];
export const STANDING_FILTERS: readonly RosterStandingFilter[] = [
  'all',
  'waiting',
  'match',
  'applied',
];

/** The filter's keys in the address bar, so a filtered list can be shared and exported. */
export const ROSTER_QUERY = { grp: 'all', status: 'all', q: '' } as const satisfies Record<
  string,
  string
>;

export const GROUP_LABEL = { spudbros: 'SpudBros Express', thc: 'THC' } as const;

export const STANDING_LABEL: Readonly<Record<RosterStanding, string>> = {
  waiting: 'Not applied',
  match: 'Possible match',
  applied: 'Applied · no Payroll ID',
};

export interface RosterFilter {
  grp: RosterGroupFilter;
  status: RosterStandingFilter;
  q: string;
}

/** The filter from a query string (the route) or the hook's values (the screen); anything unknown reads as "all". */
export function parseRosterFilter(values: {
  grp?: string | null;
  status?: string | null;
  q?: string | null;
}): RosterFilter {
  const grp = values.grp ?? 'all';
  const status = values.status ?? 'all';
  return {
    grp: (GROUP_FILTERS as readonly string[]).includes(grp) ? (grp as RosterGroupFilter) : 'all',
    status: (STANDING_FILTERS as readonly string[]).includes(status)
      ? (status as RosterStandingFilter)
      : 'all',
    q: (values.q ?? '').trim(),
  };
}

/** Each row's standing and, for a possible match, who applied under the other email. */
export interface RosterIndex {
  standing(row: RosterEntry): RosterStanding;
  match(row: RosterEntry): RosterMatch | undefined;
}

export function rosterIndex(report: RosterReportData | null): RosterIndex {
  const applied = new Set(report?.applied ?? []);
  const matches = new Map<string, RosterMatch>();
  for (const m of report?.matches ?? []) if (!matches.has(m.entryId)) matches.set(m.entryId, m);
  return {
    standing: (row) =>
      applied.has(row.id) ? 'applied' : matches.has(row.id) ? 'match' : 'waiting',
    match: (row) => matches.get(row.id),
  };
}

function fullName(row: RosterEntry): string {
  return [row.first_name, row.last_name].filter(Boolean).join(' ');
}

function matchesSearch(row: RosterEntry, q: string): boolean {
  if (q === '') return true;
  const needle = q.toLowerCase();
  return [row.email, fullName(row), row.payroll_id ?? ''].some((v) =>
    v.toLowerCase().includes(needle),
  );
}

/** The rows the filter keeps, in the order given. */
export function filterRoster(
  rows: readonly RosterEntry[],
  filter: RosterFilter,
  index: RosterIndex,
): RosterEntry[] {
  return rows.filter(
    (row) =>
      (filter.grp === 'all' || row.grp === filter.grp) &&
      (filter.status === 'all' || index.standing(row) === filter.status) &&
      matchesSearch(row, filter.q),
  );
}

/** How many rows each standing has within the chosen group, for the filter's labels. */
export function standingCounts(
  rows: readonly RosterEntry[],
  grp: RosterGroupFilter,
  index: RosterIndex,
): Record<RosterStandingFilter, number> {
  const counts = { all: 0, waiting: 0, match: 0, applied: 0 };
  for (const row of rows) {
    if (grp !== 'all' && row.grp !== grp) continue;
    counts.all += 1;
    counts[index.standing(row)] += 1;
  }
  return counts;
}

/** Surname, then first name, then email: how a spreadsheet of people reads. */
export function bySurname(a: RosterEntry, b: RosterEntry): number {
  const key = (r: RosterEntry) =>
    [r.last_name ?? '', r.first_name ?? '', r.email].map((v) => v.toLowerCase());
  const [ka, kb] = [key(a), key(b)];
  for (let i = 0; i < ka.length; i++) {
    const order = ka[i]!.localeCompare(kb[i]!, 'en-GB');
    if (order !== 0) return order;
  }
  return 0;
}

const BOM = '﻿';
const EOL = '\r\n';

/** `2026-10-08` in Europe/London. */
function ukDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export const ROSTER_CSV_COLUMNS: readonly {
  header: string;
  value: (row: RosterEntry, index: RosterIndex, report: RosterReportData | null) => string;
}[] = [
  { header: 'First name', value: (r) => r.first_name ?? '' },
  { header: 'Last name', value: (r) => r.last_name ?? '' },
  { header: 'Email', value: (r) => r.email },
  { header: 'Payroll ID', value: (r) => r.payroll_id ?? '' },
  { header: 'Group', value: (r) => GROUP_LABEL[r.grp] },
  { header: 'Status', value: (r, i) => STANDING_LABEL[i.standing(r)] },
  { header: 'Applied as', value: (r, i) => i.match(r)?.staffName ?? '' },
  { header: 'Applied with email', value: (r, i) => i.match(r)?.staffEmail ?? '' },
  { header: 'Reminders sent', value: (r, _i, rep) => String(rep?.reminders[r.email]?.sent ?? 0) },
  {
    header: 'Last reminder (UK)',
    value: (r, _i, rep) => ukDate(rep?.reminders[r.email]?.lastSentAt ?? null),
  },
  {
    header: 'Reminder not delivered',
    value: (r, _i, rep) => rep?.reminders[r.email]?.lastError ?? '',
  },
  { header: 'Invited on (UK)', value: (r) => ukDate(r.loaded_at) },
];

/** One cell: formula-defused, then quoted when it holds , " CR LF or edge spaces. */
function csvCell(value: string): string {
  const cell = textCell(value);
  return /[",\r\n]/.test(cell) || cell !== cell.trim() ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/**
 * The CSV: RFC 4180 with CRLF and a BOM, so Excel opens it as UTF-8 and an
 * accented name survives. Names and emails are typed by people, so every
 * cell is defused against formula injection.
 */
export function rosterCsv(
  rows: readonly RosterEntry[],
  index: RosterIndex,
  report: RosterReportData | null,
): string {
  const lines = [ROSTER_CSV_COLUMNS.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows)
    lines.push(ROSTER_CSV_COLUMNS.map((c) => csvCell(c.value(row, index, report))).join(','));
  return BOM + lines.join(EOL) + EOL;
}

/** `invite-list-spudbros-not-applied-2026-10-14.csv`. */
export function rosterFileName(filter: RosterFilter, now: Date = new Date()): string {
  const parts = ['invite-list'];
  if (filter.grp !== 'all') parts.push(filter.grp);
  if (filter.status === 'waiting') parts.push('not-applied');
  else if (filter.status === 'match') parts.push('possible-match');
  else if (filter.status === 'applied') parts.push('applied-no-payroll-id');
  if (filter.q !== '') parts.push('search');
  parts.push(ukDate(now.toISOString()));
  return `${parts.join('-')}.csv`;
}

/** The export link for the filter on screen. */
export function rosterExportHref(filter: RosterFilter): string {
  const params = new URLSearchParams();
  if (filter.grp !== 'all') params.set('grp', filter.grp);
  if (filter.status !== 'all') params.set('status', filter.status);
  if (filter.q !== '') params.set('q', filter.q);
  const query = params.toString();
  return `/staff/roster/export${query ? `?${query}` : ''}`;
}
