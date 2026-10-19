import { Suspense, cache } from 'react';
import { OfficeShell } from '../_components/OfficeShell';
import { staffUrlIsOffice } from '../_lib/staffUrl';
import { ApplyFormLink, BoardSkeleton, OnboardingCrumbs } from './chrome';
import { loadBoard } from './data';
import { OnboardingBoard } from './OnboardingBoard';
import { boardCounts } from './view-model';
import './onboarding.css';

export const metadata = { title: 'Onboarding · THC Back Office' };
export const dynamic = 'force-dynamic';

/** The pipeline, read once per request: the topbar's counts and the board share it. */
const pipeline = cache(loadBoard);

/** The topbar's counts need the pipeline, so they stream with it. */
async function Crumbs() {
  const data = await pipeline();
  const counts = boardCounts(data.candidates, data.returning);
  return <OnboardingCrumbs active={counts.active} rejected={counts.rejected} />;
}

async function Board({ applyUrl }: { applyUrl: string | null }) {
  const data = await pipeline();
  // The reference instant for "N d in stage", taken once, so the whole
  // board is judged against the same moment.
  return <OnboardingBoard bare data={data} now={new Date().toISOString()} applyUrl={applyUrl} />;
}

/**
 * /onboarding — the candidate pipeline (§2.2, §2.12),
 * `wireframes/backoffice/onboarding.html` (BO3).
 *
 * Read on the server; the toggle, search and role filter are the
 * client's.
 *
 * The topbar and chrome paint at once; the pipeline (`onboarding_candidates_v`,
 * the heaviest read on the screen — go-live audit H3) streams in behind a
 * skeleton of the six columns, and its counts into the topbar behind their
 * own boundary (ADR-0161, the /dashboard pattern of ADR-0109). One
 * `OfficeShell`, outside every Suspense. The toggle, search and filters live
 * in the URL but change through the History API (`useListQuery`), never a
 * router navigation, so no boundary here sits under a query-only navigation;
 * the page reads no searchParams and has no 404.
 */
export default function Page() {
  const url = applyUrl();
  return (
    <OfficeShell
      activeHref="/onboarding"
      title="Onboarding"
      crumbs={
        <Suspense fallback={<>candidate pipeline</>}>
          <Crumbs />
        </Suspense>
      }
      actions={<ApplyFormLink url={url} />}
    >
      <Suspense fallback={<BoardSkeleton />}>
        <Board applyUrl={url} />
      </Suspense>
    </OfficeShell>
  );
}

/**
 * The public /apply form lives on the Staff App, a different deployment, so
 * its origin is configuration (NEXT_PUBLIC_STAFF_URL) — the same guard as
 * `staffOrigin()` in ./actions.ts. Unset in production means no button,
 * not a button to 127.0.0.1 on the manager's own machine.
 */
function applyUrl(): string | null {
  const explicit = process.env['NEXT_PUBLIC_STAFF_URL'];
  if (explicit) return staffUrlIsOffice() ? null : `${explicit.replace(/\/$/, '')}/apply`;
  if (process.env.NODE_ENV === 'production') return null;
  return 'http://127.0.0.1:3001/apply';
}
