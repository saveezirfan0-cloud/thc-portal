import { notFound } from 'next/navigation';
import { Alert } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { loadBoard } from './data';
import { EventBoard } from './EventBoard';

export const metadata = { title: 'Event board · THC Back Office' };

/**
 * /events/:id — §3.3, the `BO2 Event board` frame.
 *
 * Read on the server. The pool is computed fresh on every load rather than
 * cached: the gates it applies — booked elsewhere, the weekly hours limit,
 * compliance — are true at a moment, and a stale pool would offer the
 * manager somebody the engine has just stopped being able to invite.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadBoard(id);

  if (data.problem) {
    return (
      <OfficeShell activeHref="/events" title="Scheduling">
        <Alert tone="coral">{data.problem}</Alert>
      </OfficeShell>
    );
  }
  if (!data.event) notFound();

  return <EventBoard data={data} />;
}
