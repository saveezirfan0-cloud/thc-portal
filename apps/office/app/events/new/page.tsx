import Link from 'next/link';
import { createEvent } from '../actions';
import { loadReferenceData } from '../data';
import { preselectClient } from './preselect';
import { OfficeShell } from '../../_components/OfficeShell';
import { ViewerZone } from '../_components/ViewerZone';
import { ShiftBuilder } from '../_components/ShiftBuilder';
import type { EventDraft } from '../draft';
import '../shift-builder.css';

// Reference data and the event itself are per-request and per-user; never
// prerender or cache this page.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'New event · THC Back Office' };

/**
 * /events/new — the Shift Builder, Scope §3.2.
 *
 * Auto-assign starts ON at event and role level (§3.4). The overall window is
 * only the pre-fill for each role added below; the event's own window is
 * derived from the sections (RULE-18).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ client?: string | string[] }>;
}) {
  const [reference, query] = await Promise.all([loadReferenceData(), searchParams]);

  // "+ New event for this client" on /clients/:id (§9.7) opens this page as
  // /events/new?client=<id>. The id is only honoured if it names a client in
  // the reference list — anything else is an empty picker, as without it —
  // and the on-site contact pre-fills exactly as picking the client would.
  const preselected = preselectClient(reference.clients, query.client);

  const initial: EventDraft = {
    clientId: preselected?.id ?? '',
    venueId: '',
    title: '',
    date: '',
    overallStart: '07:00',
    overallEnd: '23:30',
    poNumber: '',
    onsiteContact: preselected?.staffContactPoint ?? '',
    notes: '',
    autoAssign: true,
    roles: [],
  };

  return (
    <OfficeShell
      activeHref="/events"
      title="New event"
      crumbs={
        <>
          <Link href="/events">Scheduling</Link> / <b>Shift Builder</b>
        </>
      }
      timezone={<ViewerZone />}
    >
      <ShiftBuilder
        mode="new"
        reference={reference}
        initial={initial}
        saved={null}
        confirmed={{}}
        booked={{}}
        locked={false}
        save={createEvent}
      />
    </OfficeShell>
  );
}
