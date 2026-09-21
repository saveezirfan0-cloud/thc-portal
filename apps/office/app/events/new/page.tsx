import Link from 'next/link';
import { createEvent } from '../actions';
import { loadReferenceData } from '../data';
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
export default async function Page() {
  const reference = await loadReferenceData();

  const initial: EventDraft = {
    clientId: '',
    venueId: '',
    title: '',
    date: '',
    overallStart: '07:00',
    overallEnd: '23:30',
    poNumber: '',
    onsiteContact: '',
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
