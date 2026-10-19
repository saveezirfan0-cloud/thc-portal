import Link from 'next/link';
import { employeeId } from '../staff';

/**
 * The profile's topbar line (§9.6, `wireframes/backoffice/staff-profile.html`):
 * "Directory / Amara Kalu · THC-00873". No hooks, so the page draws it in its
 * own `OfficeShell` from the profile's first read while the rest streams
 * (ADR-0161), and `ProfileScreen` draws the same one when rendered whole.
 */
export function ProfileCrumbs({ name, employee }: { name: string; employee: number | null }) {
  return (
    <>
      <Link href="/staff">Directory</Link> / <b>{name}</b> · {employeeId(employee)}
    </>
  );
}
