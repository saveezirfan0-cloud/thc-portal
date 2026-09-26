import { NotAvailable } from '../_components/NotAvailable';
import { currentOfficeRole } from '../_components/officeUser';
import { officeCan } from '../_lib/permissions';
import { loadUsers } from './data';
import { UsersScreen } from './UsersScreen';

export const metadata = { title: 'Users & access · THC Back Office' };
export const dynamic = 'force-dynamic';

/**
 * /users — every login to the three apps, who can do what, and the only
 * place a Back Office or Client Portal login is created (ADR-0055, §1.4).
 * `admin_accounts()` refuses anyone but an owner (ADR-0056), so any other
 * session sees that refusal as the page's problem line — and an office
 * role that cannot use the page is told so before it is asked.
 */
export default async function Page() {
  const role = await currentOfficeRole();
  if (role && !officeCan(role, 'users')) {
    return <NotAvailable activeHref="/users" title="Users & access" role={role} needs="users" />;
  }
  return <UsersScreen data={await loadUsers()} />;
}
