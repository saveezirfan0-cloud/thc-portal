/**
 * /activity/export — the activity log as CSV (ADR-0055, §1.7).
 *
 * The same six things the screen shows, in the same words: the stamp is an
 * audit stamp, so UK time only (§1.8), written `YYYY-MM-DD HH:MM` so a
 * spreadsheet sorts it without being told how. RFC 4180 with CRLF and a
 * BOM (Excel then opens it as UTF-8 and an accented name survives), and
 * every cell defused against formula injection with the §9.9 CSVs' own
 * `textCell` — names, reasons and event titles are typed by people.
 *
 * Built in pieces (head, rows, tail) because the route streams: the file
 * can run to EXPORT_CAP rows read a page at a time.
 */
import { textCell } from '@thc/pdf/csv';
import { actionLabel, entityLabel } from '../_lib/accounts';
import {
  type ActivityFilters,
  type ActivityRow,
  EXPORT_CAP,
  actorName,
  describe,
} from './view-model';

export { EXPORT_CAP };

const BOM = '﻿';
const EOL = '\r\n';

export const ACTIVITY_CSV_COLUMNS: readonly {
  header: string;
  value: (row: ActivityRow) => string;
}[] = [
  { header: 'When (UK time)', value: (row) => ukStamp(row.at) },
  { header: 'Who', value: (row) => actorName(row) },
  { header: 'Action', value: (row) => actionLabel(row.action) },
  { header: 'Area', value: (row) => entityLabel(row.entity) },
  { header: 'Record', value: (row) => row.entity_label ?? '' },
  { header: 'Details', value: (row) => describe(row).join(' · ') },
];

/** `2026-09-23 14:05` in Europe/London, whatever zone the server runs in. */
export function ukStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** One cell: formula-defused, then quoted when it holds , " CR LF or edge spaces. */
export function csvCell(value: string): string {
  const cell = textCell(value);
  return /[",\r\n]/.test(cell) || cell !== cell.trim() ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function line(cells: readonly string[]): string {
  return cells.map(csvCell).join(',') + EOL;
}

/** The BOM and the header row: the first chunk of the stream. */
export function activityCsvHead(): string {
  return BOM + line(ACTIVITY_CSV_COLUMNS.map((column) => column.header));
}

export function activityCsvRows(rows: readonly ActivityRow[]): string {
  return rows.map((row) => line(ACTIVITY_CSV_COLUMNS.map((column) => column.value(row)))).join('');
}

/**
 * The last line when the file stopped at the cap. In the first column, so
 * it is the first thing a reader sees at the bottom of the sheet.
 */
export function activityCsvTruncated(cap: number = EXPORT_CAP): string {
  return line([
    `Truncated: only the newest ${cap.toLocaleString('en-GB')} entries matching these filters are in this file. Narrow the period, area or person to export the rest.`,
  ]);
}

/** A read that failed part-way: said in the file, since the status is already sent. */
export function activityCsvFailed(message: string): string {
  return line([`Export stopped early: ${message}. The rows above are complete; try again.`]);
}

/** The whole file at once — what the stream adds up to. */
export function activityCsv(rows: readonly ActivityRow[], truncated = false): string {
  return activityCsvHead() + activityCsvRows(rows) + (truncated ? activityCsvTruncated() : '');
}

/** `thc-activity-log-2026-09-25.csv`, with the area when one is picked. */
export function activityFileName(filters: Pick<ActivityFilters, 'entity'>, now = new Date()) {
  const day = ukStamp(now.toISOString()).slice(0, 10);
  const area = filters.entity
    ? `-${filters.entity.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
    : '';
  return `thc-activity-log${area}-${day}.csv`;
}
