import { currentOfficeRole } from '../../_components/officeUser';
import { officeCan } from '../../_lib/permissions';
import { staffUrlIsOffice } from '../../_lib/staffUrl';
import { loadRosterPage } from './data';
import { emailPreviews } from './email-previews';
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
/**
 * IR1's Register button in the previews: the Staff App's /apply, the link the
 * job puts in the real email. The Staff App is another deployment, so its
 * origin is NEXT_PUBLIC_STAFF_URL, as for the activation links; without it
 * the live address stands in, since a preview only shows the link.
 */
function applyLink(): string {
  const explicit = process.env['NEXT_PUBLIC_STAFF_URL'];
  const origin =
    explicit && !staffUrlIsOffice()
      ? explicit
      : process.env.NODE_ENV === 'production'
        ? 'https://staff.thehospitalitycompany.co.uk'
        : 'http://127.0.0.1:3001';
  return `${origin.replace(/\/$/, '')}/apply`;
}

export default async function Page() {
  const [data, role] = await Promise.all([loadRosterPage(), currentOfficeRole()]);
  return (
    <RosterScreen
      waiting={data.waiting}
      reminders={data.report}
      emails={data.emails}
      emailsProblem={data.emailsProblem}
      previews={emailPreviews(applyLink())}
      problem={data.problem}
      canEdit={officeCan(role, 'finance') && officeCan(role, 'write')}
      canWrite={officeCan(role, 'write')}
    />
  );
}
