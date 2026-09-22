import { notFound } from 'next/navigation';
import { Alert } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { loadClientCard } from './data';
import { ClientCard } from './ClientCard';

export const metadata = { title: 'Client · THC Back Office' };

/**
 * /clients/:id — §9.7, `wireframes/backoffice/client-card.html`.
 *
 * Read on the server. Every view behind it is admin-only and carries
 * charge rates, so nothing here is reachable by a client or a worker:
 * §11.1 holds through RLS rather than through anything this page does.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadClientCard(id);

  if (data.problem) {
    return (
      <OfficeShell activeHref="/clients" title="Client">
        <Alert tone="coral">{data.problem}</Alert>
      </OfficeShell>
    );
  }
  if (!data.client) notFound();

  return <ClientCard data={data} />;
}
