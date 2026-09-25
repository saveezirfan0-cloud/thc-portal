'use client';

import { useState } from 'react';
import { Alert, Button, Modal, Note, Textarea } from '@thc/ui';
import { UK_ZONE, formatDateTimeIn, ukInputLabel } from '@thc/domain';
import { resolveViolation } from './actions';
import { flaggedAs } from './log';
import { VIOLATION_LABEL, needsActualFinish, reclassifiesToLate } from './status';
import type { ViolationRow } from './types';
import { useViewerZone } from './useViewerZone';

/**
 * The violation detail window (§9.5), which doubles as the audit trail.
 *
 * The note is mandatory for every type and is never write-only: resolving
 * cancels a show-rate penalty, so the reasoning and its author stay on the
 * entry afterwards. A resolved entry therefore renders as a record rather
 * than a form.
 *
 * Times, per §1.8: the check-in / check-out / detected stamps are actual
 * instants, so they are the viewer's own clock; what the manager TYPES is
 * UK time and the label says so; the resolution stamp is an audit stamp and
 * stays UK.
 *
 * Every time typed here is validated on the SERVER (`resolve_violation`),
 * and the dialog stays open with whatever it refused. A No check-out's
 * finish has no upper bound against the scheduled end: RULE-01 caps the
 * pay there regardless. A No-show takes the arrival — required once the
 * section has ended, when "the moment you press" would sit after the end
 * and pay nothing — and, then, an optional finish that settles the shift
 * in the same action (audit D17).
 */
export function ResolveModal({
  violation,
  onClose,
}: {
  violation: ViolationRow;
  onClose: () => void;
}) {
  const zone = useViewerZone();
  const [note, setNote] = useState('');
  const [finish, setFinish] = useState('');
  const [arrived, setArrived] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wantsFinish = needsActualFinish(violation.type);
  const isNoShow = reclassifiesToLate(violation.type);
  // The modal only ever opens in the browser, on a click: no server render
  // to disagree with.
  const sectionEnded = new Date(violation.endsAt).getTime() <= Date.now();
  const needsArrival = isNoShow && sectionEnded;
  const canSubmit =
    note.trim().length > 0 &&
    (!wantsFinish || finish.length > 0) &&
    (!needsArrival || arrived.length > 0) &&
    !busy;

  const stamp = (iso: string) => `${formatDateTimeIn(new Date(iso), zone)} your time`;

  async function submit() {
    setBusy(true);
    setError(null);
    // The inputs are UK wall-clock per §1.8; the server takes instants.
    const finishIso = (wantsFinish || isNoShow) && finish ? ukLocalToIso(finish) : null;
    const arrivedIso = isNoShow && arrived ? ukLocalToIso(arrived) : null;
    const result = await resolveViolation(violation.id, note, finishIso, arrivedIso);
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
            <span className="k">Flagged as</span>
            <span className="v">
              {violation.flaggedAs ?? flaggedAs(violation.type, violation.eventTitle)}
            </span>
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
            {isNoShow ? (
              <Note>
                Resolving a No-show is the same action as “Get back”: it registers the worker as
                arrived and reclassifies this entry to Late, with the minutes counted from the
                arrival time below — or from the moment you press it, if you leave it empty.
              </Note>
            ) : null}

            {isNoShow ? (
              <label className="field">
                <span className="label">
                  {ukInputLabel('Arrived at')}
                  {needsArrival ? <span className="coral"> *</span> : null}
                </span>
                <input
                  className="input"
                  type="datetime-local"
                  value={arrived}
                  onChange={(e) => setArrived(e.target.value)}
                />
                <span className="hint">
                  {needsArrival
                    ? 'The shift has ended, so enter when the worker actually arrived. Not before check-in opened (start − 30 min), not in the future.'
                    : 'Leave empty to register them as arriving now. Not before check-in opened (start − 30 min), not in the future.'}
                </span>
              </label>
            ) : null}

            {wantsFinish || needsArrival ? (
              <label className="field">
                <span className="label">
                  {ukInputLabel('Actual finish')}
                  {wantsFinish ? <span className="coral"> *</span> : null}
                </span>
                <input
                  className="input"
                  type="datetime-local"
                  value={finish}
                  onChange={(e) => setFinish(e.target.value)}
                />
                <span className="hint">
                  {wantsFinish
                    ? 'Becomes the shift’s check-out, and pay is worked out from it. The four-hour floor applies again once this is resolved.'
                    : 'Optional. Closes the shift now, so it is paid; left empty, the worker’s missing check-out is raised as a No check-out to resolve later.'}
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
