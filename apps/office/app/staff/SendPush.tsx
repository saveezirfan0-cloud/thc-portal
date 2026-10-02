'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Modal, Textarea } from '@thc/ui';
import type { ButtonTone } from '@thc/ui';
import { messageStaff } from './messageActions';
import { MESSAGE_MAX, STAFF_PUSH_TITLE, messageLength, recipientLine } from './message';

export interface PushRecipient {
  id: string;
  name: string;
}

/**
 * Send push — ADR-0081.
 *
 * A push with the manager's own words to hand-picked workers, whatever they
 * are or are not booked on: one from their profile (/staff/:id), or the
 * ones ticked in the directory (/staff). The event board's Message staff
 * (ADR-0069) reaches only the people on that event. It arrives under
 * "Message from the office", and tapping it opens the app.
 *
 * After a send the modal stays open on the result, because the one thing
 * the manager may have to act on is in it: the names of anyone with
 * notifications off, who need a phone call instead.
 */
export function SendPush({
  recipients,
  notActivated = false,
  tone,
  onSent,
}: {
  recipients: readonly PushRecipient[];
  /** One worker with no Staff App login yet, so no device can receive it. */
  notActivated?: boolean;
  tone?: ButtonTone;
  /** After a successful send, once the manager closes the result. */
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ summary: string; everyoneReached: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const length = messageLength(message);
  const tooLong = length > MESSAGE_MAX;
  const names = recipients.map((r) => r.name);
  const who = recipientLine(names);
  const many = recipients.length > 1;

  function close() {
    const wasSent = sent !== null;
    setOpen(false);
    setMessage('');
    setError(null);
    setSent(null);
    if (wasSent) onSent?.();
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await messageStaff(
        recipients.map((r) => r.id),
        message,
      );
      if (result.ok) setSent({ summary: result.summary, everyoneReached: result.everyoneReached });
      else setError(result.message);
    });
  }

  return (
    <>
      <Button
        size="sm"
        tone={tone}
        disabled={recipients.length === 0}
        onClick={() => setOpen(true)}
      >
        {many ? `Send push (${recipients.length})` : 'Send push'}
      </Button>

      <Modal
        open={open}
        title={many ? `Send push to ${recipients.length} workers` : `Send push to ${who}`}
        onClose={close}
        footer={
          sent ? (
            <Button tone="primary" onClick={close}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={close}>Cancel</Button>
              <Button tone="primary" disabled={pending || length === 0 || tooLong} onClick={submit}>
                {pending ? 'Sending…' : 'Send push'}
              </Button>
            </>
          )
        }
      >
        {sent ? (
          <Alert tone={sent.everyoneReached ? 'green' : 'amber'}>{sent.summary}</Alert>
        ) : (
          <div className="stack">
            {error ? <Alert tone="coral">{error}</Alert> : null}
            {notActivated ? (
              <Alert tone="amber">
                {who} has not activated the Staff App yet, so this will not reach them — phone them
                instead.
              </Alert>
            ) : null}
            {many ? (
              <span className="sm">
                To <b>{who}</b>
              </span>
            ) : null}
            <Textarea
              label="Message"
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="e.g. New uniforms are ready to collect from the office."
              error={tooLong ? `${length} / ${MESSAGE_MAX} — shorten it to send.` : undefined}
              hint={
                tooLong
                  ? undefined
                  : `${length} / ${MESSAGE_MAX}. Sent as a push titled “${STAFF_PUSH_TITLE}”; tapping it opens the Staff App.`
              }
            />
            <span className="muted xs">
              {many
                ? 'Each of them receives it straight away, on their own.'
                : `Only ${who} receives this, straight away.`}{' '}
              Anyone with notifications off is listed after you send, so you can phone them.
            </span>
          </div>
        )}
      </Modal>
    </>
  );
}
