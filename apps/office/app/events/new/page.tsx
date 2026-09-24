import Link from 'next/link';
import { Alert } from '@thc/ui';
import { createEvent } from '../actions';
import { loadEvent, loadReferenceData } from '../data';
import { OfficeShell } from '../../_components/OfficeShell';
import { ViewerZone } from '../_components/ViewerZone';
import { ShiftBuilder } from '../_components/ShiftBuilder';
import { type EventDraft, draftFromSaved } from '../draft';
import '../shift-builder.css';

// Reference data and the event itself are per-request and per-user; never
// prerender or cache this page.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'New event · THC Back Office' };

const BLANK: EventDraft = {
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /events/new — the Shift Builder, Scope §3.2.
 *
 * Auto-assign starts ON at event and role level (§3.4). The overall window is
 * only the pre-fill for each role added below; the event's own window is
 * derived from the sections (RULE-18).
 *
 * `?from=<event id>` is Duplicate (§3.2): "Multi-day = separate events
 * created via Duplicate (the clone copies the roles, NOT the staff)". The
 * builder opens pre-filled with the original's roles and no date; saving
 * creates a new event through the ordinary `createEvent` and lands on its
 * board. Nothing booked on the original is copied (`draftFromSaved`).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawFrom = params['from'];
  const from = (Array.isArray(rawFrom) ? rawFrom[0] : rawFrom) ?? '';

  const [reference, source] = await Promise.all([
    loadReferenceData(),
    UUID.test(from) ? loadEvent(from) : Promise.resolve(null),
  ]);

  const dressCodesFor = (roleId: string) =>
    reference.clients.find((c) => c.id === source?.clientId)?.rateCard[roleId]?.dressCodes ?? [];
  const initial = source ? draftFromSaved(source, dressCodesFor, 'duplicate') : BLANK;

  return (
    <OfficeShell
      activeHref="/events"
      title={source ? `Duplicate · ${source.title}` : 'New event'}
      crumbs={
        <>
          <Link href="/events">Scheduling</Link> / <b>Shift Builder</b>
        </>
      }
      timezone={<ViewerZone />}
    >
      <div className="stack">
        {from && !source ? (
          <Alert tone="amber">
            The event to duplicate was not found, so this is a blank new event.
          </Alert>
        ) : null}
        {source ? (
          <Alert tone="cyan">
            <b>Duplicating {source.title}.</b> The roles are copied — times, headcount, buffer,
            rates, dress code — but <b>not the staff</b>: the new event starts filling from zero
            (§3.2). Set the new date, then save.{' '}
            <Link href={`/events/${source.id}`}>Back to the original</Link>
          </Alert>
        ) : null}
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
      </div>
    </OfficeShell>
  );
}
