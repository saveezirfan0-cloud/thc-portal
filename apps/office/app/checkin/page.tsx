import { Alert } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { loadMonitor } from './data';
import { MonitorCrumbs } from './MonitorCrumbs';
import { MonitorScreen } from './MonitorScreen';
import { ViewerZone } from './ViewerZone';
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
  // The moment the board was read; `force-dynamic` plus the 30-second
  // refresh keep it honest. The crumb renders it in the reader's zone.
  const asOf = new Date().toISOString();

  return (
    <OfficeShell
      activeHref="/checkin"
      title="Check In / Out"
      crumbs={<MonitorCrumbs asOf={asOf} shifts={rows.length} unresolved={unresolved} />}
      // Check-in stamps, Breaks, the Due pill and the log's Time column are
      // all in the reader's own zone, so the topbar names it (§1.8) rather
      // than the shell's "All times UK" default.
      timezone={<ViewerZone />}
    >
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
      <MonitorScreen rows={rows} violations={violations} />
    </OfficeShell>
  );
}
