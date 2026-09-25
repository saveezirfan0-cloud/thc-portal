import { NotAvailable } from '../_components/NotAvailable';
import { currentOfficeRole } from '../_components/officeUser';
import { officeCan } from '../_lib/permissions';
import { loadSettings } from './data';
import { SettingsScreen } from './SettingsScreen';

export const metadata = { title: 'System settings · THC Back Office' };
/** Configuration read on every auto-assign round; a cached copy is a stale rule. */
export const dynamic = 'force-dynamic';

/**
 * /settings — §6, §2.4, §9.11, §9.12.
 *
 * Read on the server, as admin: `settings` and `venue_types` each carry an
 * admin-only policy, so a non-admin session sees the policy's refusal
 * rather than a role check written in this app. That is the same gate
 * /roles and /venues rely on.
 */
export default async function Page() {
  // ADR-0036: owners only. Writes to settings and venue_types are refused
  // by restrictive policies for everyone else.
  const role = await currentOfficeRole();
  if (role && !officeCan(role, 'settings')) {
    return (
      <NotAvailable activeHref="/settings" title="System settings" role={role} needs="settings" />
    );
  }
  return <SettingsScreen data={await loadSettings()} />;
}
