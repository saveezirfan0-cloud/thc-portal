import { notFound } from 'next/navigation';
import { UK_ZONE, derivedEventWindow, formatTimeIn, isEditLocked, ukRoleWindow } from '@thc/domain';
import { updateEvent } from '../../actions';
import { loadEvent, loadReferenceData } from '../../data';
import { OfficeShell } from '../../_components/OfficeShell';
import { ShiftBuilder } from '../../_components/ShiftBuilder';
import { DRESS_CODE_OTHER, type EventDraft, type RoleDraft } from '../../draft';
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

  const roles: RoleDraft[] = event.sections.map((section, index) => {
    // A dress code that is not on the client's list is this event's own
    // override, so it reopens as "Other" free text (§9.7).
    const onList = dressCodesFor(section.roleId).includes(section.dressCode);
    return {
      key: `saved-${section.id}-${index}`,
      id: section.id,
      roleId: section.roleId,
      start: section.start,
      end: section.end,
      headcount: section.headcount,
      buffer: section.buffer,
      chargeRate: section.chargeRate,
      payRate: section.payRate,
      dressCode: section.dressCode && !onList ? DRESS_CODE_OTHER : section.dressCode,
      dressCodeOther: section.dressCode && !onList ? section.dressCode : '',
      autoAssign: section.autoAssign,
      allocationPerHour: section.allocationPerHour,
      // Whatever is stored is the manager's choice; the default never
      // overwrites it on reopening (§3.4).
      allocationTouched: true,
    };
  });

  // A role added now is pre-filled with the event's CURRENT window (§3.2),
  // which is the derived one: earliest start → latest end (RULE-18).
  const sections = event.sections.map((s) => ukRoleWindow(event.date, s.start, s.end));
  const window = derivedEventWindow(sections);

  const initial: EventDraft = {
    clientId: event.clientId,
    venueId: event.venueId,
    title: event.title,
    date: event.date,
    overallStart: window ? formatTimeIn(window.startsAt, UK_ZONE) : '07:00',
    overallEnd: window ? formatTimeIn(window.endsAt, UK_ZONE) : '23:30',
    poNumber: event.poNumber,
    onsiteContact: event.onsiteContact,
    notes: event.notes,
    autoAssign: event.autoAssign,
    roles,
  };

  const locked = isEditLocked(sections);

  const confirmed = Object.fromEntries(event.sections.map((s) => [s.id, s.confirmed]));
  const booked = Object.fromEntries(event.sections.map((s) => [s.id, s.booked]));

  return (
    <OfficeShell title={event.title}>
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
