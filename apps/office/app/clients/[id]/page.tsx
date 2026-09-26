import { notFound } from 'next/navigation';
import { Alert } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { currentOfficeRole } from '../../_components/officeUser';
import { officeCan } from '../../_lib/permissions';
import { loadClientCard } from './data';
import { ClientCard } from './ClientCard';

export const metadata = { title: 'Client · THC Back Office' };

/**
 * /clients/:id — §9.7, `wireframes/backoffice/client-card.html`.
 *
 * Read on the server. Every view behind it is admin-only and carries
 * charge rates, so nothing here is reachable by a client or a worker:
 * §11.1 holds through RLS rather than through anything this page does.
 *
 * ADR-0061: for an office role without finance the card is read without
 * a rate — the rate card as roles and dress codes, no margin — and draws
 * no control the database would refuse.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ratesVisible = officeCan(await currentOfficeRole(), 'finance');
  const data = await loadClientCard(id, { ratesVisible });

  if (data.problem) {
    return (
      <OfficeShell activeHref="/clients" title="Client">
        <Alert tone="coral">{data.problem}</Alert>
      </OfficeShell>
    );
  }
  if (!data.client) notFound();

  return <ClientCard data={data} ratesVisible={ratesVisible} />;
}
