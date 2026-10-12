import { Alert, PageHead } from '@thc/ui';
import { loadArrivals } from '../arrivals';
import { AutoRefresh } from '../../_components/AutoRefresh';
import { EventsScreen } from '../EventsScreen';
import { loadEventList } from '../data';
import { DOCUMENTS_UNAVAILABLE, kindsByEvent, loadAllDocuments } from '../documents';
import { signLineupPhotos } from '../photos';

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

  // A failed read is not an empty list: drawing the screen with no events
  // would say "No events yet" to a customer who has some. The head and the
  // customer sentence only (the detail is in the server log, data.ts).
  if (problem) {
    return (
      <>
        <PageHead title="Your events" description="Confirmed line-ups and timesheets · read-only" />
        <Alert tone="amber">{problem}</Alert>
      </>
    );
  }

  // The documents ride alongside the events, one query for the page, so the
  // list can tell a real download from a copy the office has not issued yet.
  const [signed, documents, arrivals] = await Promise.all([
    signLineupPhotos(lineup.map((l) => l.photoPath)),
    loadAllDocuments(),
    loadArrivals(),
  ]);

  return (
    <>
      {/* "N of M arrived" and the line-up move while an event is on. */}
      <AutoRefresh />
      {/* Without this, a failed documents read would read as "not issued yet"
          on every row's button. */}
      {documents.unavailable ? <Alert tone="amber">{DOCUMENTS_UNAVAILABLE}</Alert> : null}
      <EventsScreen
        events={events}
        sections={sections}
        lineup={lineup}
        photos={Object.fromEntries(signed)}
        documents={kindsByEvent(documents.documents)}
        arrivals={arrivals}
        company={company}
        now={new Date().toISOString()}
      />
    </>
  );
}
