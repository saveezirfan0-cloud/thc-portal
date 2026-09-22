import { loadStaff } from './data';
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
export default async function Page() {
  const { staff, students, problem } = await loadStaff();
  return <StaffScreen staff={staff} students={students} problem={problem} />;
}
