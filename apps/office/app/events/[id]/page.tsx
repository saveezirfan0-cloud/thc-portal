import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Panel, Pill } from '@thc/ui';
import {
  cancelledOnTheDay,
  derivedEventWindow,
  eventFill,
  eventStatus,
  formatEventFill,
  formatOpen,
  isEditLocked,
  isNotifiedOnCancel,
  orderSections,
  requiredLanguagesLabel,
} from '@thc/domain';
import { OfficeShell } from '../../_components/OfficeShell';
import { RecordHistory } from '../../_components/history/RecordHistory';
import { ViewerZone } from '../_components/ViewerZone';
import { StatusPill } from '../_components/EventViews';
import { ScheduledWindow } from '../_components/ScheduledWindow';
import { loadBoard } from './board-data';
import { canMessageLineUp, canToggleAutoAssign, messagePeople, pushDate } from './board-model';
import { AutoAssignSwitch } from './_components/AutoAssignSwitch';
import { RoleBoard } from './_components/RoleBoard';
import { CancelEvent } from './_components/CancelEvent';
import { DocumentActions } from './_components/DocumentActions';
import { DocumentRecipients } from './_components/DocumentRecipients';
import { MessageStaff } from './_components/MessageStaff';
import { loadAutosendHints } from './document-autosend';
import '../shift-builder.css';
import '../event-board.css';

// Bookings and their fill change under the manager while they watch.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Event board · THC Back Office' };

/**
 * /events/:id — the event board, Scope §3.3.
 *
 * A block per role section, ordered by that section's own start so the page
 * reads like the running order of the day (RULE-18). Slot counts are
 * confirmed only. The client's Break and Buffer policies stay visible in the
 * header after creation, not only while the event was being built (§3.2).
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, problem } = await loadBoard(id);
  // A read that FAILED is not a missing event: say what went wrong instead
  // of a 404 that tells the manager the event does not exist.
  if (problem) {
    return (
      <OfficeShell
        activeHref="/events"
        title="Event board"
        crumbs={
          <>
            <Link href="/events">Scheduling</Link> / <b>Event board</b>
          </>
        }
      >
        <Alert tone="coral">{problem}</Alert>
      </OfficeShell>
    );
  }
  if (!event) notFound();

  const sections = orderSections(
    event.sections.map((section) => ({ ...section, startsAt: new Date(section.startsAt) })),
  );
  const windows = sections.map((section) => ({
    startsAt: section.startsAt,
    endsAt: new Date(section.endsAt),
  }));
  const window = derivedEventWindow(windows);
  const status = eventStatus(window, event.cancelledAt);
  const languagesLabel = requiredLanguagesLabel(event.requiredLanguages);
  const fill = eventFill(
    event.sections.map((section) => ({
      headcount: section.headcount,
      buffer: section.buffer,
      confirmed: section.confirmed.length,
    })),
  );
  const open = formatOpen(fill);
  // ADR-0074: when the two documents go out on their own (or went).
  const autosend =
    status === 'cancelled'
      ? { allocation: null, signout: null }
      : await loadAutosendHints(event.id, {
          started: status === 'ongoing' || status === 'completed',
          ended: status === 'completed',
        });
  const autosendLine = [autosend.allocation, autosend.signout].filter(Boolean).join(' · ');
  // ADR-0086: the people the timesheets go to — this event's own list, else the client card.
  const documentRecipients = event.documentRecipients ?? event.clientContactEmails;
  const recipientsLine =
    status === 'cancelled' || documentRecipients.length === 0
      ? null
      : `Timesheets go to ${documentRecipients.join(', ')}${event.documentRecipients ? ' (set for this event)' : ' (the client card)'}`;
  const locked = isEditLocked(windows);
  // Everyone Cancel event reaches (CANCEL_NOTIFIES): confirmed, invited and
  // pending Radar applicants. A checked-in (`worked`) booking is not
  // cancelled (§3.6), so it is not counted.
  const attached = event.sections.reduce(
    (sum, section) =>
      sum +
      section.confirmed.filter((b) => isNotifiedOnCancel(b.status)).length +
      section.invited.length +
      section.applied.length,
    0,
  );

  return (
    <OfficeShell
      activeHref="/events"
      title={event.title}
      crumbs={
        <>
          <Link href="/events">Scheduling</Link> / <b>Event board</b>
        </>
      }
      timezone={<ViewerZone />}
      actions={
        <span className="row" style={{ gap: 8 }}>
          {/* Editing is allowed only up to the event's start (§3.2). */}
          {locked || status === 'cancelled' ? null : (
            <Link className="btn sm" href={`/events/${event.id}/edit`}>
              Edit
            </Link>
          )}
          {/* §3.2: multi-day = separate events via Duplicate — roles, not staff. */}
          <Link className="btn sm" href={`/events/new?from=${event.id}`}>
            Duplicate
          </Link>
          {/* §11.4. No document at all for a cancelled event (§3.3). */}
          {status === 'cancelled' ? null : (
            <>
              {/* ADR-0086: who the timesheets go to, for this event. */}
              <DocumentRecipients
                eventId={event.id}
                clientContacts={event.clientContactEmails}
                recipients={event.documentRecipients}
              />
              <DocumentActions
                eventId={event.id}
                started={status === 'ongoing' || status === 'completed'}
                nameBadges={event.nameBadges}
                recipients={documentRecipients}
                customRecipients={event.documentRecipients !== null}
              />
            </>
          )}
          {/* ADR-0069: last-minute information to the line-up, by push. */}
          {canMessageLineUp(status) ? (
            <MessageStaff
              eventId={event.id}
              pushTitle={`${event.title} · ${pushDate(event.date)}`}
              sections={sections.map((section) => ({
                id: section.id,
                label: `${section.roleName} · ${ukClock(section.startsAt)}–${ukClock(new Date(section.endsAt))} (UK time)`,
                roleName: section.roleName,
                people: messagePeople(section),
              }))}
            />
          ) : null}
          {status === 'cancelled' ? null : <CancelEvent eventId={event.id} affected={attached} />}
        </span>
      }
    >
      <div className="stack">
        {autosendLine || recipientsLine ? (
          <div className="stack" style={{ gap: 2, textAlign: 'right' }}>
            {autosendLine ? <span className="xs muted">{autosendLine}</span> : null}
            {recipientsLine ? <span className="xs muted">{recipientsLine}</span> : null}
          </div>
        ) : null}
        {status === 'cancelled' ? (
          <Alert tone="coral">
            <b>This event is cancelled.</b> {event.cancelReason ? `"${event.cancelReason}" — ` : ''}
            it stays here for the record.{' '}
            {/* §3.3's resolved edge case: on the day (UK), or after work
                started, the scheduled hours are billed and paid in full. */}
            {event.cancelledAt && cancelledOnTheDay(event.cancelledAt, event.date)
              ? 'It was cancelled on the day, so the scheduled hours are billed to the client and paid to every affected worker in full.'
              : 'It was cancelled before the day, so it is excluded from the financial reports.'}{' '}
            No Allocation Timesheet is generated or sent for it.
          </Alert>
        ) : null}

        <Panel
          title="Event"
          actions={
            <span className="row" style={{ gap: 8 }}>
              <StatusPill status={status} />
              {/* §3.2: the PO NUMBER chip, read-only in the header. */}
              <span className="pochip">
                <span className="k">PO number</span>
                <span className="v">{event.poNumber || '—'}</span>
              </span>
              <Pill tone={fill.open === 0 ? 'green' : 'amber'}>{formatEventFill(fill)}</Pill>
              {/* ADR-0080: auto-assign, Radar and Accept book only staff who speak these. */}
              {languagesLabel ? <Pill tone="cyan">{languagesLabel}</Pill> : null}
              {open ? <span className="muted sm">{open}</span> : null}
              {/* §3.4: purple, default ON; both switches must be on for a round. */}
              <AutoAssignSwitch
                eventId={event.id}
                checked={event.autoAssign}
                disabled={!canToggleAutoAssign(status)}
                label="Auto-assign · event level"
              />
            </span>
          }
        >
          <div className="stack">
            <div className="grid c3">
              <Field label="Client">{event.clientName}</Field>
              <Field label="Venue">
                {event.venueName}
                <span className="sub">{event.venueAddress}</span>
              </Field>
              <Field label="Event window">
                {window ? (
                  <ScheduledWindow
                    className="win mono"
                    lineClass="l2"
                    startsAt={window.startsAt.toISOString()}
                    endsAt={window.endsAt.toISOString()}
                    suffix="UK time"
                  />
                ) : (
                  <span className="mono">—</span>
                )}
                <span className="muted xs">
                  {event.date} · earliest role start → latest role end
                </span>
              </Field>
            </div>

            {/* §3.2, kept visible after creation by §3.3. */}
            <div className="policies">
              <span>
                <b>Break policy</b> — {event.paysBreaks ? 'client pays' : 'client does not pay'}
              </span>
              <span>
                <b>Buffer policy</b> — {event.paysBuffer ? 'client pays' : 'strict'}
              </span>
              <span className="muted">Set at client level; read-only here.</span>
            </div>

            {event.onsiteContact ? (
              <Field label="On-site contact">{event.onsiteContact}</Field>
            ) : null}
            {event.notes ? <Field label="Notes">{event.notes}</Field> : null}
          </div>
        </Panel>

        {sections.length === 0 ? (
          <Panel>
            <div className="empty">This event has no role sections yet.</div>
          </Panel>
        ) : (
          sections.map((section) => (
            <RoleBoard
              key={section.id}
              section={event.sections.find((s) => s.id === section.id)!}
              status={status}
              eventId={event.id}
              clientName={event.clientName}
              eventAutoAssign={event.autoAssign}
              weights={event.weights}
              payrollExported={Boolean(event.payrollExportedAt)}
            />
          ))
        )}

        {/* The audit trail (ADR-0055): closed until asked for — a busy screen. */}
        <RecordHistory entity="event" id={event.id} deferred />
      </div>
    </OfficeShell>
  );
}

const UK_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
});

/** "17:00" — a role's scheduled time, in UK time (§1.8). */
function ukClock(at: Date): string {
  return UK_CLOCK.format(at);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div>{children}</div>
    </div>
  );
}
