import { Suspense } from 'react';
import { SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { CheckinBody } from './CheckinBody';
import { parseLogQuery } from './log';
import { monitorView } from './view';
import './checkin.css';

export const metadata = { title: 'Check In / Out · THC Back Office' };
/** The board is the state of the day; nothing about it may be cached. */
export const dynamic = 'force-dynamic';

/** The topbar's counts need the board, so they stream with it. */
async function Counts({ log }: { log: ReturnType<typeof parseLogQuery> }) {
  const { rows, unresolvedCount } = await monitorView(log);
  return (
    <>
      live monitor · <b>{rows.length}</b> {rows.length === 1 ? 'shift' : 'shifts'} on the board ·{' '}
      <b>{unresolvedCount}</b> unresolved {unresolvedCount === 1 ? 'violation' : 'violations'} ·
      refreshes every 30 s
    </>
  );
}

/**
 * /checkin — §9.5, `wireframes/backoffice/checkin.html`.
 *
 * The densest operational screen in the product, and the one where a stale
 * number is worse than a missing one: a manager acts on it while the shift
 * is running.
 *
 * `?resolved=1` is the violation log's "Show resolved" and `?page=N` its
 * page: both are read by the query, not filtered in the browser (audit D50).
 *
 * The topbar and chrome paint at once; the board streams in behind a
 * skeleton. One `OfficeShell`, outside the Suspense (see /dashboard).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const log = parseLogQuery(await searchParams);

  return (
    <OfficeShell
      activeHref="/checkin"
      title="Check In / Out"
      crumbs={
        <Suspense fallback={<>live monitor</>}>
          <Counts log={log} />
        </Suspense>
      }
    >
      <Suspense
        fallback={
          <SkeletonScreen label="Loading check-ins">
            <SkeletonToolbar controls={3} />
            <SkeletonPanel rows={8} />
          </SkeletonScreen>
        }
      >
        <CheckinBody log={log} />
      </Suspense>
    </OfficeShell>
  );
}
