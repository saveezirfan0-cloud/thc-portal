import { RTW_CHECK_COLUMNS, parseRtwCheckRow } from './rtwCheck';
import type { RtwCheckRow } from './rtwCheck';

/**
 * Reads for the automated right-to-work check on the office's screens
 * (ADR-0025). Both are best-effort: a failed read shows the document as it
 * was before the automation existed, never a broken page.
 */

interface Query {
  select(columns: string): Query;
  eq(column: string, value: string): Query;
  in(column: string, values: readonly string[]): Query;
  then: PromiseLike<{ data: unknown; error: unknown }>['then'];
}
interface Client {
  from(table: string): { select(columns: string): Query };
  rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface RtwChecksRead {
  checks: RtwCheckRow[];
  /** settings.rtw_check.enabled — decides "Run check again" and the manual date. */
  enabled: boolean;
}

export async function loadRtwChecks(client: unknown, staffId: string): Promise<RtwChecksRead> {
  const supabase = client as Client;
  try {
    const [rows, enabled] = await Promise.all([
      supabase.from('rtw_checks_latest_v').select(RTW_CHECK_COLUMNS).eq('staff_id', staffId),
      supabase.rpc('rtw_check_enabled'),
    ]);
    const checks = rows.error
      ? []
      : ((rows.data as Record<string, unknown>[] | null) ?? [])
          .map(parseRtwCheckRow)
          .filter((r): r is RtwCheckRow => r !== null);
    return { checks, enabled: !enabled.error && enabled.data === true };
  } catch {
    return { checks: [], enabled: false };
  }
}

export async function loadRtwCheckEnabled(client: unknown): Promise<boolean> {
  try {
    const { data, error } = await (client as Client).rpc('rtw_check_enabled');
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * The latest check of each of these documents, keyed by document id — for
 * /compliance, whose queue view names the check but not what ADR-0041 added
 * to it (the recommendation, the suggested N8 text, the photo). One
 * `in('document_id', …)` read; best-effort, so a failure leaves the queue as
 * it was (the date typed by hand, an empty Reject box).
 */
export async function loadRtwChecksForDocuments(
  client: unknown,
  documentIds: readonly string[],
): Promise<Map<string, RtwCheckRow>> {
  const map = new Map<string, RtwCheckRow>();
  const ids = [...new Set(documentIds.filter(Boolean))];
  if (ids.length === 0) return map;
  try {
    const { data, error } = await (client as Client)
      .from('rtw_checks_latest_v')
      .select(RTW_CHECK_COLUMNS)
      .in('document_id', ids);
    if (error) return map;
    for (const raw of (data as Record<string, unknown>[] | null) ?? []) {
      const row = parseRtwCheckRow(raw);
      if (row) map.set(row.document_id, row);
    }
  } catch {
    return map;
  }
  return map;
}
