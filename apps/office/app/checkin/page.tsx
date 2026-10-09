import { Alert } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { loadMonitor } from './data';
import { parseLogQuery } from './log';
import { MonitorScreen } from './MonitorScreen';
import './checkin.css';

export const metadata = { title: 'Check In / Out · THC Back Office' };
/** The board is the state of the day; nothing about it may be cached. */
export const dynamic = 'force-dynamic';

/**
 * /checkin — §9.5, `wireframes/backoffice/checkin.html`.
 *
 * The densest operational screen in the product, and the one where a stale
 * number is worse than a missing one: a manager acts on it while the shift
 * is running.
 *
 * `?resolved=1` is the violation log's "Show resolved" and `?page=N` its
 * page: both are read by the query, not filtered in the browser (audit D50).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const log = parseLogQuery(await searchParams);
  const { rows, violations, unresolvedCount, hasMore, problem } = await loadMonitor(log);

  return (
    <OfficeShell
      activeHref="/checkin"
      title="Check In / Out"
      crumbs={
        <>
          live monitor · <b>{rows.length}</b> {rows.length === 1 ? 'shift' : 'shifts'} on the board
          · <b>{unresolvedCount}</b> unresolved {unresolvedCount === 1 ? 'violation' : 'violations'}{' '}
          · refreshes every 30 s
        </>
      }
    >
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
      <MonitorScreen rows={rows} violations={violations} log={log} hasMore={hasMore} />
    </OfficeShell>
  );
}
