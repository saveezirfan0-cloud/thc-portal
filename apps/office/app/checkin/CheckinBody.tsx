import { Alert } from '@thc/ui';
import type { LogQuery } from './log';
import { MonitorScreen } from './MonitorScreen';
import { monitorView } from './view';

/** The live monitor and violation log, streamed in behind the topbar by `page.tsx`. */
export async function CheckinBody({ log }: { log: LogQuery }) {
  const { rows, violations, hasMore, problem } = await monitorView(log);
  return (
    <>
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
      <MonitorScreen rows={rows} violations={violations} log={log} hasMore={hasMore} />
    </>
  );
}
