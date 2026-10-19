'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Textarea } from '@thc/ui';
import { signOffInvoice } from '../../actions';

/**
 * "Mark reviewed for invoicing" (ADR-0168). The note is mandatory, as for
 * every violation resolution (§9.5); the fingerprint is the one this page
 * was drawn from, so the database refuses a sign-off for figures that
 * changed underneath it.
 */
export function SignOffForm({
  eventId,
  fingerprint,
  again,
}: {
  eventId: string;
  fingerprint: string;
  again: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await signOffInvoice(eventId, note, fingerprint);
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      // A changed event is redrawn, so the manager reviews what is there now.
      router.refresh();
      return;
    }
    setNote('');
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <label className="field">
        <span className="label">
          Review note <span className="coral">*</span>
        </span>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Mandatory. What you checked, e.g. Late arrivals agreed with the client's manager; the no-show is not charged."
        />
        <span className="hint">
          Your name, the time and this note are kept with the event and in the activity log.
        </span>
      </label>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <div>
        <Button tone="primary" disabled={busy || note.trim() === ''} onClick={submit}>
          {busy ? 'Saving…' : again ? 'Mark reviewed again' : 'Mark reviewed for invoicing'}
        </Button>
      </div>
    </div>
  );
}
