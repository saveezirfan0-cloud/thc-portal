import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, PageHead } from '@thc/ui';
import { loadEvent } from '../../data';
import { loadArrivals } from '../../arrivals';
import { DOCUMENTS_UNAVAILABLE, loadDocuments } from '../../documents';
import { isUuid } from '../../ids';
import { presentLineup } from '../../photos';
import { AutoRefresh } from '../../../_components/AutoRefresh';
import { EventScreen } from './EventScreen';

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
 */
export const dynamic = 'force-dynamic';

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

type DocNotice = 'missing' | 'unavailable';

function docNotice(value: string | string[] | undefined): DocNotice | null {
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

  const { event, sections, lineup, problem } = await loadEvent(id);

  if (problem) {
    return (
      <div className="stack" style={{ gap: 16 }}>
        <Link className="sm" href="/client">
          ← Your events
        </Link>
        <PageHead title="Event details" />
        <Alert tone="amber">{problem}</Alert>
      </div>
    );
  }
  if (!event) notFound();

  const [shown, documents, arrivals] = await Promise.all([
    presentLineup(lineup),
    loadDocuments(event.id),
    loadArrivals([event.id]),
  ]);

  return (
    <>
      <AutoRefresh />
      {notice ? (
        <Alert tone="amber">
          {DOC_NOTICE[notice === 'missing' && event.status === 'cancelled' ? 'cancelled' : notice]}
        </Alert>
      ) : null}
      {documents.unavailable ? <Alert tone="amber">{DOCUMENTS_UNAVAILABLE}</Alert> : null}
      <EventScreen
        event={event}
        sections={sections}
        lineup={shown.lineup}
        photos={shown.photos}
        documents={documents.documents.map((d) => ({ kind: d.kind, issuedAt: d.issued_at }))}
        arrivals={arrivals[event.id]}
        now={new Date().toISOString()}
      />
    </>
  );
}
