import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { currentOfficeRole } from '../_components/officeUser';
import { AutoRefresh } from '../_components/AutoRefresh';
import { officeCan } from '../_lib/permissions';
import { loadStaff, supabaseConfigured } from './data';
import { countPendingChangeRequests } from './requests/data';
import { StaffScreen } from './StaffScreen';

// Per-request data, and the screen reads its list state from the URL.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Staff · THC Back Office' };

/**
 * /staff — §9.6 and §4.5, `wireframes/backoffice/staff.html`.
 *
 * Read on the server. `staff` carries date of birth, address, NI number
 * and right-to-work state, and §1.7's anonymisation of a removed worker is
 * applied in the view, so nothing this screen holds could print a name a
 * GDPR removal was meant to retire.
 */
export default async function Page() {
  const [{ staff, students, problem }, pendingRequests, role] = await Promise.all([
    loadStaff(),
    // ADR-0045: "Change requests (N)". A failed count is null — never a
    // claimed 0 (audit D18), never an error over the directory.
    supabaseConfigured()
      ? cookies().then((jar) => countPendingChangeRequests(createClient(jar)))
      : Promise.resolve(0),
    currentOfficeRole(),
  ]);
  return (
    <>
      {/* Compliance, blocks and new starters change without the manager
          doing anything: re-read every 60 s (the whole directory and every
          face is re-read each time, go-live audit H4). Filters, search and ticked
          workers survive the refresh. */}
      <AutoRefresh everyMs={60_000} />
      <StaffScreen
        staff={staff}
        students={students}
        problem={problem}
        // `/staff?view=student` (the link /compliance uses for the completion
        // letter requirement's §4 report), the tab, search, filters and page
        // are read from the URL by the screen itself (release audit L1).
        pendingRequests={pendingRequests}
        // ADR-0082: tick workers and Send push — any login that may write.
        canMessage={officeCan(role, 'write')}
      />
    </>
  );
}
