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
  const { clients, problem } = await loadClients();
  return <ClientsScreen clients={clients} problem={problem} />;
}
