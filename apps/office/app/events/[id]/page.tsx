import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Panel, Pill } from '@thc/ui';
import {
  derivedEventWindow,
  eventFill,
  eventStatus,
  formatEventFill,
  formatOpen,
  isEditLocked,
  orderSections,
} from '@thc/domain';
import { OfficeShell } from '../../_components/OfficeShell';
import { formatDayLong } from '../calendar';
import { ViewerZone } from '../_components/ViewerZone';
import { ScheduledWindow } from '../_components/ScheduledWindow';
import { StatusPill } from '../_components/EventViews';
import { loadBoard } from './board-data';
import { canToggleAutoAssign, cancelCounts, eventResult, formatResult } from './board-rules';
import { RoleBoard } from './_components/RoleBoard';
import { AutoAssignSwitch } from './_components/AutoAssignSwitch';
import { CancelEvent } from './_components/CancelEvent';
import { DocumentActions } from './_components/DocumentActions';
import { DuplicateEvent } from './_components/DuplicateEvent';
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
  const event = await loadBoard(id);
  if (!event) notFound();

  const now = new Date();
  const sections = orderSections(
    event.sections.map((section) => ({ ...section, startsAt: new Date(section.startsAt) })),
  );
  const windows = sections.map((section) => ({
    startsAt: section.startsAt,
    endsAt: new Date(section.endsAt),
  }));
  const window = derivedEventWindow(windows);
  const status = eventStatus(window, event.cancelledAt, now);
  const fill = eventFill(
    event.sections.map((section) => ({
      headcount: section.headcount,
      buffer: section.buffer,
      confirmed: section.confirmed.length,
    })),
  );
  const open = formatOpen(fill);
  const locked = isEditLocked(windows, now);
  const dateLabel = formatDayLong(event.date);
  const counts = cancelCounts(event.sections);
  const result = status === 'completed' ? eventResult({ sections: event.sections }) : null;

  return (
    <OfficeShell
      activeHref="/events"
      // event-board.html:119 — the status pill and the PO chip sit beside the h1.
      title={
        <span className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {event.title}
          <StatusPill status={status} />
          {event.poNumber ? (
            <span className="pochip">
              <span className="k">PO number</span>
              <span className="v">{event.poNumber}</span>
            </span>
          ) : null}
        </span>
      }
      crumbs={
        <>
          <Link href="/events">Scheduling</Link> / <b>Event board</b>
        </>
      }
      timezone={<ViewerZone />}
      actions={
        <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {/* Editing is allowed only up to the event's start (§3.2); the
              button stays, disabled, so the lock is visible (event-board.html:243). */}
          {status === 'cancelled' ? null : locked ? (
            <button className="btn sm" type="button" disabled title="editing locked at event start">
              Edit
            </button>
          ) : (
            <Link className="btn sm" href={`/events/${event.id}/edit`}>
              Edit
            </Link>
          )}
          {/* §3.2: multi-day = separate events via Duplicate; a cancelled
              event is re-run this way too (ShiftBuilder's own note). */}
          <DuplicateEvent eventId={event.id} title={event.title} date={event.date} />
          {/* §11.4. No document at all for a cancelled event (§3.3). */}
          {status === 'cancelled' ? null : <DocumentActions eventId={event.id} status={status} />}
          {status === 'cancelled' ? null : (
            <CancelEvent
              eventId={event.id}
              title={event.title}
              dateLabel={dateLabel}
              counts={counts}
              disabled={status === 'completed'}
            />
          )}
        </span>
      }
    >
      <div className="stack">
        {status === 'cancelled' ? (
          <Alert tone="coral">
            <b>This event is cancelled.</b> {event.cancelReason ? `"${event.cancelReason}" — ` : ''}
            it stays here for the record and is excluded from financial reports (§9.9). No
            allocation sheet or timesheet is generated for it (§11.3).
          </Alert>
        ) : null}

        <Panel
          title="Event"
          actions={
            <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Pill tone={fill.open === 0 ? 'green' : 'amber'}>{formatEventFill(fill)}</Pill>
              {open ? <span className="muted sm">{open}</span> : null}
              {/* §3.4: the event-level switch, through the Ongoing state. */}
              {canToggleAutoAssign(status) ? (
                <AutoAssignSwitch
                  eventId={event.id}
                  checked={event.autoAssign}
                  label="Auto-assign · event level"
                />
              ) : null}
            </span>
          }
        >
          <div className="stack">
            <div className="grid c4">
              <Field label="Client">{event.clientName}</Field>
              <Field label="Venue">
                {event.venueName}
                <span className="sub">
                  {event.venueAddress}
                  {event.geofenceRadiusM ? ` · geofence ${event.geofenceRadiusM} m` : ''}
                </span>
              </Field>
              <Field label="Event window">
                {/* Scheduled, so both zones for a reader outside the UK (§1.8). */}
                <span className="mono evwin">
                  {window ? (
                    <ScheduledWindow startsAt={window.startsAt} endsAt={window.endsAt} labelled />
                  ) : (
                    '—'
                  )}
                </span>
                <span className="sub">
                  {dateLabel} · earliest role start → latest role end (RULE-18)
                </span>
              </Field>
              <Field label="On-site contact">{event.onsiteContact || '—'}</Field>
            </div>

            {/* §3.2's read-only checkmarks, kept visible after creation (§3.3). */}
            <div className="policies">
              <span className="label">Client policies</span>
              <span className="check">
                <span className={`box ${event.paysBreaks ? 'on' : 'off'}`} />
                Break policy —{' '}
                {event.paysBreaks
                  ? 'client pays breaks'
                  : 'client does not pay breaks (staff log breaks)'}
              </span>
              <span className="check">
                <span className={`box ${event.paysBuffer ? 'on' : 'off'}`} />
                Buffer policy —{' '}
                {event.paysBuffer
                  ? 'client pays for the buffer'
                  : 'strict: surplus turned away at check-in (RULE-15)'}
              </span>
              <span className="muted">Set at client level; read-only here.</span>
            </div>

            {result ? <Field label="Result">{formatResult(result)}</Field> : null}
            {event.notes ? <Field label="Notes for staff">{event.notes}</Field> : null}
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
              eventTitle={event.title}
              eventDateLabel={dateLabel}
              clientName={event.clientName}
              escalationRadiusMiles={event.escalationRadiusMiles}
              now={now}
            />
          ))
        )}
      </div>
    </OfficeShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div>{children}</div>
    </div>
  );
}
