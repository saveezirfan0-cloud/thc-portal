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
  return <SettingsScreen data={await loadSettings()} />;
}
