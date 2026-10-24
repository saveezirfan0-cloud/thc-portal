/**
 * ADR-0210 timesheet extraction: the shapes shared by the parsers.
 * Nothing here prices a row — hours/rate/amount/issues are the database's
 * (timesheet_shift_compute()).
 */

/** One reading of one timesheet row, before it is a database row. */
export interface ParsedRow {
  staffName: string;
  staffRef: string | null;
  /** ISO yyyy-mm-dd, or null when unreadable (the DB flags `no_date`). */
  workDate: string | null;
  roleName: string | null;
  /** 'HH:MM' 24-hour, or null (weekly totals carry none). */
  startTime: string | null;
  endTime: string | null;
  breakMin: number;
  /** Set directly only for rows with no start/end (weekly totals). */
  hours: number | null;
  /** 0..1, null for a spreadsheet (read exactly). */
  confidence: number | null;
  /** The raw reading, for the reviewer. */
  original: Record<string, unknown>;
  source:
    | { type: 'excel'; sheet: string; row: number }
    | { type: 'pdf-table'; page: number; bbox?: number[] };
  /** Problems found while reading (not the DB's issues). */
  problems: string[];
}

/** A worksheet as plain values, 1-based row numbers are index + 1. */
export interface Grid {
  name: string;
  rows: unknown[][];
}
