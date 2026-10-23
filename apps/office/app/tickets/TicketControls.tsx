'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, toast } from '@thc/ui';
import { addComment, updateTicket } from './actions';
import { COMMENT_MAX, SEVERITIES, SEVERITY_SHORT, STATUSES, STATUS_LABEL } from './view-model';
import type { TicketSeverity, TicketStatus } from './view-model';
import { lengthHint } from '../_lib/length';

/**
 * The follow-up controls on a ticket (ADR-0199): status and severity, and
 * the thread's comment box. A Viewer sees them, as every Back Office screen
 * draws its controls (ADR-0060), and the database answers `read_only`. A
 * comment is emailed; so is a note sent with a status change.
 */
export function TicketControls({
  id,
  status,
  severity,
  canWrite,
}: {
  id: string;
  status: TicketStatus;
  severity: TicketSeverity | null;
  /** False for a known Viewer: the selects are disabled. */
  canWrite: boolean;
}) {
  const router = useRouter();
  const [nextStatus, setNextStatus] = useState<string>(status);
  const [nextSeverity, setNextSeverity] = useState<string>(severity ?? '');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const changed =
    nextStatus !== status || (nextSeverity !== '' && nextSeverity !== (severity ?? ''));

  const run = (work: () => Promise<{ ok: boolean; message?: string }>, done: string) => {
    setProblem(null);
    start(async () => {
      const result = await work();
      if (!result.ok) {
        setProblem(result.message ?? 'That could not be saved.');
        return;
      }
      setNote('');
      router.refresh();
      toast(done, { tone: 'green' });
    });
  };

  const save = () =>
    run(
      () =>
        updateTicket(id, {
          status: nextStatus !== status ? nextStatus : '',
          severity: nextSeverity !== (severity ?? '') ? nextSeverity : '',
          note,
        }),
      'Ticket updated',
    );

  return (
    <div className="tk-controls">
      <div className="tk-selects">
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
            <option value="">{severity ? 'Keep as is' : 'Not set'}</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_SHORT[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="tk-note">
          Add an update
        </label>
        <textarea
          id="tk-note"
          className="input"
          rows={4}
          value={note}
          maxLength={COMMENT_MAX}
          disabled={pending}
          placeholder="What has changed, what you need, or what you found"
          onChange={(e) => setNote(e.target.value)}
        />
        {lengthHint(note.length, COMMENT_MAX) ? (
          <span className="hint">{lengthHint(note.length, COMMENT_MAX)}</span>
        ) : null}
      </div>

      <div className="tk-actions">
        {canWrite && changed ? (
          <Button tone="primary" disabled={pending} onClick={save}>
            {pending ? 'Saving…' : note.trim() ? 'Save changes and update' : 'Save changes'}
          </Button>
        ) : null}
        {!changed || !canWrite ? (
          <Button
            tone="primary"
            disabled={pending || note.trim() === ''}
            onClick={() => run(() => addComment(id, note), 'Update added')}
          >
            {pending ? 'Sending…' : 'Add update'}
          </Button>
        ) : null}
      </div>
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
    </div>
  );
}
