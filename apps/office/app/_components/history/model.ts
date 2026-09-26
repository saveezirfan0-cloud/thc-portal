/**
 * The History tab / block on a record page (ADR-0055 · §1.7).
 *
 * Pure, and tested. The rows are `admin_record_history`'s
 * (20261001200300), which has `admin_activity`'s columns, so every word on
 * screen comes from the activity log's own helpers — a History entry and
 * the same entry on /activity read identically.
 */
import { entityHref } from '../../_lib/accounts';
import type { ActivityRow } from '../../activity/view-model';

export type HistoryRow = ActivityRow;

/** The records that have a History: the pages that show one. */
export const HISTORY_ENTITIES = ['staff', 'event', 'client'] as const;
export type HistoryEntity = (typeof HISTORY_ENTITIES)[number];

export function isHistoryEntity(value: unknown): value is HistoryEntity {
  return typeof value === 'string' && (HISTORY_ENTITIES as readonly string[]).includes(value);
}

/** Rows per load. "Older" asks for the next page on the log's id. */
export const HISTORY_PAGE = 25;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * What each record's History gathers, said under the title — so a manager
 * who does not find an entry knows where else it would be.
 */
export const HISTORY_SCOPE: Readonly<Record<HistoryEntity, string>> = {
  staff:
    'Everything recorded about this worker: their record, documents, bookings and Do-not-return entries.',
  event: 'Everything recorded about this event and the bookings on its role sections.',
  client:
    'Changes to this client, cancellations of its events, Do-not-return entries and its Client Portal logins. Bookings are on each event’s own history.',
};

/**
 * Where the Record cell links. Nowhere when the entry is about the record
 * already on screen — a link back to the same page is noise.
 */
export function historyHref(
  row: Pick<HistoryRow, 'entity' | 'entity_id'>,
  subject: { entity: HistoryEntity; id: string },
): string | null {
  if (row.entity === subject.entity && row.entity_id === subject.id) return null;
  return entityHref(row.entity, row.entity_id);
}

/** The id to ask for "Older" from, when the page came back full. */
export function nextBefore(rows: readonly Pick<HistoryRow, 'id'>[], limit: number): number | null {
  return rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
}

/** Appends an older page, dropping any row already shown (a double click). */
export function mergeOlder(
  shown: readonly HistoryRow[],
  older: readonly HistoryRow[],
): HistoryRow[] {
  const seen = new Set(shown.map((row) => row.id));
  return [...shown, ...older.filter((row) => !seen.has(row.id))];
}
