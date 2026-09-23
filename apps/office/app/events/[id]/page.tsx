import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Panel, Pill } from '@thc/ui';
import {
  UK_ZONE,
  derivedEventWindow,
  eventFill,
  eventStatus,
  formatEventFill,
  formatOpen,
  formatTimeIn,
  isEditLocked,
  orderSections,
} from '@thc/domain';
import { OfficeShell } from '../../_components/OfficeShell';
import { ViewerZone } from '../_components/ViewerZone';
import { StatusPill } from '../_components/EventViews';
import { loadBoard } from './board-data';
import { RoleBoard } from './_components/RoleBoard';
import { CancelEvent } from './_components/CancelEvent';
import { DocumentActions } from './_components/DocumentActions';
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

  const sections = orderSections(
    event.sections.map((section) => ({ ...section, startsAt: new Date(section.startsAt) })),
  );
  const windows = sections.map((section) => ({
    startsAt: section.startsAt,
    endsAt: new Date(section.endsAt),
  }));
  const window = derivedEventWindow(windows);
  const status = eventStatus(window, event.cancelledAt);
  const fill = eventFill(
    event.sections.map((section) => ({
      headcount: section.headcount,
      buffer: section.buffer,
      confirmed: section.confirmed.length,
    })),
  );
  const open = formatOpen(fill);
  const locked = isEditLocked(windows);
  const attached = event.sections.reduce(
    (sum, section) => sum + section.confirmed.length + section.invited.length,
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
          {/* §11.4. No document at all for a cancelled event (§3.3). */}
          {status === 'cancelled' ? null : (
            <DocumentActions
              eventId={event.id}
              started={status === 'ongoing' || status === 'completed'}
            />
          )}
          {status === 'cancelled' ? null : <CancelEvent eventId={event.id} affected={attached} />}
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
            <span className="row" style={{ gap: 8 }}>
              <StatusPill status={status} />
              <Pill tone={fill.open === 0 ? 'green' : 'amber'}>{formatEventFill(fill)}</Pill>
              {open ? <span className="muted sm">{open}</span> : null}
            </span>
          }
        >
          <div className="stack">
            <div className="grid c4">
              <Field label="Client">{event.clientName}</Field>
              <Field label="Venue">
                {event.venueName}
                <span className="sub">{event.venueAddress}</span>
              </Field>
              <Field label="Derived window (UK time)">
                <span className="mono">
                  {window
                    ? `${formatTimeIn(window.startsAt, UK_ZONE)} – ${formatTimeIn(window.endsAt, UK_ZONE)}`
                    : '—'}
                </span>
                <span className="sub">{event.date}</span>
              </Field>
              <Field label="PO number">
                <span className="mono">{event.poNumber || '—'}</span>
              </Field>
            </div>

            {/* §3.2, kept visible after creation by §3.3. */}
            <div className="policies">
              <span>
                <b>Break policy</b> — {event.paysBreaks ? 'client pays' : 'client does not pay'}
              </span>
              <span>
                <b>Buffer policy</b> — {event.paysBuffer ? 'client pays' : 'strict (RULE-15)'}
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
              payrollExported={Boolean(event.payrollExportedAt)}
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
