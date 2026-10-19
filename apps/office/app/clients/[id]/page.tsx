import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Alert } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { currentOfficeRole } from '../../_components/officeUser';
import { officeCan } from '../../_lib/permissions';
import { loadClientCard } from './data';
import { loadClientHead } from './head';
import { ClientCardSkeleton, ClientCrumbs, NewEventForClient } from './chrome';
import { ClientCard } from './ClientCard';
import './card.css';

export const metadata = { title: 'Client · THC Back Office' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 *
 * Streaming (ADR-0161). The card is a dozen reads; the page starts them as
 * soon as the role is known, waits only for one row of the directory view,
 * and answers the 404 there, before anything streams (ADR-0109). The shell,
 * the client's name and "+ New event" paint at once; the four blocks
 * stream in behind a skeleton. Nothing on the card navigates by query.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A malformed id names nobody: a 404, as an unknown one is — not the
  // database's "invalid input syntax for type uuid" in a coral panel.
  if (!UUID.test(id)) notFound();
  const roleRead = currentOfficeRole();
  // The card's reads start as soon as the role says whether rates are
  // visible, alongside the head below. The body awaits this promise.
  const card = roleRead.then((role) =>
    loadClientCard(id, { ratesVisible: officeCan(role, 'finance') }),
  );
  card.catch(() => undefined);
  const [head, role] = await Promise.all([loadClientHead(id), roleRead]);

  if (head.problem) {
    return (
      <OfficeShell activeHref="/clients" title="Client">
        <Alert tone="coral">{head.problem}</Alert>
      </OfficeShell>
    );
  }
  // Decided before the Suspense below, so the answer is a real 404.
  if (!head.client) notFound();

  return (
    <OfficeShell
      activeHref="/clients"
      title="Client"
      crumbs={<ClientCrumbs name={head.client.name} />}
      actions={<NewEventForClient clientId={head.client.id} />}
    >
      <Suspense fallback={<ClientCardSkeleton />}>
        <Card
          card={card}
          ratesVisible={officeCan(role, 'finance')}
          canWrite={officeCan(role, 'write')}
        />
      </Suspense>
    </OfficeShell>
  );
}

async function Card({
  card,
  ratesVisible,
  canWrite,
}: {
  card: ReturnType<typeof loadClientCard>;
  ratesVisible: boolean;
  canWrite: boolean;
}) {
  const data = await card;
  if (data.problem) return <Alert tone="coral">{data.problem}</Alert>;
  // Read a moment ago by the head; gone now.
  if (!data.client) {
    return <Alert tone="coral">This client can no longer be found. Go back to Clients.</Alert>;
  }
  return <ClientCard bare data={data} ratesVisible={ratesVisible} canWrite={canWrite} />;
}
