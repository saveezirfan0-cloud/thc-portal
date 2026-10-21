'use client';

import { useState } from 'react';
import { Alert, Button, Modal, Note, Textarea, useTimeFormat } from '@thc/ui';
import {
  NO_CHECK_OUT_AFTER_MIN,
  UK_ZONE,
  formatDateTimeIn,
  needsDualZone,
  overWeeklyLimitText,
  viewerZone,
} from '@thc/domain';
import { verifyLateCheckOut } from './actions';
import { minutesPastEnd, pastEndText } from './status';
import type { LateCheckOutTarget } from './types';

/** `check_logs.late_check_out_note`'s ceiling (20261022200000). */
export const VERIFY_NOTE_MAX = 500;

/**
 * Verify a late sign-out (ADR-0184, THC 21.10.2026).
 *
 * A worker who signs out more than 15 minutes after the section's end is
 * paid and charged to the sign-out, the time past the end on its own line
 * of the client's invoice. THC's office then speaks to the worker to find
 * out why; this window records that it did — who, when, and what they were
 * told. It is not an approval: payroll, ready-to-invoice and the invoice
 * never wait for it, which is why the copy says so.
 *
 * Times (§1.8): the scheduled end is a SCHEDULED time, so UK with a "your
 * time" second line when the reader's zone differs; the sign-out
 * is an ACTUAL stamp, so the manager's own zone; when it was verified is an
 * audit stamp, UK.
 */
export function VerifyLateModal({
  target,
  onClose,
}: {
  target: LateCheckOutTarget;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const format = useTimeFormat();
  // Mounted on a click: the reader's zone is already the browser's.
  const zone = viewerZone();
  const dual = needsDualZone(zone);
  const overLimit = overWeeklyLimitText(target.weekHours, target.weekCapHours);
  const verified = Boolean(target.verifiedAt);
  const past = minutesPastEnd(target.endsAt, target.checkOutAt);
  const trimmed = note.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= VERIFY_NOTE_MAX && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await verifyLateCheckOut(target.bookingId, trimmed);
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`Signed out late — ${target.staffName}`}>
      <div className="stack" style={{ gap: 12 }}>
        <p className="muted sm">
          {target.eventTitle} · {target.roleName}
        </p>
        <div className="kvs">
          <div className="kv">
            <span className="k">Scheduled end</span>
            {/* A SCHEDULED time (§1.8): UK, and the reader's own zone
                underneath when it differs — as the monitor's Window. */}
            <span className="v mono win2">
              {formatDateTimeIn(new Date(target.endsAt), UK_ZONE, format)} UK time
              {dual ? (
                <span className="l2">
                  {formatDateTimeIn(new Date(target.endsAt), zone, format)} your time
                </span>
              ) : null}
            </span>
          </div>
          <div className="kv">
            <span className="k">Signed out</span>
            <span className="v mono">
              {formatDateTimeIn(new Date(target.checkOutAt), zone, format)} your time
            </span>
          </div>
          <div className="kv">
            <span className="k">Overrun</span>
            <span className="v">
              {pastEndText(past)}
              {past > NO_CHECK_OUT_AFTER_MIN ? ' · paid up to 4 h past the end' : ''}
            </span>
          </div>
        </div>

        {overLimit ? (
          <Alert tone="amber">
            {overLimit} — the overrun counts toward this worker’s hours for the week. Check their
            other bookings this week.
          </Alert>
        ) : null}

        <Note>
          Paid and charged to the sign-out: the time past the scheduled end is its own line on the
          client’s invoice. Nothing waits for this — speak to the worker to find out why they
          finished late, and note what they said.
        </Note>

        {verified ? (
          <>
            <Note tone="green">
              Verified by {target.verifiedByName ?? 'the office'}
              {target.verifiedAt
                ? ` · ${formatDateTimeIn(new Date(target.verifiedAt), UK_ZONE, format)} UK`
                : ''}
            </Note>
            {target.note ? <blockquote className="sm">{target.note}</blockquote> : null}
          </>
        ) : (
          <label className="field">
            <span className="label">
              Verified with the worker — note <span className="coral">*</span>
            </span>
            <Textarea
              value={note}
              maxLength={VERIFY_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Mandatory. Why they finished late — e.g. the client asked the team to stay for the speeches."
            />
            <span className="hint">
              Your name, the time and the note stay on the shift. The worker does not see the note.
            </span>
          </label>
        )}

        {error ? <Alert tone="coral">{error}</Alert> : null}

        <div className="mf">
          <Button tone="ghost" onClick={onClose}>
            {verified ? 'Close' : 'Cancel'}
          </Button>
          {verified ? null : (
            <Button tone="primary" disabled={!canSubmit} onClick={submit}>
              {busy ? 'Verifying…' : 'Verify'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
