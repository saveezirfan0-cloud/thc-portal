import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { loadStaff, supabaseConfigured } from './data';
import { countPendingChangeRequests } from './requests/data';
import { StaffScreen } from './StaffScreen';

export const metadata = { title: 'Staff · THC Back Office' };

/**
 * /staff — §9.6 and §4.5, `wireframes/backoffice/staff.html`.
 *
 * Read on the server. `staff` carries date of birth, address, NI number
 * and right-to-work state, and §1.7's anonymisation of a removed worker is
 * applied in the view, so nothing this screen holds could print a name a
 * GDPR removal was meant to retire.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [{ staff, students, problem }, pendingRequests] = await Promise.all([
    loadStaff(),
    // ADR-0044: "Change requests (N)". A failed count is null — never a
    // claimed 0 (audit D18), never an error over the directory.
    supabaseConfigured()
      ? cookies().then((jar) => countPendingChangeRequests(createClient(jar)))
      : Promise.resolve(0),
  ]);
  // `/staff?view=student` opens the Student visa view directly — the link
  // /compliance uses for the completion letter requirement's §4 report.
  const { view } = await searchParams;
  return (
    <StaffScreen
      staff={staff}
      students={students}
      problem={problem}
      initialView={view === 'student' ? 'student' : 'directory'}
      pendingRequests={pendingRequests}
    />
  );
}
