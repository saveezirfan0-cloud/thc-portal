import { currentOfficeRole } from '../../_components/officeUser';
import { officeCan } from '../../_lib/permissions';
import { loadRosterPage } from './data';
import { RosterScreen } from './RosterScreen';

export const metadata = { title: 'Invite list · Staff · THC Back Office' };

// Read per request with the manager's session — never prerendered.
export const dynamic = 'force-dynamic';

/**
 * /staff/roster — the invite list (ADR-0107).
 *
 * Who is SpudBros Express and who is THC, and each person's Payroll ID,
 * loaded before the invitations go out. A static segment, so Next.js serves
 * it ahead of `/staff/[id]`.
 */
export default async function Page() {
  const [data, role] = await Promise.all([loadRosterPage(), currentOfficeRole()]);
  return (
    <RosterScreen
      waiting={data.waiting}
      applied={data.applied}
      problem={data.problem}
      canEdit={officeCan(role, 'finance') && officeCan(role, 'write')}
    />
  );
}
