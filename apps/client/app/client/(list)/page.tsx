import Link from 'next/link';
import { Alert, PageHead } from '@thc/ui';
import { loadArrivals } from '../arrivals';
import { AutoRefresh } from '../../_components/AutoRefresh';
import { OFFICE_EMAIL } from '../account/copy';
import { EventsScreen } from '../EventsScreen';
import { LOAD_FAILED, NOT_LINKED, loadEventList } from '../data';
import { DOCUMENTS_UNAVAILABLE, kindsByEvent, loadAllDocuments } from '../documents';
import { presentLineup } from '../photos';
import { listFaces } from '../rules';

/**
 * §11.1 · the Client Portal's event list.
 *
 * Read on the server under the caller's own session, so the three views'
 * tenancy predicate decides what exists before anything reaches the browser
 * (ADR-0004). How far back it reads is the address's `from` / `to` /
 * `since` (window.ts); everything else in the address is applied in the
 * browser to the rows read here.
 */
export const metadata = { title: 'Your events · THC Client Portal' };

// The line-up and its counts change as workers confirm, and the photo URLs
// are signed with a short life, so this page is never cached.
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

/** The address's parameters, first value of each, as `URLSearchParams` reads them. */
function paramsOf(raw: SearchParams | undefined): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(raw ?? {})) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') out.set(key, first);
  }
  return out;
}

export default async function ClientEventsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = paramsOf(await searchParams);
  // One clock for the read and the screen, so the window the screen compares
  // against (EventsScreen's `loaded`) is the one that was read.
  const now = new Date();
  const { events, sections, lineup, company, unlinked, history, problem } = await loadEventList({
    params,
    now,
  });

  // A failed read is not an empty list: drawing the screen with no events
  // would say "No events yet" to a customer who has some. The head and the
  // customer sentence only (the detail is in the server log, data.ts).
  if (problem) {
    // "Too many" after the address widened the window has a way out: the
    // plain list, which reads the default window.
    const narrower = problem === LOAD_FAILED.tooMany && [...params.keys()].length > 0;
    return (
      <>
        <PageHead title="Your events" description="Confirmed line-ups and timesheets · read-only" />
        <Alert tone="amber">{problem}</Alert>
        {narrower ? (
          <p className="mt-16">
            <Link className="btn sm" href="/client">
              Show recent events
            </Link>
          </p>
        ) : null}
      </>
    );
  }

  // Signed in, but the login belongs to no company: the views return nothing
  // because there is nothing of theirs, and "No events yet" would send the
  // customer waiting for bookings that cannot appear.
  if (unlinked && events.length === 0) {
    return (
      <>
        <PageHead title="Your events" description="Confirmed line-ups and timesheets · read-only" />
        <Alert tone="amber">
          {NOT_LINKED} <a href={`mailto:${OFFICE_EMAIL}`}>{OFFICE_EMAIL}</a>.
        </Alert>
      </>
    );
  }

  const ids = events.map((e) => e.id);
  // "N of M arrived" is drawn for a running event only (ADR-0053).
  const ongoing = events.filter((e) => e.status === 'ongoing').map((e) => e.id);

  // The documents ride alongside the events, one query per hundred events,
  // so the list can tell a real download from a copy the office has not
  // issued yet. Photos are signed only for the faces a row draws.
  const [shown, documents, arrivals] = await Promise.all([
    presentLineup(lineup, listFaces(events, lineup)),
    loadAllDocuments(ids),
    loadArrivals(ongoing),
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
        lineup={shown.lineup}
        photos={shown.photos}
        documents={kindsByEvent(documents.documents)}
        arrivals={arrivals}
        company={company}
        loaded={history ?? undefined}
        now={now.toISOString()}
      />
    </>
  );
}
