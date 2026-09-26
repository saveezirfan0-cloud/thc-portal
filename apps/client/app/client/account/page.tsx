import { AccountScreen } from './AccountScreen';
import { OFFICE_EMAIL } from './copy';
import { loadAccount } from './load';
import './account.css';

/**
 * /client/account — "Your account" (ADR-0051).
 *
 * The customer's own details and the addresses their documents go to,
 * read-only, plus a password change. Read on the server under the caller's
 * own session (load.ts); the company and recipients come through
 * `client_account_v`, never `clients` (ADR-0004).
 */
export const metadata = { title: 'Your account · THC Client Portal' };

// Account details change in the office; never serve a cached copy.
export const dynamic = 'force-dynamic';

export default async function ClientAccountPage() {
  const { account, problem } = await loadAccount();
  return <AccountScreen account={account} officeEmail={OFFICE_EMAIL} problem={problem} />;
}
