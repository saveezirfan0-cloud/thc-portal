import type { Grid, ParsedRow } from './types';
import {
  cellText,
  hhmmToHours,
  normHeader,
  parseBreakMin,
  parseClock,
  parseUkDate,
  splitStaffRef,
} from './values';

/**
 * Spreadsheet parsers (pure; the workbook is already a Grid). Read exactly,
 * so `confidence` is null; anything the reader cannot make sense of is a
 * `problem` on the row and the row is still returned — the database flags it
 * (no_hours, no_date, ...) and the office fixes it in review.
 */

export interface SheetParseResult {
  rows: ParsedRow[];
  /** Sheets the rows came from. */
  sheets: string[];
  /** File-level notes (a sheet skipped, nothing found). Never personal data. */
  problems: string[];
}

export interface TasterOptions {
  /** Week-commencing (ISO) to use when a row has no readable Start date. */
  weekCommencing?: string | null;
}

/** "WC 12.10.26 Oxford Circus.xlsx" / "w-c 12-10-26" -> 2026-10-12. */
export function weekFromFileName(fileName: string): string | null {
  const m = /\b(?:w\/?c|wc|w-c|w\.c\.?)\s*[-_ ]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i.exec(
    fileName,
  );
  return m ? parseUkDate(m[1]) : null;
}

const SUMMARY_SHEET = 'all employees';

function findHeader(
  rows: unknown[][],
  accept: (cols: Map<string, number>) => boolean,
): { index: number; cols: Map<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cols = new Map<string, number>();
    (rows[i] ?? []).forEach((cell, c) => {
      const key = normHeader(cell);
      if (key && !cols.has(key)) cols.set(key, c);
    });
    if (accept(cols)) return { index: i, cols };
  }
  return null;
}

function pick(cols: Map<string, number>, aliases: readonly string[]): number | null {
  for (const a of aliases) {
    const c = cols.get(a);
    if (c !== undefined) return c;
  }
  return null;
}

/**
 * Taster / All Taster export. The "All Employees" sheet has one row per
 * person for the week (hh:mm totals, no start/end): one shift row each,
 * dated the week commencing. Paid hours win over work hours. The per-person
 * sheets are only read when "All Employees" is missing (the alltaster
 * "Spud Force" variant), by the generic reader with the sheet name as the
 * person.
 */
export function parseTasterWorkbook(grids: Grid[], options: TasterOptions = {}): SheetParseResult {
  const problems: string[] = [];
  const summary = grids.find((g) => g.name.trim().toLowerCase() === SUMMARY_SHEET);

  if (summary) {
    const header = findHeader(
      summary.rows,
      (c) =>
        (c.has('first name') || c.has('name') || c.has('employee')) &&
        (c.has('total paid hours') || c.has('total work hours')),
    );
    if (header) {
      const { cols, index } = header;
      const first = pick(cols, ['first name']);
      const last = pick(cols, ['last name', 'surname']);
      const full = pick(cols, ['name', 'employee', 'full name']);
      const paid = pick(cols, ['total paid hours']);
      const work = pick(cols, ['total work hours']);
      const start = pick(cols, ['start date', 'week start', 'from']);
      const out: ParsedRow[] = [];
      for (let r = index + 1; r < summary.rows.length; r++) {
        const row = summary.rows[r] ?? [];
        const rawName =
          first !== null || last !== null
            ? `${first !== null ? cellText(row[first]) : ''} ${last !== null ? cellText(row[last]) : ''}`
            : full !== null
              ? cellText(row[full])
              : '';
        if (!rawName.trim() || /^total/i.test(rawName.trim())) continue;
        const { name, ref } = splitStaffRef(rawName);

        const paidRaw = paid !== null ? row[paid] : null;
        const workRaw = work !== null ? row[work] : null;
        const paidHours = hhmmToHours(paidRaw);
        const workHours = hhmmToHours(workRaw);
        const rowProblems: string[] = [];
        const hours = paidHours ?? workHours;
        if (hours === null) {
          const blank = (v: unknown) => cellText(v) === '';
          if (blank(paidRaw) && blank(workRaw)) continue; // nothing worked, nothing to bill
          rowProblems.push('unreadable_hours');
        } else if (hours === 0) {
          continue;
        }

        const date =
          (start !== null ? parseUkDate(row[start]) : null) ?? options.weekCommencing ?? null;
        if (!date) rowProblems.push('no_week_date');

        out.push({
          staffName: name,
          staffRef: ref,
          workDate: date,
          roleName: null,
          startTime: null,
          endTime: null,
          breakMin: 0,
          hours,
          confidence: null,
          original: {
            name: rawName.trim(),
            paidHours: cellText(paidRaw),
            workHours: cellText(workRaw),
            startDate: start !== null ? cellText(row[start]) : '',
          },
          source: { type: 'excel', sheet: summary.name, row: r + 1 },
          problems: rowProblems,
        });
      }
      return { rows: out, sheets: [summary.name], problems };
    }
    problems.push('all_employees_header_not_found');
  }

  // No usable summary: the per-person sheets (Spud Force variant).
  const out: ParsedRow[] = [];
  const sheets: string[] = [];
  for (const g of grids) {
    if (g === summary) continue;
    const res = parseGenericSheet(g, {
      fallbackName: g.name,
      weekCommencing: options.weekCommencing ?? null,
    });
    if (res.rows.length) {
      out.push(...res.rows);
      sheets.push(g.name);
    }
  }
  if (!out.length) problems.push('no_rows_found');
  return { rows: out, sheets, problems };
}

export interface GenericOptions {
  /** Person's name when the sheet has no name column (a per-employee sheet). */
  fallbackName?: string;
  /** Date for rows with none (a weekly sheet). */
  weekCommencing?: string | null;
}

const A = {
  first: ['first name', 'firstname', 'forename'],
  last: ['last name', 'lastname', 'surname'],
  name: [
    'name',
    'staff name',
    'employee',
    'employee name',
    'worker',
    'full name',
    'staff member',
    'staff',
  ],
  ref: [
    'staff id',
    'id',
    'employee id',
    'emp id',
    'ref',
    'staff ref',
    'payroll no',
    'payroll number',
    'employee number',
  ],
  date: ['date', 'work date', 'shift date', 'day', 'w c date', 'wc date', 'w c', 'start date'],
  role: ['role', 'position', 'job', 'job title', 'job role', 'department'],
  start: ['start', 'start time', 'time in', 'in', 'clock in', 'from', 'shift start', 'begin'],
  end: [
    'end',
    'end time',
    'finish',
    'finish time',
    'time out',
    'out',
    'clock out',
    'to',
    'shift end',
  ],
  brk: [
    'break',
    'breaks',
    'break min',
    'break mins',
    'break minutes',
    'unpaid break',
    'unpaid breaks',
    'break duration',
  ],
  hours: [
    'hours',
    'total hours',
    'paid hours',
    'total paid hours',
    'total work hours',
    'hrs',
    'duration',
    'total',
  ],
} as const;

/**
 * A per-shift sheet: header detection with aliases (Name, Staff ID, Date,
 * Role, Start, End, Break, or an Hours total). Hours are set on a row only
 * when it has no readable start and end; otherwise the database computes
 * them from the times.
 */
export function parseGenericSheet(grid: Grid, options: GenericOptions = {}): SheetParseResult {
  const header = findHeader(grid.rows, (c) => {
    const hasName =
      pick(c, A.name) !== null || pick(c, A.first) !== null || options.fallbackName !== undefined;
    const hasWhen =
      (pick(c, A.date) !== null || options.weekCommencing) &&
      (pick(c, A.start) !== null || pick(c, A.hours) !== null);
    return hasName && !!hasWhen;
  });
  if (!header) return { rows: [], sheets: [], problems: ['header_not_found'] };

  const { cols, index } = header;
  const ci = {
    first: pick(cols, A.first),
    last: pick(cols, A.last),
    name: pick(cols, A.name),
    ref: pick(cols, A.ref),
    date: pick(cols, A.date),
    role: pick(cols, A.role),
    start: pick(cols, A.start),
    end: pick(cols, A.end),
    brk: pick(cols, A.brk),
    hours: pick(cols, A.hours),
  };
  const rows: ParsedRow[] = [];
  for (let r = index + 1; r < grid.rows.length; r++) {
    const row = grid.rows[r] ?? [];
    const get = (c: number | null) => (c === null ? '' : row[c]);
    const rawName =
      ci.first !== null
        ? `${cellText(get(ci.first))} ${cellText(get(ci.last))}`.trim()
        : ci.name !== null
          ? cellText(get(ci.name))
          : (options.fallbackName ?? '');
    if (/^total/i.test(rawName)) continue;

    const dateRaw = get(ci.date);
    const startRaw = get(ci.start);
    const endRaw = get(ci.end);
    const hoursRaw = get(ci.hours);
    if (
      [dateRaw, startRaw, endRaw, hoursRaw].every((v) => cellText(v) === '') ||
      ((ci.name !== null || ci.first !== null) && rawName === '')
    ) {
      continue;
    }

    const problems: string[] = [];
    const date = parseUkDate(dateRaw) ?? options.weekCommencing ?? null;
    if (!date) problems.push('unreadable_date');
    const startTime = cellText(startRaw) ? parseClock(startRaw) : null;
    const endTime = cellText(endRaw) ? parseClock(endRaw) : null;
    if (cellText(startRaw) && !startTime) problems.push('unreadable_start');
    if (cellText(endRaw) && !endTime) problems.push('unreadable_end');
    const brk = parseBreakMin(get(ci.brk));
    if (brk === null) problems.push('unreadable_break');
    const hasTimes = startTime !== null && endTime !== null;
    let hours: number | null = null;
    if (!hasTimes) {
      hours = hhmmToHours(hoursRaw);
      if (hours === null && cellText(hoursRaw)) problems.push('unreadable_hours');
    }
    const { name, ref: bracketRef } = splitStaffRef(rawName);
    const refCell = cellText(get(ci.ref));
    const role = cellText(get(ci.role));
    rows.push({
      staffName: name,
      staffRef: refCell || bracketRef,
      workDate: date,
      roleName: role || null,
      startTime,
      endTime,
      breakMin: brk ?? 0,
      hours,
      confidence: null,
      original: {
        name: rawName,
        date: cellText(dateRaw),
        start: cellText(startRaw),
        end: cellText(endRaw),
        break: cellText(get(ci.brk)),
        hours: cellText(hoursRaw),
        role,
      },
      source: { type: 'excel', sheet: grid.name, row: r + 1 },
      problems,
    });
  }
  return {
    rows,
    sheets: rows.length ? [grid.name] : [],
    problems: rows.length ? [] : ['no_rows_found'],
  };
}

/**
 * Which reader for a workbook: the Taster export when it has an "All
 * Employees" sheet, else the generic per-shift reader on every sheet, else
 * the Taster per-person fallback.
 */
export function parseWorkbook(grids: Grid[], fileName: string): SheetParseResult {
  const weekCommencing = weekFromFileName(fileName);
  if (grids.some((g) => g.name.trim().toLowerCase() === SUMMARY_SHEET)) {
    return parseTasterWorkbook(grids, { weekCommencing });
  }
  const rows: ParsedRow[] = [];
  const sheets: string[] = [];
  for (const g of grids) {
    const res = parseGenericSheet(g, { weekCommencing });
    rows.push(...res.rows);
    sheets.push(...res.sheets);
  }
  if (rows.length) return { rows, sheets, problems: [] };
  return parseTasterWorkbook(grids, { weekCommencing });
}
