import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense, cache } from 'react';
import { loadEventRow } from '../../data';
import { isUuid } from '../../ids';
import { AutoRefresh } from '../../../_components/AutoRefresh';
import { DocNotice } from './DocNotice';
import { EventBody, EventSkeleton, LoadFailed } from './EventBody';

/**
 * §11.2 · one event, read-only.
 *
 * An id belonging to another customer returns no row, exactly as a
 * nonexistent one does, so this renders not-found either way: the page
 * cannot tell the two apart and should not try to. The decision was made by
 * `client_portal_visible()` inside the view (ADR-0004), not here.
 *
 * An id that is not a uuid is not-found before any query, and a failed
 * query shows the generic `LOAD_FAILED` copy: the database's own message
 * goes to the server log, never to the customer.
 *
 * Loading (ADR-0134 N9). There is still no `loading.tsx` here: a route
 * `loading.tsx` wraps the whole page in a Suspense boundary, so the shell —
 * and its 200 — would be sent before `notFound()` could answer 404
 * (docs/08). Instead the page reads the event's own row first (one indexed
 * read, `loadEventRow`) and decides between itself and the 404 before
 * anything streams; only then does a Suspense boundary inside the page show
 * the event's name over a skeleton while the line-up, its photos, the
 * documents and the arrival counts load (`EventBody`). On slow venue Wi-Fi
 * the customer sees which event they opened at once.
 */
export const dynamic = 'force-dynamic';

/**
 * One read of the event row per request: the tab title and the page are
 * both drawn from it. `cache` holds for the render of one request only, so
 * nothing is shared between customers or between refreshes.
 */
const readEventRow = cache(loadEventRow);

/** The not-found card's own title (not-found.tsx), for an id that is not this customer's. */
const NOT_FOUND_TITLE = 'Not found · THC Client Portal';

/**
 * "<event title> · THC Client Portal" in the tab. An id that is not a uuid,
 * another customer's event and one that never existed all get the not-found
 * title — the page answers them with the same 404, and the title must not
 * tell them apart either (ADR-0004). A failed read names no event.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: NOT_FOUND_TITLE };
  const { event, problem } = await readEventRow(id);
  if (problem) return { title: 'Event details · THC Client Portal' };
  return { title: event ? `${event.title} · THC Client Portal` : NOT_FOUND_TITLE };
}

/**
 * What the download route sent the customer back with (document/route.ts):
 * the copy has not been issued, or it could not be fetched just now.
 */
const DOC_NOTICE = {
  missing:
    "That document hasn't been issued yet. It will be ready to download here once THC issues it.",
  cancelled: 'This event was cancelled, so it has no documents to download.',
  unavailable: "That document couldn't be downloaded just now. Try again in a few minutes.",
} as const;

type DocNoticeKind = 'missing' | 'unavailable';

function docNotice(value: string | string[] | undefined): DocNoticeKind | null {
  return value === 'missing' || value === 'unavailable' ? value : null;
}

export default async function ClientEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const notice = docNotice((await searchParams)?.doc);

  const { event, problem } = await readEventRow(id);

  if (problem) return <LoadFailed title="Event details" problem={problem} />;
  // Decided before the Suspense boundary below, so the answer is a real 404.
  if (!event) notFound();

  return (
    <>
      <AutoRefresh />
      {/* Shown once: the parameter leaves the address as soon as it is
          read, so a reload or the next refresh does not repeat it. */}
      <DocNotice
        message={
          notice
            ? DOC_NOTICE[
                notice === 'missing' && event.status === 'cancelled' ? 'cancelled' : notice
              ]
            : null
        }
      />
      <Suspense fallback={<EventSkeleton event={event} />}>
        <EventBody event={event} />
      </Suspense>
    </>
  );
}
