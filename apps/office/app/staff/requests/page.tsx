import { AutoRefresh } from '../../_components/AutoRefresh';
import { currentOfficeRole } from '../../_components/officeUser';
import { officeCan } from '../../_lib/permissions';
import { loadRequestsPage } from './data';
import { RequestsScreen } from './RequestsScreen';

export const metadata = { title: 'Change requests · Staff · THC Back Office' };

// A queue read per request with the manager's session — never prerendered.
export const dynamic = 'force-dynamic';

/**
 * /staff/requests — the office's queue for the name, photo and date of
 * birth §10.1 locks (ADR-0045, ADR-0070), `wireframes/backoffice/change-requests.html`.
 *
 * Read on the server through `office_profile_change_requests()`, which
 * refuses anyone but the office and names the manager on a decided row.
 * A static segment, so Next.js serves it ahead of `/staff/[id]`.
 */
export default async function Page() {
  const [data, role] = await Promise.all([loadRequestsPage(), currentOfficeRole()]);
  return (
    <>
      <AutoRefresh />
      <RequestsScreen
        pending={data.pending}
        decided={data.decided}
        problem={data.problem}
        canDecideDob={officeCan(role, 'identity')}
      />
    </>
  );
}
