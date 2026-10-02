'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Modal, Textarea } from '@thc/ui';
import { messageWorker } from './messageActions';
import { MESSAGE_MAX, STAFF_PUSH_TITLE, messageLength } from './message';

/**
 * Send push — ADR-0081.
 *
 * A push with the manager's own words to this one worker, whatever they are
 * or are not booked on: the event board's Message staff (ADR-0069) reaches
 * only the people on that event. It arrives under "Message from the
 * office", and tapping it opens the app.
 *
 * After a send the modal stays open on the result, because the one thing
 * the manager may have to act on is in it: that the worker has
 * notifications off and needs a phone call instead.
 */
export function MessageWorker({
  staffId,
  name,
  activated,
}: {
  staffId: string;
  name: string;
  /** `false`: no Staff App login yet, so no device can receive it. */
  activated?: boolean | null;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ summary: string; everyoneReached: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const length = messageLength(message);
  const tooLong = length > MESSAGE_MAX;

  function close() {
    setOpen(false);
    setMessage('');
    setError(null);
    setSent(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await messageWorker(staffId, message);
      if (result.ok) setSent({ summary: result.summary, everyoneReached: result.everyoneReached });
      else setError(result.message);
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Send push
      </Button>

      <Modal
        open={open}
        title={`Send push to ${name}`}
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
            {activated === false ? (
              <Alert tone="amber">
                {name} has not activated the Staff App yet, so this will not reach them — phone them
                instead.
              </Alert>
            ) : null}
            <Textarea
              label="Message"
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="e.g. Your new uniform is ready to collect from the office."
              error={tooLong ? `${length} / ${MESSAGE_MAX} — shorten it to send.` : undefined}
              hint={
                tooLong
                  ? undefined
                  : `${length} / ${MESSAGE_MAX}. Sent as a push titled “${STAFF_PUSH_TITLE}”; tapping it opens the Staff App.`
              }
            />
            <span className="muted xs">
              Only {name} receives this, straight away. If they have notifications off you are told
              after you send, so you can phone them.
            </span>
          </div>
        )}
      </Modal>
    </>
  );
}
