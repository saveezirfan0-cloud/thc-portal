import { loadMyAccount } from './data';
import { AccountScreen } from './AccountScreen';

export const metadata = { title: 'My profile · THC Back Office' };
export const dynamic = 'force-dynamic';

/**
 * /account — the signed-in manager's own profile (ADR-0049): name, job
 * title and phone; sign-in email; password; sessions; appearance.
 */
export default async function Page() {
  return <AccountScreen data={await loadMyAccount()} />;
}
