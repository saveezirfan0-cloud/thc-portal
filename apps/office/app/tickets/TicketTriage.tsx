'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, toast } from '@thc/ui';
import { DictateButton } from '../_components/DictateButton';
import { appendDictation } from '../_lib/dictation';
import { lengthHint } from '../_lib/length';
import { assignTicket, setKind, updateTicket } from './actions';
import { announceTimerChange } from './timerEvents';
import {
  KINDS,
  KIND_SHORT,
  RESOLUTION_MAX,
  SEVERITIES,
  SEVERITY_SHORT,
  STATUSES,
  STATUS_LABEL,
} from './view-model';
import type { TicketKind, TicketSeverity, TicketStatus } from './view-model';

/**
 * Triage (ADR-0202): status, category, severity and owner, and — when the
 * ticket is Resolved or Closed — a resolution note that is emailed to
 * whoever reported it. One Save applies whatever changed. A Viewer sees the
 * fields disabled (the database would answer `read_only`).
 */
export function TicketTriage({
  id,
  status,
  kind,
  severity,
  assigneeId,
  resolution,
  reporterName,
  assignees,
  canWrite,
}: {
  id: string;
  status: TicketStatus;
  kind: TicketKind;
  severity: TicketSeverity | null;
  assigneeId: string | null;
  resolution: string | null;
  reporterName: string;
  assignees: { id: string; full_name: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [nextStatus, setNextStatus] = useState<string>(status);
  const [nextKind, setNextKind] = useState<string>(kind);
  const [nextSeverity, setNextSeverity] = useState<string>(severity ?? 'none');
  const [nextOwner, setNextOwner] = useState<string>(assigneeId ?? '');
  const [note, setNote] = useState(resolution ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const closing = nextStatus === 'resolved' || nextStatus === 'closed';
  const noteChanged = closing && note.trim() !== (resolution ?? '').trim() && note.trim() !== '';
  const changed =
    nextStatus !== status ||
    nextKind !== kind ||
    nextSeverity !== (severity ?? 'none') ||
    nextOwner !== (assigneeId ?? '') ||
    noteChanged;

  const save = () =>
    start(async () => {
      setProblem(null);
      // Category and owner first: they do not depend on the status, and a
      // refusal there should stop before anything is emailed.
      if (nextKind !== kind) {
        const r = await setKind(id, nextKind);
        if (!r.ok) return setProblem(r.message);
      }
      if (nextOwner !== (assigneeId ?? '')) {
        const r = await assignTicket(id, nextOwner);
        if (!r.ok) return setProblem(r.message);
      }
      if (nextStatus !== status || nextSeverity !== (severity ?? 'none') || noteChanged) {
        const r = await updateTicket(id, {
          status: nextStatus !== status ? nextStatus : '',
          severity: nextSeverity !== (severity ?? 'none') ? nextSeverity : '',
          resolution: noteChanged ? note : '',
        });
        if (!r.ok) return setProblem(r.message);
      }
      // Putting a ticket on hold or finishing it stops the owner's running timer.
      announceTimerChange();
      router.refresh();
      toast(noteChanged ? `Saved. ${reporterName} has been emailed the note.` : 'Saved', {
        tone: 'green',
      });
    });

  return (
    <div className="tk-triage">
      <div className="tk-grid">
        <div className="field">
          <label className="label" htmlFor="tk-status">
            Status
          </label>
          <select
            id="tk-status"
            className="input"
            value={nextStatus}
            disabled={pending || !canWrite}
            onChange={(e) => setNextStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="tk-kind">
            Category
          </label>
          <select
            id="tk-kind"
            className="input"
            value={nextKind}
            disabled={pending || !canWrite}
            onChange={(e) => setNextKind(e.target.value)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_SHORT[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="tk-severity">
            Severity
          </label>
          <select
            id="tk-severity"
            className="input"
            value={nextSeverity}
            disabled={pending || !canWrite}
            onChange={(e) => setNextSeverity(e.target.value)}
          >
            <option value="none">— None —</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_SHORT[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="tk-owner">
            Owner
          </label>
          <select
            id="tk-owner"
            className="input"
            value={nextOwner}
            disabled={pending || !canWrite}
            onChange={(e) => setNextOwner(e.target.value)}
          >
            <option value="">— Unassigned —</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {closing ? (
        <div className="field tk-resolution">
          <div className="label-row">
            <label className="label" htmlFor="tk-resolution">
              Resolution
            </label>
            <DictateButton
              label="Dictate resolution"
              disabled={pending || !canWrite}
              onText={(spoken) => setNote((n) => appendDictation(n, spoken, RESOLUTION_MAX))}
            />
          </div>
          <span className="hint">
            {reporterName} is emailed this note when the report is closed.
          </span>
          <textarea
            id="tk-resolution"
            className="input"
            rows={3}
            value={note}
            maxLength={RESOLUTION_MAX}
            disabled={pending || !canWrite}
            placeholder="What was done about it — the fix, the decision, or why it was dismissed."
            onChange={(e) => setNote(e.target.value)}
          />
          {lengthHint(note.length, RESOLUTION_MAX) ? (
            <span className="hint">{lengthHint(note.length, RESOLUTION_MAX)}</span>
          ) : null}
        </div>
      ) : null}

      {canWrite ? (
        <div className="tk-actions">
          <Button tone="primary" disabled={pending || !changed} onClick={save}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      ) : null}
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
    </div>
  );
}
