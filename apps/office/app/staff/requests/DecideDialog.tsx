'use client';

import { useState, useTransition } from 'react';
import { Alert, Avatar, Button, Checkbox, Modal, Textarea } from '@thc/ui';
import { CHANGE_REASON_MAX } from '@thc/domain';
import { changeEvidenceLink, decideChangeRequest } from './actions';
import {
  canApprove,
  evidenceName,
  kindLabel,
  nameBefore,
  nameRequested,
  requestedAt,
} from './model';
import type { ChangeRequestView } from './types';
import './requests.css';

export type DecideStage = 'review' | 'approve' | 'reject';

/**
 * The office's Approve / Reject on a change request (ADR-0045),
 * `wireframes/backoffice/change-requests.html` — the "Approve name" and
 * "Reject" states. Used by the /staff/requests queue (which opens straight
 * on Approve or Reject) and the /staff/:id banner (which opens on Review:
 * both sides, then either button).
 *
 * Approving a NAME needs the tick "I've checked the evidence matches the
 * right-to-work document" — the button stays disabled without it, and the
 * server action asks again. Rejecting needs a reason, labelled "shown to
 * the worker": it is what the app prints after "Not changed:" (RC3).
 */
export function DecideDialog({
  request,
  stage,
  onStage,
  onClose,
}: {
  request: ChangeRequestView | null;
  stage: DecideStage;
  onStage: (stage: DecideStage) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!request) return null;
  const first = request.display_name.split(' ')[0] ?? request.display_name;
  const kind = kindLabel(request.kind).toLowerCase();

  const close = () => {
    setChecked(false);
    setReason('');
    setProblem(null);
    onClose();
  };

  const decide = (approve: boolean) => {
    setProblem(null);
    start(async () => {
      const result = await decideChangeRequest(request.id, approve, reason, checked);
      if (result.ok) close();
      else setProblem(result.message);
    });
  };

  const openEvidence = () => {
    setProblem(null);
    start(async () => {
      const result = await changeEvidenceLink(request.id);
      if (result.ok && result.url) window.open(result.url, '_blank', 'noopener');
      else if (!result.ok) setProblem(result.message);
    });
  };

  const evidence = evidenceName(request.evidence_path);
  const evidenceLink = evidence ? (
    <button type="button" className="cr-link" disabled={pending} onClick={openEvidence}>
      {evidence} ↗
    </button>
  ) : (
    <span className="muted">—</span>
  );

  const title =
    stage === 'approve'
      ? `Approve ${kind} change — ${request.display_name}`
      : stage === 'reject'
        ? `Reject ${kind} change — ${request.display_name}`
        : `${kindLabel(request.kind)} change — ${request.display_name}`;

  const footer =
    stage === 'approve' ? (
      <>
        <Button tone="ghost" onClick={close}>
          Cancel
        </Button>
        <Button
          tone="primary"
          disabled={pending || !canApprove(request.kind, checked)}
          title={canApprove(request.kind, checked) ? undefined : 'Tick the evidence check first'}
          onClick={() => decide(true)}
        >
          Approve
        </Button>
      </>
    ) : stage === 'reject' ? (
      <>
        <Button tone="ghost" onClick={close}>
          Cancel
        </Button>
        <Button
          tone="danger"
          solid
          disabled={pending || reason.trim() === ''}
          onClick={() => decide(false)}
        >
          Reject
        </Button>
      </>
    ) : (
      <>
        <Button tone="ghost" onClick={close}>
          Cancel
        </Button>
        <Button tone="danger" disabled={pending} onClick={() => onStage('reject')}>
          Reject
        </Button>
        <Button tone="primary" disabled={pending} onClick={() => onStage('approve')}>
          Approve
        </Button>
      </>
    );

  return (
    <Modal open title={title} onClose={close} footer={footer} wide={request.kind === 'photo'}>
      <div className="stack cr-dialog">
        {problem ? <Alert tone="coral">{problem}</Alert> : null}

        {request.kind === 'name' ? (
          <div className="kv">
            <span className="k">Now</span>
            <span>{nameBefore(request) ?? '—'}</span>
            <span className="k">{stage === 'approve' ? 'New name' : 'Requested'}</span>
            <span>
              <b>{nameRequested(request) ?? '—'}</b>
            </span>
            <span className="k">Evidence</span>
            <span>{evidenceLink}</span>
            {request.worker_note ? (
              <>
                <span className="k">Note</span>
                <span>&ldquo;{request.worker_note}&rdquo;</span>
              </>
            ) : null}
            <span className="k">Requested</span>
            <span className="mono sm">{requestedAt(request.created_at)}</span>
          </div>
        ) : (
          <div className="cr-sides">
            <div className="side">
              <span className="label">Now</span>
              <Avatar
                size="xl"
                name={request.display_name}
                src={request.current_photo_url ?? undefined}
              />
            </div>
            <div className="arrow" aria-hidden>
              →
            </div>
            <div className="side">
              <span className="label">Requested</span>
              <Avatar
                size="xl"
                name={request.display_name}
                src={request.proposed_photo_url ?? undefined}
              />
              <span className="xs muted">signed URL · expires in 10 min</span>
            </div>
            {request.worker_note ? (
              <div className="side">
                <span className="label">Note from {first}</span>
                <div className="sm">&ldquo;{request.worker_note}&rdquo;</div>
              </div>
            ) : null}
          </div>
        )}

        {stage === 'approve' && request.kind === 'name' ? (
          <>
            <Checkbox checked={checked} onChange={setChecked}>
              I&rsquo;ve checked the evidence matches the right-to-work document
            </Checkbox>
            <p className="xs muted">
              The name changes on the profile now. Payroll and admin@ are emailed (RC4); {first}{' '}
              gets a push (RC2). Timesheets, allocation sheets and payroll exports already issued
              are not changed. No new right-to-work check is started (Q13).
            </p>
          </>
        ) : null}

        {stage === 'approve' && request.kind === 'photo' ? (
          <p className="xs muted">
            The new photo shows on the profile, the check-in monitor and the client line-up from
            now, and is printed on the next timesheet. Documents already issued keep the old photo,
            and the old file is kept. {first} gets a push (RC2).
          </p>
        ) : null}

        {stage === 'reject' ? (
          <Textarea
            label="Reason · shown to the worker"
            value={reason}
            maxLength={CHANGE_REASON_MAX}
            onChange={(event) => setReason(event.target.value)}
            hint={`Required. ${first} sees it in the app as “Not changed: {reason}” (RC3).`}
          />
        ) : null}
      </div>
    </Modal>
  );
}
