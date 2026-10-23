'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal, Pill, toast } from '@thc/ui';
import { formatDateTimeIn, UK_ZONE } from '@thc/domain';
import type { TimeFormat } from '@thc/domain';
import { logTime, editTime, removeTime, setScope, startTimer, stopTimer } from './actions';
import type { TimeDraft } from './actions';
import { announceTimerChange } from './timerEvents';
import type { RunningTimer, TicketScope, TimeEntry } from './types';
import {
  NOTE_MAX,
  SCOPE_HELP,
  SCOPE_LABELS,
  SCOPE_SHORT,
  WORKERS,
  WORKER_LABEL,
  formatClock,
  formatMinutes,
  isOutsideScope,
} from './view-model';
import type { ScopeLabel, Worker } from './view-model';

/** The elapsed time of a running timer, ticking every second. */
function useElapsed(startedAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return startedAt ? Math.max(0, (now - new Date(startedAt).getTime()) / 1000) : 0;
}

export function RunningClock({ startedAt }: { startedAt: string }) {
  return <span className="tk-clock">{formatClock(useElapsed(startedAt))}</span>;
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: UK_ZONE }).format(new Date());

/**
 * The owner's own tracking for a ticket (ADR-0202) — drawn only for a login
 * the database calls a tracker, and hidden from everyone else by the
 * database as well as by this file. The scope label is set AFTER a ticket is
 * raised; the time is a start / stop timer or a manual entry, labelled
 * Me / Claude, billable or not.
 */
export function TicketTracking({
  ticketId,
  ticketNo,
  scope,
  entries,
  running,
  format,
}: {
  ticketId: string;
  ticketNo: number;
  scope: TicketScope | null;
  entries: TimeEntry[];
  /** The caller's running timer, on this or any ticket. */
  running: RunningTimer | null;
  format?: TimeFormat;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  const [label, setLabel] = useState<string>(scope?.label ?? '');
  const [scopeNote, setScopeNote] = useState(scope?.note ?? '');
  const [timerBy, setTimerBy] = useState<Worker>('owner');
  const [stopNote, setStopNote] = useState('');
  const [draft, setDraft] = useState<TimeDraft>({
    duration: '',
    workedBy: 'owner',
    workedOn: '',
    note: '',
    billable: null,
  });
  const [editing, setEditing] = useState<TimeEntry | null>(null);

  const here = running && running.ticket_id === ticketId ? running : null;
  const elsewhere = running && running.ticket_id !== ticketId ? running : null;
  const defaultBillable = isOutsideScope((label || null) as ScopeLabel | null);
  const stamp = (iso: string) => formatDateTimeIn(new Date(iso), UK_ZONE, format);

  const done = (message: string) => {
    announceTimerChange();
    router.refresh();
    toast(message, { tone: 'green' });
  };
  const run = (work: () => Promise<{ ok: boolean; message?: string }>, message: string) =>
    start(async () => {
      setProblem(null);
      const result = await work();
      if (!result.ok) return setProblem(result.message ?? 'That could not be saved.');
      done(message);
    });

  const finished = entries.filter((e) => e.minutes !== null);
  const total = finished.reduce((n, e) => n + (e.minutes ?? 0), 0);
  const billable = finished.filter((e) => e.billable).reduce((n, e) => n + (e.minutes ?? 0), 0);

  return (
    <div className="tk-tracking">
      <p className="hint">Internal — only you can see this. THC and the reporter never do.</p>

      <div className="field">
        <label className="label" htmlFor="tk-scope">
          Against the original scope
        </label>
        <div className="tk-row-inline">
          <select
            id="tk-scope"
            className="input"
            value={label}
            disabled={pending}
            onChange={(e) => setLabel(e.target.value)}
          >
            <option value="">Not labelled yet</option>
            {SCOPE_LABELS.map((l) => (
              <option key={l} value={l}>
                {SCOPE_SHORT[l]} — {SCOPE_HELP[l]}
              </option>
            ))}
          </select>
          <Button
            disabled={
              pending || (label === (scope?.label ?? '') && scopeNote === (scope?.note ?? ''))
            }
            onClick={() => run(() => setScope(ticketId, label, scopeNote), 'Label saved')}
          >
            Save label
          </Button>
        </div>
        <input
          className="input"
          aria-label="Scope note"
          placeholder="Optional note — e.g. which section of the scope this is, or why it is an addition"
          value={scopeNote}
          maxLength={NOTE_MAX}
          disabled={pending}
          onChange={(e) => setScopeNote(e.target.value)}
        />
      </div>

      <div className="field">
        <span className="label">Timer</span>
        {here ? (
          <div className="tk-timer on">
            <span>
              <b>Running</b> · {WORKER_LABEL[here.worked_by]} ·{' '}
              <RunningClock startedAt={here.started_at} />
            </span>
            <input
              className="input"
              aria-label="Note for this time"
              placeholder="What was done (optional)"
              value={stopNote}
              maxLength={NOTE_MAX}
              disabled={pending}
              onChange={(e) => setStopNote(e.target.value)}
            />
            <Button
              tone="primary"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const r = await stopTimer(stopNote);
                  if (r.ok) setStopNote('');
                  return r;
                }, 'Timer stopped — time logged')
              }
            >
              Stop and log
            </Button>
          </div>
        ) : (
          <div className="tk-timer">
            <select
              className="input"
              aria-label="Who is working on it"
              value={timerBy}
              disabled={pending}
              onChange={(e) => setTimerBy(e.target.value as Worker)}
            >
              {WORKERS.map((w) => (
                <option key={w} value={w}>
                  Worked by {WORKER_LABEL[w]}
                </option>
              ))}
            </select>
            <Button
              tone="primary"
              disabled={pending || elsewhere !== null}
              onClick={() => run(() => startTimer(ticketId, timerBy), 'Timer started')}
            >
              Start timer
            </Button>
            {elsewhere ? (
              <span className="hint">
                A timer is already running on{' '}
                <a href={`/tickets/${elsewhere.ticket_id}`}>TK-{elsewhere.ticket_no}</a>.
              </span>
            ) : (
              <span className="hint">
                Starting it moves a New ticket to In progress; resolving, closing or putting the
                ticket on hold stops it.
              </span>
            )}
          </div>
        )}
      </div>

      <div className="field">
        <span className="label">Log time by hand</span>
        <div className="tk-log">
          <input
            className="input"
            aria-label="Time spent"
            placeholder="15, 1h 30m, 1.5h"
            value={draft.duration}
            disabled={pending}
            onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
          />
          <select
            className="input"
            aria-label="Worked by"
            value={draft.workedBy}
            disabled={pending}
            onChange={(e) => setDraft({ ...draft, workedBy: e.target.value })}
          >
            {WORKERS.map((w) => (
              <option key={w} value={w}>
                {WORKER_LABEL[w]}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="date"
            aria-label="Day worked"
            value={draft.workedOn || today()}
            max={today()}
            disabled={pending}
            onChange={(e) => setDraft({ ...draft, workedOn: e.target.value })}
          />
        </div>
        <input
          className="input"
          aria-label="What was done"
          placeholder="What was done (optional) — e.g. after the email from THC"
          value={draft.note}
          maxLength={NOTE_MAX}
          disabled={pending}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />
        <label className="tk-check">
          <input
            type="checkbox"
            checked={draft.billable ?? defaultBillable}
            disabled={pending}
            onChange={(e) => setDraft({ ...draft, billable: e.target.checked })}
          />{' '}
          Billable
          {draft.billable === null && defaultBillable ? (
            <span className="hint"> (ticked because the label says it is outside the scope)</span>
          ) : null}
        </label>
        <div className="tk-actions">
          <Button
            tone="primary"
            disabled={pending || draft.duration.trim() === ''}
            onClick={() =>
              run(async () => {
                const r = await logTime(ticketId, draft);
                if (r.ok) setDraft({ ...draft, duration: '', note: '', billable: null });
                return r;
              }, 'Time logged')
            }
          >
            Log time
          </Button>
        </div>
      </div>

      {problem ? <Alert tone="coral">{problem}</Alert> : null}

      <div className="field">
        <span className="label">
          Time on TK-{ticketNo} · {formatMinutes(total)} in all · {formatMinutes(billable)} billable
        </span>
        {finished.length === 0 ? (
          <p className="hint">No time logged yet.</p>
        ) : (
          <table className="tk-time">
            <thead>
              <tr>
                <th>Day</th>
                <th>Time</th>
                <th>By</th>
                <th>Billable</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {finished.map((e) => (
                <tr key={e.id}>
                  <td>{e.worked_on}</td>
                  <td>{formatMinutes(e.minutes ?? 0)}</td>
                  <td>{WORKER_LABEL[e.worked_by]}</td>
                  <td>
                    <Pill tone={e.billable ? 'green' : 'neutral'}>
                      {e.billable ? 'Billable' : 'Not billed'}
                    </Pill>
                  </td>
                  <td>
                    {e.note ?? ''}
                    {e.started_at && e.ended_at ? (
                      <span className="hint">
                        {' '}
                        {stamp(e.started_at)}–{stamp(e.ended_at).slice(-5)}
                      </span>
                    ) : null}
                  </td>
                  <td className="tk-row-actions">
                    <button
                      type="button"
                      className="btn sm"
                      disabled={pending}
                      onClick={() => setEditing(e)}
                    >
                      Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="btn sm danger"
                      disabled={pending}
                      onClick={() => run(() => removeTime(ticketId, e.id), 'Time entry removed')}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing ? (
        <EditEntry
          entry={editing}
          onClose={() => setEditing(null)}
          onSave={(next) =>
            run(async () => {
              const r = await editTime(ticketId, editing.id, next);
              if (r.ok) setEditing(null);
              return r;
            }, 'Time entry saved')
          }
          pending={pending}
        />
      ) : null}
    </div>
  );
}

function EditEntry({
  entry,
  onClose,
  onSave,
  pending,
}: {
  entry: TimeEntry;
  onClose: () => void;
  onSave: (draft: TimeDraft) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState<TimeDraft>({
    duration: formatMinutes(entry.minutes ?? 0),
    workedBy: entry.worked_by,
    workedOn: entry.worked_on,
    note: entry.note ?? '',
    billable: entry.billable,
  });
  return (
    <Modal
      open
      title="Edit time entry"
      onClose={onClose}
      dismissible={!pending}
      onSubmit={() => onSave(draft)}
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" tone="primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="tk-edit-duration">
          Time
        </label>
        <input
          id="tk-edit-duration"
          className="input"
          value={draft.duration}
          onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="tk-edit-by">
          Worked by
        </label>
        <select
          id="tk-edit-by"
          className="input"
          value={draft.workedBy}
          onChange={(e) => setDraft({ ...draft, workedBy: e.target.value })}
        >
          {WORKERS.map((w) => (
            <option key={w} value={w}>
              {WORKER_LABEL[w]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="tk-edit-day">
          Day
        </label>
        <input
          id="tk-edit-day"
          className="input"
          type="date"
          max={today()}
          value={draft.workedOn}
          onChange={(e) => setDraft({ ...draft, workedOn: e.target.value })}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="tk-edit-note">
          Note
        </label>
        <input
          id="tk-edit-note"
          className="input"
          value={draft.note}
          maxLength={NOTE_MAX}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />
      </div>
      <label className="tk-check">
        <input
          type="checkbox"
          checked={draft.billable ?? false}
          onChange={(e) => setDraft({ ...draft, billable: e.target.checked })}
        />{' '}
        Billable
      </label>
    </Modal>
  );
}
