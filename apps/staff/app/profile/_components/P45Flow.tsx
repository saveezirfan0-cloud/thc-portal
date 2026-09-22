'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal, Textarea } from '@thc/ui';
import { requestP45 } from '../actions';

/**
 * Request my P45 — §10.6, `wireframes/staff/profile.html`.
 *
 * Two steps, deliberately. The scope: "The confirm button is deliberately
 * not the default-styled action, and a second short 'Are you sure? This
 * can't be undone from the app' step sits behind it, so this cannot be
 * triggered by a stray tap."
 *
 * So Cancel is the primary-styled button and the confirm is the plain one —
 * which looks backwards until you remember what each does. The second step
 * is a modal, and its danger button is the only red thing in the flow.
 *
 * The consequences are stated in full before the first button, not
 * summarised: §10.6 wants the worker to know they lose every future
 * booking, that invitations and Radar applications go with them, that they
 * cannot come back without re-applying, and that a shift they are working
 * right now is untouched and still paid. The released-shift count is real,
 * not a guess — it is the number of confirmed future bookings the cascade
 * is about to release.
 */
export function P45Flow({
  open,
  onClose,
  futureShifts,
}: {
  open: boolean;
  onClose: () => void;
  /** Confirmed bookings that have not started. Released on confirm. */
  futureShifts: number;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) return null;

  function confirm() {
    start(async () => {
      const result = await requestP45(reason);
      if (!result.ok) {
        setAsking(false);
        setError(result.message);
        return;
      }
      setAsking(false);
      // The whole app is now the leaver screen (§10.6 step 7).
      router.replace('/profile');
      router.refresh();
    });
  }

  return (
    <>
      <div className="sheet-back" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Leaving The Hospitality Company?"
        style={{ gap: 'var(--sp-10)' }}
      >
        <span className="grab" />
        <div style={{ fontFamily: 'var(--font-head)', fontSize: 'var(--fs-17)', fontWeight: 600 }}>
          Leaving The Hospitality Company?
        </div>
        <p className="sm muted">Here’s exactly what will happen if you continue:</p>

        <div className="consq">
          <div>
            Your <b>P45 will be requested</b> from the office and they’ll be in touch about it.
          </div>
          <div>
            You’ll be <b>taken off every shift you’re booked on</b>
            {futureShifts > 0 ? (
              <>
                {' '}
                — {futureShifts} upcoming {futureShifts === 1 ? 'shift' : 'shifts'} will be offered
                to other staff straight away
              </>
            ) : null}
            .
          </div>
          <div>Any open invitations and Radar applications are withdrawn.</div>
          <div>
            You <b>won’t be able to book or be invited to shifts again</b> unless you re-apply and
            complete onboarding again.
          </div>
          <div>A shift you’re working right now is not affected and is paid as normal.</div>
        </div>

        <Textarea
          label="Reason for leaving · optional"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. moving away, found a permanent job…"
          style={{ minHeight: 56 }}
        />

        {error ? <Alert tone="coral">{error}</Alert> : null}

        <div className="row" style={{ gap: 'var(--sp-8)' }}>
          {/* Cancel is the default-styled action; the confirm is not. */}
          <Button tone="primary" block onClick={onClose} style={{ flex: 1 }} disabled={pending}>
            Cancel
          </Button>
          <Button block onClick={() => setAsking(true)} style={{ flex: 1 }} disabled={pending}>
            Yes, request my P45
          </Button>
        </div>
      </div>

      <Modal
        open={asking}
        onClose={() => setAsking(false)}
        title="Are you sure? This can’t be undone from the app"
        footer={
          <>
            <Button tone="primary" onClick={() => setAsking(false)} disabled={pending}>
              Go back
            </Button>
            <Button tone="danger" onClick={confirm} disabled={pending}>
              {pending ? 'Requesting…' : 'Request my P45'}
            </Button>
          </>
        }
      >
        <p className="muted">
          Your account will close to a leaver screen. Only the office can bring you back, and you’d
          complete onboarding again on the same record.
        </p>
      </Modal>
    </>
  );
}
