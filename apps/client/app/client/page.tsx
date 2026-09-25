import { Alert } from '@thc/ui';
import { loadArrivals } from './arrivals';
import { EventsScreen } from './EventsScreen';
import { loadEventList } from './data';
import { kindsByEvent, loadAllDocuments } from './documents';
import { signLineupPhotos } from './photos';

/**
 * §11.1 · the Client Portal's event list.
 *
 * Read on the server under the caller's own session, so the three views'
 * tenancy predicate decides what exists before anything reaches the browser
 * (ADR-0004).
 */
export const metadata = { title: 'Your events · THC Client Portal' };

// The line-up and its counts change as workers confirm, and the photo URLs
// are signed with a short life, so this page is never cached.
export const dynamic = 'force-dynamic';

export default async function ClientEventsPage() {
  const { events, sections, lineup, problem } = await loadEventList();
  // The documents ride alongside the events, one query for the page, so the
  // list can tell a real download from a copy the office has not issued yet.
  const [signed, documents, arrivals] = await Promise.all([
    signLineupPhotos(lineup.map((l) => l.photoPath)),
    loadAllDocuments(),
    loadArrivals(),
  ]);

  return (
    <>
      {problem ? <Alert tone="amber">{problem}</Alert> : null}
      <EventsScreen
        events={events}
        sections={sections}
        lineup={lineup}
        photos={Object.fromEntries(signed)}
        documents={kindsByEvent(documents)}
        arrivals={arrivals}
        now={new Date().toISOString()}
      />
    </>
  );
}
