import { Alert } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { loadMonitor } from './data';
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
 */
export default async function Page() {
  const { rows, violations, problem } = await loadMonitor();
  const unresolved = violations.filter((v) => !v.resolved).length;

  return (
    <OfficeShell
      activeHref="/checkin"
      title="Check In / Out"
      crumbs={
        <>
          live monitor · <b>{rows.length}</b> {rows.length === 1 ? 'shift' : 'shifts'} on the board
          · <b>{unresolved}</b> unresolved {unresolved === 1 ? 'violation' : 'violations'} ·
          refreshes every 30 s
        </>
      }
    >
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
      <MonitorScreen rows={rows} violations={violations} />
    </OfficeShell>
  );
}
