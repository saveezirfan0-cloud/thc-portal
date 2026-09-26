import { currentOfficeRole } from '../_components/officeUser';
import { officeCan } from '../_lib/permissions';
import { loadClients } from './data';
import { ClientsScreen } from './ClientsScreen';

export const metadata = { title: 'Clients · THC Back Office' };

/**
 * /clients — §9.7, `wireframes/backoffice/clients.html`.
 *
 * Read on the server: rate cards carry charge rates, and the margin is
 * computed in SQL next to final_rate(), so the browser only ever sees the
 * finished percentage.
 */
export default async function Page() {
  const [{ clients, problem }, officeRole] = await Promise.all([
    loadClients(),
    currentOfficeRole(),
  ]);
  // ADR-0061: no margin column for an office role without finance — the
  // view returns none, and an empty column of dashes reads as "no margin".
  return (
    <ClientsScreen
      clients={clients}
      problem={problem}
      ratesVisible={officeCan(officeRole, 'finance')}
    />
  );
}
