import { loadUsers } from './data';
import { UsersScreen } from './UsersScreen';

export const metadata = { title: 'Users & access · THC Back Office' };
export const dynamic = 'force-dynamic';

/**
 * /users — every login to the three apps, who can do what, and the only
 * place a Back Office or Client Portal login is created (ADR-0035, §1.4).
 * `admin_accounts()` refuses anyone but an admin, so a non-admin session
 * sees that refusal as the page's problem line.
 */
export default async function Page() {
  return <UsersScreen data={await loadUsers()} />;
}
