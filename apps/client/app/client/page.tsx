import { Alert } from '@thc/ui';
import { loadArrivals } from './arrivals';
import { AutoRefresh } from '../_components/AutoRefresh';
import { EventsScreen } from './EventsScreen';
import { loadEventList } from './data';
import { kindsByEvent, loadAllDocuments } from './documents';
import { presentLineup } from './photos';

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
  const { events, sections, lineup, company, problem } = await loadEventList();
  // The documents ride alongside the events, one query for the page, so the
  // list can tell a real download from a copy the office has not issued yet.
  // The photos are keyed by booking and the Storage paths stay here: a
  // path's first segment is the worker's staff id (photos.ts).
  const [shown, documents, arrivals] = await Promise.all([
    presentLineup(lineup),
    loadAllDocuments(),
    loadArrivals(),
  ]);

  return (
    <>
      {/* "N of M arrived" and the line-up move while an event is on. */}
      <AutoRefresh />
      {problem ? <Alert tone="amber">{problem}</Alert> : null}
      <EventsScreen
        events={events}
        sections={sections}
        lineup={shown.lineup}
        photos={shown.photos}
        documents={kindsByEvent(documents)}
        arrivals={arrivals}
        company={company}
        now={new Date().toISOString()}
      />
    </>
  );
}
