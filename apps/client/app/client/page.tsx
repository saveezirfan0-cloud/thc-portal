import { Alert } from '@thc/ui';
import { EventsScreen } from './EventsScreen';
import { loadEventList } from './data';
import { signLineupPhotos } from './photos';

/**
 * §11.1 · the Client Portal's event list.
 *
 * Read on the server under the caller's own session, so the views'
 * tenancy predicate decides what exists before anything reaches the browser
 * (ADR-0004).
 */
export const metadata = { title: 'Your events · THC Client Portal' };

// The line-up and its counts change as workers confirm, and the photo URLs
// are signed with a short life, so this page is never cached.
export const dynamic = 'force-dynamic';

export default async function ClientEventsPage() {
  const { events, sections, lineup, documents, documentsLoaded, company, problem } =
    await loadEventList();
  const signed = await signLineupPhotos(lineup.map((l) => l.photoPath));

  return (
    <>
      {problem ? <Alert tone="amber">{problem}</Alert> : null}
      <EventsScreen
        events={events}
        sections={sections}
        lineup={lineup}
        documents={documents}
        documentsLoaded={documentsLoaded}
        company={company}
        photos={Object.fromEntries(signed)}
        now={new Date().toISOString()}
      />
    </>
  );
}
