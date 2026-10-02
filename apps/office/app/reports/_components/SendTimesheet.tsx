'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal } from '@thc/ui';

/**
 * "Send to client" on one row of the invoicing list (ADR-0083): the
 * Completed Allocation Timesheet goes to the client with the invoice, from
 * here and nowhere else. The same send as §11.4's — a fresh copy drawn,
 * stored and queued from timesheets@ to every contact email on the client
 * card — through /api/documents/:eventId/send. The database refuses it
 * for a login without finance.
 */
export function SendTimesheet({
  eventId,
  eventTitle,
  label,
  blocked,
}: {
  eventId: string;
  eventTitle: string;
  label: string;
  blocked: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ tone: 'green' | 'coral'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setResult(null);
    startTransition(async () => {
      const response = await fetch(`/api/documents/${eventId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'signout' }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        recipients?: string[];
        pages?: number;
      };
      if (!response.ok || body.error) {
        setResult({
          tone: 'coral',
          text: body.error ?? 'The Completed Allocation Timesheet could not be sent.',
        });
        return;
      }
      setConfirming(false);
      setResult({
        tone: 'green',
        text: `The Completed Allocation Timesheet (${body.pages ?? 1} ${body.pages === 1 ? 'page' : 'pages'}) is queued from timesheets@ to ${(body.recipients ?? []).join(', ')}.`,
      });
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        tone={label === 'Send again' ? 'default' : 'primary'}
        disabled={blocked !== null}
        title={blocked ?? undefined}
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
      <Modal
        open={confirming || result !== null}
        title={`Send Completed Timesheet · ${eventTitle}`}
        onClose={() => {
          setConfirming(false);
          setResult(null);
        }}
        footer={
          confirming ? (
            <>
              <Button onClick={() => setConfirming(false)}>Not now</Button>
              <Button tone="primary" disabled={pending} onClick={send}>
                {pending ? 'Sending…' : 'Send'}
              </Button>
            </>
          ) : (
            <Button onClick={() => setResult(null)}>Close</Button>
          )
        }
      >
        <div className="stack">
          {result ? <Alert tone={result.tone}>{result.text}</Alert> : null}
          {confirming ? (
            <p className="sm">
              A fresh Completed Allocation Timesheet goes, as one PDF for the whole event with the
              PO number and every hour worked on it, from{' '}
              <b>timesheets@thehospitalitycompany.co.uk</b> to every contact email on the client
              card. Send it with the invoice: once it has gone, the client can also download it from
              the Client Portal.
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
