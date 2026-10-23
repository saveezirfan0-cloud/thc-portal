import { notFound } from 'next/navigation';
import { officeUser } from '../../_components/officeUser';
import { officeCan } from '../../_lib/permissions';
import { currentTimeFormat } from '../../_lib/timeFormat';
import { loadTicket, loadTracking } from '../data';
import { TicketScreen } from '../TicketScreen';

export const metadata = { title: 'Ticket · THC Back Office' };
export const dynamic = 'force-dynamic';

/** /tickets/:id — one ticket, its thread, triage and, for the tracker, scope and time (ADR-0202). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, tracking, user, format] = await Promise.all([
    loadTicket(id),
    loadTracking(id),
    officeUser().catch(() => null),
    currentTimeFormat(),
  ]);
  // Not found, or an id that is not a uuid: one identical 404.
  if (!data.ticket && !data.problem) notFound();
  return (
    <TicketScreen
      data={data}
      canWrite={officeCan(user?.officeRole, 'write')}
      isOwner={user?.officeRole === 'owner'}
      tracking={tracking}
      format={format}
    />
  );
}
