import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Panel, Pill } from '@thc/ui';
import {
  type TimeFormat,
  UK_ZONE,
  cancelledOnTheDay,
  derivedEventWindow,
  eventFill,
  eventStatus,
  formatEventFill,
  formatOpen,
  formatTimeIn,
  isEditLocked,
  isNotifiedOnCancel,
  orderSections,
  requiredLanguagesLabel,
  ukToday,
} from '@thc/domain';
import { OfficeShell } from '../../_components/OfficeShell';
import { AutoRefresh } from '../../_components/AutoRefresh';
import { RecordHistory } from '../../_components/history/RecordHistory';
import { ViewerZone } from '../_components/ViewerZone';
import { StatusPill } from '../_components/EventViews';
import { formatDayLong } from '../calendar';
import { backLabel, safeBackHref } from '../_lib/back';
import { ScheduledWindow } from '../_components/ScheduledWindow';
import { loadBoard } from './board-data';
import { currentTimeFormat } from '../../_lib/timeFormat';
import {
  canMessageLineUp,
  canToggleAutoAssign,
  dressCodeSummary,
  messagePeople,
  pushDate,
} from './board-model';
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
 *
 * Streaming (ADR-0161, after ADR-0109). The page awaits only the board's
 * first read — the event, its sections and everyone booked — and decides
 * there between the board and a real 404, before anything streams. Each
 * section's candidate pool (the slow part: `auto_assign_candidates`) and
 * the documents' auto-send line then stream in behind their own Suspense,
 * inside the one `OfficeShell`. Nothing on the board navigates by query, so
 * no boundary sits under a query-only navigation.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // The diary state this board was opened from (`_lib/back.ts`): the week, the
  // filters. Absent on a bookmark or a link from elsewhere — then plain /events.
  const back = safeBackHref((await searchParams).back);
  const scheduling = back ?? '/events';
  // The clock is a cookie read; it starts with the board rather than before it.
  const [format, { event, problem }] = await Promise.all([currentTimeFormat(), loadBoard(id)]);
  // A read that FAILED is not a missing event: say what went wrong instead
  // of a 404 that tells the manager the event does not exist.
  if (problem) {
    return (
      <OfficeShell
        activeHref="/events"
        title="Event board"
        crumbs={
          <>
            <Link href={scheduling}>Scheduling</Link> / <b>Event board</b>
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
  // ADR-0128: each dress code once, here, rather than in every role header.
  const dressCodes = dressCodeSummary(sections);
  const fill = eventFill(
    event.sections.map((section) => ({
      headcount: section.headcount,
      buffer: section.buffer,
      confirmed: section.confirmed.length,
    })),
  );
  const open = formatOpen(fill);
  // ADR-0089: the people the timesheets go to — this event's own list, else the client card.
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
          <Link href={scheduling}>Scheduling</Link> / <b>Event board</b>
        </>
      }
      timezone={<ViewerZone />}
      actions={
        <span className="row" style={{ gap: 8 }}>
          {/* Back to the week (or month, day, list, with its filters) the
              manager came from; the Scheduling tab starts again. */}
          <Link className="btn sm" href={scheduling}>
            ← {backLabel(back)}
          </Link>
          {/* Editing is allowed only up to the event's start (§3.2); on the
              day, a started event still takes a new role (ADR-0177). */}
          {status === 'cancelled' ? null : !locked ? (
            <Link className="btn sm" href={`/events/${event.id}/edit`}>
              Edit
            </Link>
          ) : event.date >= ukToday() ? (
            <Link className="btn sm" href={`/events/${event.id}/edit`}>
              + Add role
            </Link>
          ) : null}
          {/* §3.2: multi-day = separate events via Duplicate — roles, not staff. */}
          <Link className="btn sm" href={`/events/new?from=${event.id}`}>
            Duplicate
          </Link>
          {/* §11.4. No document at all for a cancelled event (§3.3). */}
          {status === 'cancelled' ? null : (
            <>
              {/* ADR-0089: who the timesheets go to, for this event. */}
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
                label: `${section.roleName} · ${ukClock(section.startsAt, format)}–${ukClock(new Date(section.endsAt), format)} (UK time)`,
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
        {/* Accepts, ready confirmations and check-ins arrive while the manager
            watches. Every 60 s: each refresh recomputes every section's pool
            (go-live audit H2). */}
        <AutoRefresh everyMs={60_000} />
        {/* ADR-0074: when the two documents go out on their own (or went) —
            its own read, streamed; the recipients line needs none. */}
        {status === 'cancelled' ? (
          <DocumentHints autosendLine="" recipientsLine={recipientsLine} />
        ) : (
          <Suspense fallback={<DocumentHints autosendLine="" recipientsLine={recipientsLine} />}>
            <AutosendHints
              eventId={event.id}
              started={status === 'ongoing' || status === 'completed'}
              ended={status === 'completed'}
              format={format}
              recipientsLine={recipientsLine}
            />
          </Suspense>
        )}
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
              {/* A cancelled event needs nobody: its fill is a record, not an
                  amber "needs action" (release audit p8). */}
              <Pill tone={status === 'cancelled' ? 'neutral' : fill.open === 0 ? 'green' : 'amber'}>
                {formatEventFill(fill)}
              </Pill>
              {/* ADR-0080: auto-assign, Radar and Accept book only staff who speak these. */}
              {languagesLabel ? <Pill tone="cyan">{languagesLabel}</Pill> : null}
              {/* ADR-0185: confirmed staff are told to bring a passport or driving licence. */}
              {event.securityCleared ? <Pill tone="cyan">Security cleared</Pill> : null}
              {/* ADR-0117: one day of a multi-day job. */}
              {event.seriesLabel ? <Pill tone="cyan">{event.seriesLabel}</Pill> : null}
              {open && status !== 'cancelled' ? <span className="muted sm">{open}</span> : null}
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
                  {formatDayLong(event.date)} · earliest role start → latest role end
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

            {dressCodes.groups.length > 0 ? (
              <Field label={dressCodes.allRoles ? 'Dress code · all roles' : 'Dress code'}>
                {dressCodes.allRoles ? (
                  dressCodes.groups[0]!.dressCode
                ) : (
                  <div className="stack" style={{ gap: 4 }}>
                    {dressCodes.groups.map((group) => (
                      <span key={group.dressCode}>
                        <b>{group.roles.join(' · ')}</b>
                        <span className="muted"> — {group.dressCode}</span>
                      </span>
                    ))}
                  </div>
                )}
              </Field>
            ) : null}
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
              known={event.known}
              format={format}
            />
          ))
        )}

        {/* The audit trail (ADR-0055): closed until asked for — a busy screen. */}
        <RecordHistory entity="event" id={event.id} deferred />
      </div>
    </OfficeShell>
  );
}

/** The auto-send hint (ADR-0074), read behind its own Suspense. */
async function AutosendHints({
  eventId,
  started,
  ended,
  format,
  recipientsLine,
}: {
  eventId: string;
  started: boolean;
  ended: boolean;
  format: TimeFormat;
  recipientsLine: string | null;
}) {
  const autosend = await loadAutosendHints(eventId, { started, ended }, format);
  return (
    <DocumentHints
      autosendLine={[autosend.allocation, autosend.signout].filter(Boolean).join(' · ')}
      recipientsLine={recipientsLine}
    />
  );
}

/** The two quiet lines above the Event panel: when the documents go, and to whom. */
function DocumentHints({
  autosendLine,
  recipientsLine,
}: {
  autosendLine: string;
  recipientsLine: string | null;
}) {
  if (!autosendLine && !recipientsLine) return null;
  return (
    <div className="stack" style={{ gap: 2, textAlign: 'right' }}>
      {autosendLine ? <span className="xs muted">{autosendLine}</span> : null}
      {recipientsLine ? <span className="xs muted">{recipientsLine}</span> : null}
    </div>
  );
}

/** "17:00" or "5:00 pm" — a role's scheduled time, in UK time (§1.8), on the operator's clock. */
function ukClock(at: Date, format: TimeFormat): string {
  return formatTimeIn(at, UK_ZONE, format);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div>{children}</div>
    </div>
  );
}
