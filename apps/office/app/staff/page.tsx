import { Suspense, cache } from 'react';
import { cookies } from 'next/headers';
import { SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { createClient } from '@thc/db/server';
import { OfficeShell } from '../_components/OfficeShell';
import { currentOfficeRole } from '../_components/officeUser';
import { AutoRefresh } from '../_components/AutoRefresh';
import { officeCan } from '../_lib/permissions';
import { ChangeRequestsLink, StaffActions, StaffCrumbs, directoryCounts } from './chrome';
import { loadStaff, supabaseConfigured } from './data';
import { countPendingChangeRequests } from './requests/data';
import { StaffScreen } from './StaffScreen';

// Per-request data, and the screen reads its list state from the URL.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Staff · THC Back Office' };

/**
 * The directory, read once per request: the topbar's counts and the list
 * below share it. `cache` holds for one render only, so nothing is shared
 * between managers or between refreshes.
 */
const directory = cache(loadStaff);

/** The topbar's counts need the directory, so they stream with it. */
async function Crumbs() {
  const { staff } = await directory();
  return <StaffCrumbs counts={directoryCounts(staff)} />;
}

/**
 * ADR-0045: "Change requests (N)". A failed count is null — never a
 * claimed 0 (audit D18), never an error over the directory.
 */
async function PendingRequests() {
  const count = supabaseConfigured()
    ? await cookies().then((jar) => countPendingChangeRequests(createClient(jar)))
    : 0;
  return <ChangeRequestsLink count={count} />;
}

async function Directory() {
  const [{ staff, students, problem }, role] = await Promise.all([
    directory(),
    currentOfficeRole(),
  ]);
  return (
    <StaffScreen
      bare
      staff={staff}
      students={students}
      problem={problem}
      // ADR-0082: tick workers and Send push — any login that may write.
      canMessage={officeCan(role, 'write')}
    />
  );
}

/**
 * /staff — §9.6 and §4.5, `wireframes/backoffice/staff.html`.
 *
 * Read on the server. `staff` carries date of birth, address, NI number
 * and right-to-work state, and §1.7's anonymisation of a removed worker is
 * applied in the view, so nothing this screen holds could print a name a
 * GDPR removal was meant to retire.
 *
 * The topbar and chrome paint at once; the directory (`staff_directory_v`,
 * every worker with their weekly cap) streams in behind a skeleton, and the
 * counts and the change-request number into the topbar behind their own
 * boundaries (ADR-0161, the /dashboard pattern of ADR-0109). One
 * `OfficeShell`, outside every Suspense. The screen's tab, search, filters
 * and page live in the URL but change through the History API, never a
 * router navigation (`useListQuery`), so no boundary here sits under a
 * query-only navigation; the page reads no searchParams and has no 404.
 */
export default function Page() {
  return (
    <OfficeShell
      activeHref="/staff"
      title="Staff"
      crumbs={
        <Suspense fallback={<>directory</>}>
          <Crumbs />
        </Suspense>
      }
      actions={
        <StaffActions
          requests={
            <Suspense fallback={<ChangeRequestsLink />}>
              <PendingRequests />
            </Suspense>
          }
        />
      }
    >
      {/* Compliance, blocks and new starters change without the manager
          doing anything: re-read every 60 s. Filters, search and ticked
          workers survive the refresh; the faces keep their signed links
          (_lib/photos.ts), so nothing is downloaded again. */}
      <AutoRefresh everyMs={60_000} />
      <Suspense
        fallback={
          <SkeletonScreen label="Loading the staff directory">
            <SkeletonToolbar controls={4} />
            <SkeletonPanel rows={8} avatar />
          </SkeletonScreen>
        }
      >
        <Directory />
      </Suspense>
    </OfficeShell>
  );
}
