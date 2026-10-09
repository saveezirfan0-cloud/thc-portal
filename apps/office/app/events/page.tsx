import { Suspense } from 'react';
import Link from 'next/link';
import { SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { todayInUk } from './calendar';
import { OfficeShell } from '../_components/OfficeShell';
import { AutoRefresh } from '../_components/AutoRefresh';
import { EventsBody } from './EventsBody';
import { parseEventQuery } from './_lib/filters';
import { periodCrumb } from './view-model';
import './shift-builder.css';
import './events.css';

// Events, their fill and "today" are all per-request. Never prerender.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Scheduling · THC Back Office' };

/**
 * /events — List and Calendar, Scope §3.1.
 *
 * The view, the period and the filters all live in the URL (`_lib/filters.ts`),
 * so every state of this screen is a link and the browser's own back button does what a manager
 * expects. The period arrows step a day, a week or a month depending on the
 * view, and work in List too — past events are browsable there, not only in
 * the calendar.
 *
 * The page reads only the URL, so the topbar and chrome paint at once and
 * the events stream in behind a skeleton (`EventsBody`). One `OfficeShell`,
 * outside the Suspense: a shell drawn by the skeleton too put two topbars in
 * the document during the swap. The Suspense has no key, so stepping the
 * period keeps the old one on screen until the new one is ready, as before.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const today = todayInUk();
  // One parser for the URL, shared with the toolbar and the saved views.
  const query = parseEventQuery(await searchParams, today);

  return (
    <OfficeShell
      activeHref="/events"
      title="Scheduling"
      // The wireframe's "events · Thu 18 Sep 2026": the period being read.
      crumbs={
        <>
          events · <b>{periodCrumb(query.date)}</b>
        </>
      }
      actions={
        // §3.1: the same place in every view, not in a sub-toolbar.
        <Link className="btn primary sm" href="/events/new">
          + New event
        </Link>
      }
    >
      {/* Fill moves as staff accept and the office books: re-read every 15 s. */}
      <AutoRefresh everyMs={15_000} />
      <Suspense
        fallback={
          <SkeletonScreen label="Loading events">
            <SkeletonToolbar controls={3} />
            <SkeletonPanel rows={8} />
          </SkeletonScreen>
        }
      >
        <EventsBody query={query} today={today} />
      </Suspense>
    </OfficeShell>
  );
}
