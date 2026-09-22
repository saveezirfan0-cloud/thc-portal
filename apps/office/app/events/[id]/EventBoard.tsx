'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Alert, Button, Modal, Pill, Switch, Textarea } from '@thc/ui';
import { EVENT_STATUS_LABEL } from '@thc/domain';
import { OfficeShell } from '../../_components/OfficeShell';
import { formatUkDate } from '../../staff/staff';
import { formatUkWindow } from '../../staff/[id]/profile';
import { BoardSection } from './BoardSection';
import { byStartTime } from './board';
import {
  cancelEvent,
  getBack,
  inviteWorker,
  markNoShow,
  setEventAutoAssign,
  setSectionAutoAssign,
  withdrawBooking,
} from './actions';
import type { ActionResult, BoardData, BoardEvent, RosterRow } from './types';
import './board.css';

type Dialog =
  | { kind: 'cancel' }
  | { kind: 'withdraw'; row: RosterRow }
  | { kind: 'getback'; row: RosterRow }
  | null;

const STATUS_TONE = {
  upcoming: 'cyan',
  ongoing: 'green',
  completed: 'neutral',
  cancelled: 'coral',
} as const;

/**
 * /events/:id — the event board (§3.3), matching the BO2 frame.
 *
 * The engine behind this screen has existed for a while with nothing in
 * front of it. Everything here reads what the engine reads and calls what
 * the engine calls: the pool is `auto_assign_candidates`, the ranking is
 * `rankPool`, the invite is `invite_worker(source: manual)`, and Get back
 * is `resolve_violation` — the same function §9.5's log calls, because
 * §3.3 says the two are the same act.
 *
 * Break and buffer policy sit in the header as read-only facts. §3.3 asks
 * for them by name so that both "stay visible after creation, not only
 * while building the event", and they are the EVENT's copies: an event
 * keeps the policy it was built with (§3.2).
 */
export function EventBoard({ data }: { data: BoardData }) {
  const event = data.event as BoardEvent;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (work: () => Promise<ActionResult>, after?: () => void) => {
    setProblem(null);
    setNotice(null);
    start(async () => {
      const result = await work();
      if (result.ok) {
        if (result.message) setNotice(result.message);
        after?.();
      } else {
        setProblem(result.message);
      }
    });
  };

  const close = () => {
    setDialog(null);
    setText('');
  };

  const cancelled = event.status === 'cancelled';

  return (
    <OfficeShell
      activeHref="/events"
      title="Scheduling"
      crumbs={
        <>
          <Link href="/events">Events</Link> / <b>{event.title}</b> ·{' '}
          {formatUkDate(event.event_date)}
        </>
      }
    >
      <div className="stack">
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
        {notice ? <Alert tone="amber">{notice}</Alert> : null}

        {cancelled ? (
          <Alert tone="coral">
            <b>Cancelled — {event.cancel_reason}</b>
            <br />
            <span className="muted sm">
              {event.cancelled_by_name ? `${event.cancelled_by_name} · ` : ''}
              The event stays here greyed out for record-keeping; every confirmed and invited
              worker, and anyone with an open Radar application, was notified (N12, §3.3).
            </span>
          </Alert>
        ) : null}

        <div className="ev-head">
          <div className="top">
            <h2>{event.title}</h2>
            <Pill tone={STATUS_TONE[event.status]} large>
              {EVENT_STATUS_LABEL[event.status]}
            </Pill>
            {event.po_number ? (
              <Pill>
                PO number · <span className="mono">{event.po_number}</span>
              </Pill>
            ) : (
              <span className="muted xs">No PO number</span>
            )}
            <div className="acts">
              <Switch
                checked={event.auto_assign}
                disabled={pending || cancelled}
                purple
                aria-label="Auto-Assign for the whole event"
                onChange={(on) => run(() => setEventAutoAssign(event.id, on))}
              />
              <span className="muted xs">Auto-Assign</span>
              <Button size="sm" disabled={cancelled}>
                <Link href={`/events/${event.id}/edit`}>Edit event</Link>
              </Button>
              <Button
                size="sm"
                tone="danger"
                disabled={pending || cancelled}
                onClick={() => setDialog({ kind: 'cancel' })}
              >
                Cancel event
              </Button>
            </div>
          </div>
          <div className="meta">
            <span>
              Client <b>{event.client_name}</b>
            </span>
            <span>
              Venue <b>{event.venue_name}</b> · geofence {event.geofence_radius_m} m
            </span>
            <span>
              Window <b>{formatUkWindow(event.starts_at, event.ends_at)} UK time</b>
              {event.section_count > 1 ? (
                <span className="muted"> — derived from the role sections (§3.2)</span>
              ) : null}
            </span>
            {/*
              §3.3 asks for both policies as read-only checkmarks so they
              stay visible after creation. These are the EVENT's copies: an
              event bills the policy it was built with (§3.2).
            */}
            <span>
              Break policy <b>{event.pays_breaks ? '✓ client pays' : '✕ deducted'}</b>
            </span>
            <span>
              Buffer policy <b>{event.pays_buffer ? '✓ client pays' : '✕ strict'}</b>
            </span>
            <span>
              On site <b>{event.onsite_contact || event.staff_contact_point}</b>
            </span>
          </div>
        </div>

        {data.sections.length === 0 ? (
          <div className="empty">
            <h3>No role sections</h3>
            <p>
              This event has nothing to staff yet. Add role sections in the{' '}
              <Link href={`/events/${event.id}/edit`}>Shift Builder</Link>.
            </p>
          </div>
        ) : (
          [...data.sections].sort(byStartTime).map((section) => (
            <BoardSection
              key={section.id}
              event={event}
              section={section}
              roster={data.roster}
              candidates={data.candidates[section.id] ?? []}
              people={data.people}
              pending={pending}
              onInvite={(shiftId, staffId) => run(() => inviteWorker(event.id, shiftId, staffId))}
              onWithdraw={(row) => {
                setText('');
                setDialog({ kind: 'withdraw', row });
              }}
              onNoShow={(row) => run(() => markNoShow(event.id, row.booking_id))}
              onGetBack={(row) => {
                setText('');
                setDialog({ kind: 'getback', row });
              }}
              onAutoAssign={(shiftId, on) => run(() => setSectionAutoAssign(event.id, shiftId, on))}
            />
          ))
        )}
      </div>

      <Modal
        open={dialog?.kind === 'cancel'}
        title={`Cancel ${event.title}`}
        onClose={close}
        footer={
          <>
            <Button tone="ghost" onClick={close}>
              Keep the event
            </Button>
            <Button
              tone="danger"
              solid
              disabled={pending || text.trim() === ''}
              onClick={() => run(() => cancelEvent(event.id, text), close)}
            >
              Cancel event
            </Button>
          </>
        }
      >
        <div className="field">
          <span className="label">
            Reason <span className="coral">*</span>
          </span>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. client cancelled the booking"
          />
          <span className="hint">
            Free text, the same pattern as a manual Block (§9.6). Saved on the event and shown here
            afterwards.
          </span>
        </div>
        <div className="sm stack">
          <div>• The event is marked Cancelled and stays in the list and calendar, greyed out</div>
          <div>
            • Every confirmed and invited worker is notified (N12) — and so is anyone with an open
            Radar application, which §3.3 calls out specifically
          </div>
          <div>• Their bookings are released; nothing is deleted</div>
        </div>
      </Modal>

      <Modal
        open={dialog?.kind === 'withdraw'}
        title={dialog?.kind === 'withdraw' ? `Withdraw ${dialog.row.display_name}` : ''}
        onClose={close}
        footer={
          <>
            <Button tone="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              tone="danger"
              solid
              disabled={pending}
              onClick={() =>
                dialog?.kind === 'withdraw' &&
                run(() => withdrawBooking(event.id, dialog.row.booking_id, text), close)
              }
            >
              Withdraw
            </Button>
          </>
        }
      >
        <p className="sm">
          {dialog?.kind === 'withdraw' && dialog.row.status === 'confirmed'
            ? 'They are taken off the shift and told their booking was released (N10b). The slot reopens for auto-assign.'
            : 'The invitation is withdrawn. Nothing was promised, so nobody is notified.'}
        </p>
        <div className="field">
          <span className="label">Reason (internal, optional)</span>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      </Modal>

      <Modal
        open={dialog?.kind === 'getback'}
        title={dialog?.kind === 'getback' ? `Get back · ${dialog.row.display_name}` : ''}
        onClose={close}
        footer={
          <>
            <Button tone="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              tone="primary"
              disabled={pending || text.trim() === ''}
              onClick={() =>
                dialog?.kind === 'getback' &&
                dialog.row.no_show_violation &&
                run(() => getBack(event.id, dialog.row.no_show_violation as string, text), close)
              }
            >
              Get back
            </Button>
          </>
        }
      >
        <p className="sm">
          This registers them as arrived now and reclassifies the No-show to <b>Late</b>, with the
          minutes measured from this press. It is the same action as <b>Resolve</b> on the entry in
          the violation log (§3.3, §9.5) — which is why the note is mandatory here too.
        </p>
        <div className="field">
          <span className="label">
            Note <span className="coral">*</span>
          </span>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. train strike, arrived 52 min late, worked the full shift"
          />
        </div>
      </Modal>
    </OfficeShell>
  );
}
