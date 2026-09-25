import { loadStaff } from './data';
import { StaffScreen } from './StaffScreen';
import type { Filter } from './staff';

export const metadata = { title: 'Staff · THC Back Office' };

const FILTERS: readonly Filter[] = ['all', 'compliant', 'blocked', 'inactive', 'removed'];

/**
 * /staff — §9.6 and §4.5, `wireframes/backoffice/staff.html`.
 *
 * Read on the server. `staff` carries date of birth, address, NI number
 * and right-to-work state, and §1.7's anonymisation of a removed worker is
 * applied in the view, so nothing this screen holds could print a name a
 * GDPR removal was meant to retire.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; filter?: string }>;
}) {
  const { staff, students, problem } = await loadStaff();
  // `/staff?view=student` opens the Student visa view directly — the link
  // /compliance uses for the completion letter requirement's §4 report.
  // `/staff?filter=inactive` opens a status tab, e.g. the leavers' list.
  const { view, filter } = await searchParams;
  const initialFilter = FILTERS.find((entry) => entry === filter) ?? 'all';
  return (
    <StaffScreen
      staff={staff}
      students={students}
      problem={problem}
      initialView={view === 'student' ? 'student' : 'directory'}
      initialFilter={initialFilter}
    />
  );
}
