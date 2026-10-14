import Link from 'next/link';
import { Alert, PageHead, SkeletonPanel, SkeletonScreen, SkeletonText } from '@thc/ui';
import { loadEventDetails } from '../../data';
import type { ClientEvent } from '../../data';
import { loadArrivals } from '../../arrivals';
import { DOCUMENTS_UNAVAILABLE, loadDocuments } from '../../documents';
import { presentLineup } from '../../photos';
import { EventScreen } from './EventScreen';

/** The page's failed-read state: a heading, the sentence and the way back. */
export function LoadFailed({ title, problem }: { title: string; problem: string }) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Link className="sm" href="/client">
        ← Your events
      </Link>
      <PageHead title={title} />
      <Alert tone="amber">{problem}</Alert>
    </div>
  );
}

/**
 * Everything under the event's row: the sections and line-up (held to the
 * headcount, ADR-0134 §1), THC's phone, the signed photos, the documents
 * and the arrival counts. Streams in behind `EventSkeleton`.
 */
export async function EventBody({ event }: { event: ClientEvent }) {
  const details = await loadEventDetails(event.id);
  if (details.problem) return <LoadFailed title={event.title} problem={details.problem} />;

  const [shown, documents, arrivals] = await Promise.all([
    presentLineup(details.lineup),
    loadDocuments(event.id),
    loadArrivals([event.id]),
  ]);

  return (
    <>
      {documents.unavailable ? <Alert tone="amber">{DOCUMENTS_UNAVAILABLE}</Alert> : null}
      <EventScreen
        event={event}
        sections={details.sections}
        lineup={shown.lineup}
        photos={shown.photos}
        documents={documents.documents.map((d) => ({ kind: d.kind, issuedAt: d.issued_at }))}
        arrivals={arrivals[event.id]}
        thcPhone={details.thcPhone}
        now={new Date().toISOString()}
      />
    </>
  );
}

/**
 * The event page while its line-up loads (ADR-0134 N9): the real name and
 * venue — already read, and the first thing a customer checks — over the
 * header card's shape and two role panels of faces. Announced once as busy
 * (`SkeletonScreen`); the placeholders are hidden from assistive tech.
 */
export function EventSkeleton({ event }: { event: Pick<ClientEvent, 'title' | 'venueName'> }) {
  return (
    <SkeletonScreen label={`Loading the line-up for ${event.title}`} className="stack epage">
      <div className="ehead">
        <div className="row wrap">
          <Link className="sm back-link" href="/client">
            ← Your events
          </Link>
        </div>
        <div>
          <h1>{event.title}</h1>
          <div className="muted sm">{event.venueName}</div>
        </div>
        <SkeletonText lines={2} />
      </div>
      <SkeletonPanel rows={3} avatar lines={2} />
      <SkeletonPanel rows={2} avatar lines={2} />
    </SkeletonScreen>
  );
}
