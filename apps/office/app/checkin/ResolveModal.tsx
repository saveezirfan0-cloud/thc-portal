'use client';

import { useState } from 'react';
import { Alert, Button, Modal, Note, Textarea } from '@thc/ui';
import { UK_ZONE, formatDateTimeIn, ukInputLabel } from '@thc/domain';
import { resolveViolation } from './actions';
import { VIOLATION_LABEL, needsActualFinish, reclassifiesToLate } from './status';
import type { ViolationRow } from './types';

/**
 * The violation detail window (§9.5), which doubles as the audit trail.
 *
 * The note is mandatory for every type and is never write-only: resolving
 * cancels a show-rate penalty, so the reasoning and its author stay on the
 * entry afterwards. A resolved entry therefore renders as a record rather
 * than a form.
 *
 * The finish time is validated on the SERVER (`resolve_violation`), and the
 * dialog stays open with whatever it refused — before the check-in, or in
 * the future. There is deliberately no upper bound against the scheduled
 * end: a worker may genuinely have finished later, and RULE-01 caps the
 * payable amount there regardless.
 */
export function ResolveModal({
  violation,
  onClose,
}: {
  violation: ViolationRow;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [finish, setFinish] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wantsFinish = needsActualFinish(violation.type);
  const canSubmit = note.trim().length > 0 && (!wantsFinish || finish.length > 0) && !busy;

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
        </p>
        <div className="kvs">
          <div className="kv">
            <span className="k">Detected</span>
            <span className="v mono">
              {formatDateTimeIn(new Date(violation.detectedAt), UK_ZONE)} UK
            </span>
          </div>
          <div className="kv">
            <span className="k">Checked in</span>
            <span className="v mono">
              {violation.checkInAt
                ? `${formatDateTimeIn(new Date(violation.checkInAt), UK_ZONE)} UK`
                : 'never'}
            </span>
          </div>
          <div className="kv">
            <span className="k">Checked out</span>
            <span className="v mono">
              {violation.checkOutAt
                ? `${formatDateTimeIn(new Date(violation.checkOutAt), UK_ZONE)} UK`
                : 'no check-out recorded'}
            </span>
          </div>
        </div>

        {violation.resolved ? (
          /* The audit trail: what was decided, by whom, and on what evidence. */
          <>
            <Note tone="green">
              Resolved by {violation.resolvedByName ?? 'a manager'}
              {violation.resolvedAt
                ? ` · ${formatDateTimeIn(new Date(violation.resolvedAt), UK_ZONE)} UK`
                : ''}
            </Note>
            <blockquote className="sm">{violation.resolutionNote}</blockquote>
            {violation.actualFinishAt ? (
              <div className="kv">
                <span className="k">Actual finish entered</span>
                <span className="v mono">
                  {formatDateTimeIn(new Date(violation.actualFinishAt), UK_ZONE)} UK
                </span>
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

/**
 * `datetime-local` gives a wall clock with no zone. §1.8 says this field is
 * UK time, so it is read as UK and converted to the instant the server
 * stores — not as the manager's own zone, which is the bug this avoids for
 * anyone working outside the UK.
 */
export function ukLocalToIso(local: string): string {
  const [date, time] = local.split('T');
  const [y, m, d] = (date ?? '').split('-').map(Number);
  const [hh, mm] = (time ?? '').split(':').map(Number);
  const guess = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  // Europe/London is UTC or UTC+1; find the offset that round-trips.
  for (const offset of [0, -3600_000]) {
    const candidate = new Date(guess + offset);
    const back = formatDateTimeIn(candidate, UK_ZONE);
    const wanted = formatDateTimeIn(new Date(guess), 'UTC');
    if (back === wanted) return candidate.toISOString();
  }
  return new Date(guess).toISOString();
}
