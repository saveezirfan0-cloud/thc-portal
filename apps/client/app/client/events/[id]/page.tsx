import { notFound } from 'next/navigation';
import { Alert } from '@thc/ui';
import { loadEvent } from '../../data';
import { loadDocuments } from '../../documents';
import { signLineupPhotos } from '../../photos';
import { EventScreen } from './EventScreen';

/**
 * §11.2 · one event, read-only.
 *
 * An id belonging to another customer returns no row, exactly as a
 * nonexistent one does, so this renders not-found either way: the page
 * cannot tell the two apart and should not try to. The decision was made by
 * `client_portal_visible()` inside the view (ADR-0004), not here.
 */
export const dynamic = 'force-dynamic';

export default async function ClientEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, sections, lineup, problem } = await loadEvent(id);

  if (problem) return <Alert tone="amber">{problem}</Alert>;
  if (!event) notFound();

  const [signed, documents] = await Promise.all([
    signLineupPhotos(lineup.map((l) => l.photoPath)),
    loadDocuments(event.id),
  ]);

  return (
    <EventScreen
      event={event}
      sections={sections}
      lineup={lineup}
      photos={Object.fromEntries(signed)}
      documents={documents.map((d) => ({ kind: d.kind, issuedAt: d.issued_at }))}
      now={new Date().toISOString()}
    />
  );
}
