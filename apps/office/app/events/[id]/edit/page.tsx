import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isEditLocked, ukRoleWindow } from '@thc/domain';
import { updateEvent } from '../../actions';
import { loadEvent, loadReferenceData } from '../../data';
import { OfficeShell } from '../../../_components/OfficeShell';
import { ViewerZone } from '../../_components/ViewerZone';
import { ShiftBuilder } from '../../_components/ShiftBuilder';
import { draftFromSaved } from '../../draft';
import '../../shift-builder.css';

// Reference data and the event itself are per-request and per-user; never
// prerender or cache this page.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Edit event · THC Back Office' };

/**
 * /events/:id/edit — the same Shift Builder, Scope §3.2.
 *
 * Every field is editable the same way as at creation, up to the event's
 * start. From the derived start onwards — and therefore for every past event
 * — the form is locked and the work moves to the event board (§3.2).
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [reference, event] = await Promise.all([loadReferenceData(), loadEvent(id)]);
  if (!event) notFound();

  const dressCodesFor = (roleId: string) =>
    reference.clients.find((c) => c.id === event.clientId)?.rateCard[roleId]?.dressCodes ?? [];
  const initial = draftFromSaved(event, dressCodesFor, 'edit');

  const locked = isEditLocked(event.sections.map((s) => ukRoleWindow(event.date, s.start, s.end)));

  const confirmed = Object.fromEntries(event.sections.map((s) => [s.id, s.confirmed]));
  const booked = Object.fromEntries(event.sections.map((s) => [s.id, s.booked]));

  return (
    <OfficeShell
      activeHref="/events"
      title={event.title}
      crumbs={
        <>
          <Link href="/events">Scheduling</Link> / <b>Shift Builder</b>
        </>
      }
      timezone={<ViewerZone />}
    >
      <ShiftBuilder
        mode="edit"
        reference={reference}
        initial={initial}
        saved={event}
        confirmed={confirmed}
        booked={booked}
        locked={locked}
        save={updateEvent}
      />
    </OfficeShell>
  );
}
