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
  const { roles, problem } = await loadRoles();
  return <RolesScreen roles={roles} problem={problem} />;
}
