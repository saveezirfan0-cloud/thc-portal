'use client';

import { useState } from 'react';
import { Alert, Button, Modal, Note, Textarea } from '@thc/ui';
import {
  UK_ZONE,
  UK_ZONE_LABEL,
  VIEWER_ZONE_LABEL,
  displayTimeRange,
  formatDateTimeIn,
  needsDualZone,
  ukInputLabel,
} from '@thc/domain';
import { resolveViolation } from './actions';
import { VIOLATION_LABEL, flaggedAs, needsActualFinish, reclassifiesToLate } from './status';
import type { ViolationRow } from './types';
import { ukLocalToIso } from './ukLocalToIso';

/**
 * The violation detail window (§9.5), which doubles as the audit trail.
 *
 * The note is mandatory for every type and is never write-only: resolving
 * cancels a show-rate penalty, so the reasoning and its author stay on the
 * entry afterwards. A resolved entry therefore renders as a record rather
 * than a form.
 *
 * Two zones share this window and §1.8 keeps them apart: "operational
 * versus audit". Detected, Checked in and Checked out are stamps the
 * manager acts on today, so they read in the READER's zone on one line
 * ("18:58 your time", checkin.html) — the same clock as the Due pill and
 * the log behind the window. "Resolved by … UK time" and the finish a
 * manager entered are records of a decision already taken, and stay UK.
 *
 * The finish time is validated on the SERVER (`resolve_violation`), and the
 * dialog stays open with whatever it refused — before the check-in, or in
 * the future. There is deliberately no upper bound against the scheduled
 * end: a worker may genuinely have finished later, and RULE-01 caps the
 * payable amount there regardless.
 */
export function ResolveModal({
  violation,
  zone,
  onClose,
}: {
  violation: ViolationRow;
  /** The reader's zone, from the screen's mount-guarded `useViewerZone`. */
  zone: string;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [finish, setFinish] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wantsFinish = needsActualFinish(violation.type);
  const canSubmit = note.trim().length > 0 && (!wantsFinish || finish.length > 0) && !busy;

  // An operational stamp, in the reader's zone, labelled so it is never a
  // bare clock; a UK reader's own zone IS UK time, so the label says so.
  const stamp = (iso: string) =>
    `${formatDateTimeIn(new Date(iso), zone)} ${needsDualZone(zone) ? VIEWER_ZONE_LABEL : UK_ZONE_LABEL}`;
  // An audit record: UK, always (§1.8).
  const audit = (iso: string) => `${formatDateTimeIn(new Date(iso), UK_ZONE)} ${UK_ZONE_LABEL}`;
  const scheduled =
    violation.startsAt && violation.endsAt
      ? displayTimeRange(new Date(violation.startsAt), new Date(violation.endsAt), zone, true)
      : null;

  async function submit() {
    setBusy(true);
    setError(null);
    // The input is UK wall-clock per §1.8; the server takes an instant.
    const iso = wantsFinish && finish ? ukLocalToIso(finish) : null;
    const result = await resolveViolation(violation.id, note, iso);
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    if (result.warning) {
      setWarning(result.warning);
      return;
    }
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${VIOLATION_LABEL[violation.type]} — ${violation.staffName}`}
    >
      <div className="stack" style={{ gap: 12 }}>
        <p className="muted sm">
          {violation.eventTitle} · {violation.venueName} · {violation.roleName}
          {/* The scheduled window, dual like every scheduled time (§1.8). */}
          {scheduled ? (
            <>
              {' '}
              · {scheduled.primary}
              {scheduled.secondary ? ` (${scheduled.secondary})` : ''}
            </>
          ) : null}
        </p>
        <div className="kvs">
          <div className="kv">
            <span className="k">Flagged as</span>
            <span className="v">{flaggedAs(violation)}</span>
          </div>
          <div className="kv">
            <span className="k">Detected</span>
            <span className="v mono">{stamp(violation.detectedAt)}</span>
          </div>
          <div className="kv">
            <span className="k">Checked in</span>
            <span className="v mono">
              {violation.checkInAt ? stamp(violation.checkInAt) : 'never'}
            </span>
          </div>
          <div className="kv">
            <span className="k">Checked out</span>
            <span className="v mono">
              {violation.checkOutAt ? stamp(violation.checkOutAt) : 'no check-out recorded'}
            </span>
          </div>
        </div>

        {violation.resolved ? (
          /* The audit trail: what was decided, by whom, and on what evidence. */
          <>
            <Note tone="green">
              Resolved by {violation.resolvedByName ?? 'a manager'}
              {violation.resolvedAt ? ` · ${audit(violation.resolvedAt)}` : ''}
            </Note>
            <blockquote className="sm">{violation.resolutionNote}</blockquote>
            {violation.actualFinishAt ? (
              <div className="kv">
                <span className="k">Actual finish entered</span>
                <span className="v mono">{audit(violation.actualFinishAt)}</span>
              </div>
            ) : null}
          </>
        ) : (
          <>
            {violation.payrollExported ? (
              <Alert tone="amber">
                This shift has already been included in a payroll export. Resolving will not add the
                payment — please notify Finance to pay it.
              </Alert>
            ) : null}
            {reclassifiesToLate(violation.type) ? (
              <Note>
                Resolving a No-show is the same action as “Get back”: it registers the worker as
                arrived and reclassifies this entry to Late, with the minutes counted from the
                moment you press it.
              </Note>
            ) : null}

            {wantsFinish ? (
              <label className="field">
                <span className="label">
                  {ukInputLabel('Actual finish')} <span className="coral">*</span>
                </span>
                <input
                  className="input"
                  type="datetime-local"
                  value={finish}
                  onChange={(e) => setFinish(e.target.value)}
                />
                <span className="hint">
                  Becomes the shift’s check-out for RULE-01. The four-hour floor applies again once
                  this is resolved.
                </span>
              </label>
            ) : null}

            <label className="field">
              <span className="label">
                Resolve — note <span className="coral">*</span>
              </span>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Mandatory. Explain the outcome — e.g. sent home early by the client's manager, agreed by phone."
              />
              <span className="hint">
                Resolving removes or reduces the effect on the show-rate and marks the entry
                reviewed; the note and your name stay visible on the entry afterwards.
              </span>
            </label>

            {error ? <Alert tone="coral">{error}</Alert> : null}
            {warning ? <Alert tone="amber">{warning}</Alert> : null}
          </>
        )}

        <div className="mf">
          <Button tone="ghost" onClick={onClose}>
            {violation.resolved || warning ? 'Close' : 'Cancel'}
          </Button>
          {violation.resolved || warning ? null : (
            <Button tone="primary" disabled={!canSubmit} onClick={submit}>
              {busy ? 'Resolving…' : 'Resolve'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
