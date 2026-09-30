import { RTW_CHECK_COLUMNS, parseRtwCheckRow } from '../_lib/rtwCheck';
import type { RtwCheckRow } from '../_lib/rtwCheck';
import { loadRtwChecksForDocuments } from '../_lib/rtwCheckData';
import { EMPTY_MONITOR } from './checks';
import type { CheckMonitorData, MonitorCheck, RunnerRun, WaitingDoc } from './checks';

/**
 * Reads for the gov.uk check monitor (ADR-0025). Every source is an
 * admin-read table or a security_invoker view, so a session that is not the
 * office's sees nothing — the database is the gate, as on the rest of
 * /compliance. Best-effort: a failed read leaves the monitor saying so, never
 * a broken page.
 *
 * `rtw_checks_latest_v` is the newest check of each share-code document, so a
 * worker who re-enters a code shows once per code, and a check the runner
 * retries is one row whose attempts count climbs.
 */

const LIMIT = 100;

interface Result {
  data: unknown;
  error: { message: string } | null;
}
interface Query extends PromiseLike<Result> {
  select(columns: string): Query;
  eq(column: string, value: string): Query;
  in(column: string, values: readonly string[]): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
}
interface Client {
  from(table: string): { select(columns: string): Query };
}

const rowsOf = (result: Result): Record<string, unknown>[] =>
  result.error ? [] : ((result.data as Record<string, unknown>[] | null) ?? []);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export async function loadCheckMonitor(client: unknown, now: string): Promise<CheckMonitorData> {
  const supabase = client as Client;
  try {
    const [checksRead, docsRead, runRead] = await Promise.all([
      supabase
        .from('rtw_checks_latest_v')
        .select(RTW_CHECK_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(LIMIT),
      // A share code filed and waiting: no check started for it (yet).
      supabase
        .from('compliance_docs')
        .select('id, staff_id, uploaded_at')
        .eq('doc_type', 'share_code_report')
        .eq('review_status', 'pending')
        .order('uploaded_at', { ascending: false })
        .limit(LIMIT),
      supabase
        .from('job_runs')
        .select('started_at, ok, counts, error')
        .eq('job', 'rtw-check')
        .order('started_at', { ascending: false })
        .limit(1),
    ]);

    if (checksRead.error) return { ...EMPTY_MONITOR, now, problem: checksRead.error.message };

    const checks: RtwCheckRow[] = rowsOf(checksRead)
      .map(parseRtwCheckRow)
      .filter((row): row is RtwCheckRow => row !== null);
    const checked = new Set(checks.map((row) => row.document_id));
    // A pending document older than the newest 100 checks may have a check
    // this read did not return; ask for those before calling it "waiting".
    const pendingDocs = rowsOf(docsRead).filter((doc) => !checked.has(text(doc['id'])));
    const late = await loadRtwChecksForDocuments(
      client,
      pendingDocs.map((doc) => text(doc['id'])),
    );
    const waitingDocs = pendingDocs.filter((doc) => !late.has(text(doc['id'])));
    const allChecks = [...checks, ...late.values()];

    const staffIds = [
      ...new Set([
        ...allChecks.map((row) => row.staff_id),
        ...waitingDocs.map((doc) => text(doc['staff_id'])),
      ]),
    ].filter(Boolean);
    const names = new Map<string, string>();
    if (staffIds.length > 0) {
      const staff = await supabase
        .from('staff')
        .select('id, first_name, last_name')
        .in('id', staffIds);
      for (const person of rowsOf(staff)) {
        names.set(
          text(person['id']),
          `${text(person['first_name'])} ${text(person['last_name'])}`.trim(),
        );
      }
    }
    const nameOf = (id: string) => names.get(id) || 'Unknown';

    const monitor: MonitorCheck[] = allChecks
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((check) => ({ check, name: nameOf(check.staff_id) }));
    const waiting: WaitingDoc[] = waitingDocs.map((doc) => ({
      docId: text(doc['id']),
      staffId: text(doc['staff_id']),
      name: nameOf(text(doc['staff_id'])),
      filedAt: text(doc['uploaded_at']),
    }));

    const run = rowsOf(runRead)[0];
    const lastRun: RunnerRun | null = run
      ? {
          startedAt: text(run['started_at']),
          ok: run['ok'] === true,
          counts:
            run['counts'] && typeof run['counts'] === 'object'
              ? Object.fromEntries(
                  Object.entries(run['counts'] as Record<string, unknown>).filter(
                    (entry): entry is [string, number] => typeof entry[1] === 'number',
                  ),
                )
              : {},
          error: typeof run['error'] === 'string' && run['error'] !== '' ? run['error'] : null,
        }
      : null;

    return { checks: monitor, waiting, lastRun, now, problem: null };
  } catch (error) {
    return {
      ...EMPTY_MONITOR,
      now,
      problem: error instanceof Error ? error.message : 'The checks could not be read.',
    };
  }
}
