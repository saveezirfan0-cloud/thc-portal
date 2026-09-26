import { NotAvailable } from '../_components/NotAvailable';
import { currentOfficeRole } from '../_components/officeUser';
import { officeCan } from '../_lib/permissions';
import { loadRoles } from './data';
import { RolesScreen } from './RolesScreen';

export const metadata = { title: 'Roles & rates · THC Back Office' };

/**
 * /roles — §9.8, `wireframes/backoffice/roles.html`.
 *
 * Read on the server: the rates are money and `roles` is admin-only, so
 * nothing reaches the browser beyond what the table prints. The screen
 * carries its own `OfficeShell` because §9.8 puts "New role" in the topbar,
 * and that button opens a modal the screen owns the state for.
 */
export default async function Page() {
  // ADR-0056: Roles & rates is the pay catalogue; role_directory_v returns
  // nothing to a scheduler and the role writes are refused.
  const role = await currentOfficeRole();
  if (role && !officeCan(role, 'finance')) {
    return <NotAvailable activeHref="/roles" title="Roles & rates" role={role} needs="finance" />;
  }
  const { roles, problem } = await loadRoles();
  return <RolesScreen roles={roles} problem={problem} />;
}
