'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Modal } from '@thc/ui';

type Kind = 'allocation' | 'signout';

/**
 * ADR-0074 (THC, 29.09.2026): the product's names for the two states. No
 * `send` = not sent from here: the Completed Timesheet goes with the
 * invoice, from Reports › Financial (ADR-0081).
 */
const LABEL: Record<Kind, { send?: string; download: string; noun: string }> = {
  allocation: {
    send: 'Send Allocation Timesheet',
    download: 'Download Allocation Timesheet',
    noun: 'Allocation Timesheet',
  },
  signout: {
    download: 'Download Completed Timesheet',
    noun: 'Completed Allocation Timesheet',
  },
};

/**
 * §11.4 on the event page: "Send Allocation Timesheet" (an action) +
 * "Download Allocation Timesheet" (a PDF, for WhatsApp). "Download
 * Completed Timesheet" joins them once the event has started — it is filled
 * from check-in/out, so before that it would be the allocation state again.
 * The Allocation Timesheet also goes automatically (ADR-0074); the page
 * says when, under these.
 *
 * The Completed Timesheet has no Send here (ADR-0081): it goes to the
 * client with the invoice, from Reports › Financial, and the line under
 * the buttons says so. Downloading it publishes nothing.
 *
 * The document is drawn by /api/documents (packages/pdf), sent from
 * timesheets@ to the contact emails on the client card. No time restriction
 * (§11.3). Not rendered for a cancelled event — there is no document (§3.3).
 */
export function DocumentActions({ eventId, started }: { eventId: string; started: boolean }) {
  const kinds: Kind[] = started ? ['allocation', 'signout'] : ['allocation'];
  const [confirming, setConfirming] = useState<Kind | null>(null);
  const [result, setResult] = useState<{ tone: 'green' | 'coral'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function send(kind: Kind) {
    setResult(null);
    startTransition(async () => {
      const response = await fetch(`/api/documents/${eventId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        recipients?: string[];
        pages?: number;
      };
      if (!response.ok || body.error) {
        setResult({
          tone: 'coral',
          text: body.error ?? `The ${LABEL[kind].noun} could not be sent.`,
        });
        return;
      }
      setConfirming(null);
      setResult({
        tone: 'green',
        text: `The ${LABEL[kind].noun} (${body.pages ?? 1} ${body.pages === 1 ? 'page' : 'pages'}) is queued from timesheets@ to ${(body.recipients ?? []).join(', ')}.`,
      });
    });
  }

  return (
    <>
      {kinds.map((kind) => (
        <span key={kind} className="row" style={{ gap: 8 }}>
          {LABEL[kind].send ? (
            <Button size="sm" tone="primary" onClick={() => setConfirming(kind)}>
              {LABEL[kind].send}
            </Button>
          ) : null}
          <a className="btn sm" href={`/api/documents/${eventId}?kind=${kind}`}>
            {LABEL[kind].download}
          </a>
        </span>
      ))}

      <Modal
        open={confirming !== null || result !== null}
        title={confirming ? LABEL[confirming].send : 'Timesheet documents'}
        onClose={() => {
          setConfirming(null);
          setResult(null);
        }}
        footer={
          confirming ? (
            <>
              <Button onClick={() => setConfirming(null)}>Not now</Button>
              <Button tone="primary" disabled={pending} onClick={() => send(confirming)}>
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
              A fresh {LABEL[confirming].noun} goes, as one PDF for the whole event with the PO
              number on it, from <b>timesheets@thehospitalitycompany.co.uk</b> to every contact
              email on the client card.
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
