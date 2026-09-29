'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Modal, Select, Textarea } from '@thc/ui';
import { messageLineUp } from '../actions';
import {
  MESSAGE_AUDIENCES,
  MESSAGE_MAX,
  messageLength,
  parseMessageTarget,
  type MessageAudience,
} from '../board-model';

/** Someone booked on a role, who can be messaged on their own. */
export interface MessagePerson {
  bookingId: string;
  name: string;
  /** Invited, not yet accepted — shown so the manager knows. */
  invited: boolean;
}

export interface MessageSection {
  id: string;
  label: string;
  /** The role's short name, heading its people in the To list. */
  roleName: string;
  people: MessagePerson[];
}

/**
 * Message staff — ADR-0069.
 *
 * A push with the manager's own words to the people on this event: the
 * whole event or one role, and — for either — the confirmed (and checked
 * in) staff, the invitees who have not accepted yet, or both. Or one
 * person: every confirmed, checked-in and invited worker is listed under
 * their role in the To list, and picking one messages only them (the Who
 * choice does not apply then). The words
 * arrive as the notification's body under "{event} · {date}", and tapping
 * it opens the worker's shift.
 *
 * After a send the modal stays open on the result, because the one thing
 * the manager must act on is in it: the names of anyone with notifications
 * off, who will not get the message and needs a phone call.
 */
export function MessageStaff({
  eventId,
  pushTitle,
  sections,
}: {
  eventId: string;
  /** The push's title as the worker will see it: "Summer Gala · Sat 03 Oct". */
  pushTitle: string;
  sections: MessageSection[];
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [to, setTo] = useState('');
  const [audience, setAudience] = useState<MessageAudience>('booked');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ summary: string; everyoneReached: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const target = parseMessageTarget(to);
  const person =
    target.kind === 'person'
      ? sections.flatMap((s) => s.people).find((p) => p.bookingId === target.bookingId)
      : undefined;
  const length = messageLength(message);
  const tooLong = length > MESSAGE_MAX;

  function reset() {
    setMessage('');
    setTo('');
    setAudience('booked');
    setError(null);
    setSent(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await messageLineUp(eventId, {
        sectionId: target.kind === 'section' ? target.sectionId : null,
        bookingId: target.kind === 'person' ? target.bookingId : null,
        audience,
        message,
      });
      if ('error' in result) setError(result.error);
      else setSent({ summary: result.summary, everyoneReached: result.everyoneReached });
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Message staff
      </Button>

      <Modal
        open={open}
        title="Message staff"
        onClose={close}
        footer={
          sent ? (
            <Button tone="primary" onClick={close}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={close}>Cancel</Button>
              <Button
                tone="primary"
                loading={pending}
                disabled={length === 0 || tooLong}
                onClick={submit}
              >
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
            <Select label="To" value={to} onChange={(event) => setTo(event.target.value)}>
              <option value="">Everyone on this event</option>
              <optgroup label="A whole role">
                {sections.map((section) => (
                  <option key={section.id} value={`section:${section.id}`}>
                    {section.label}
                  </option>
                ))}
              </optgroup>
              {sections
                .filter((section) => section.people.length > 0)
                .map((section) => (
                  <optgroup key={section.id} label={`One person · ${section.roleName}`}>
                    {section.people.map((p) => (
                      <option key={p.bookingId} value={`person:${p.bookingId}`}>
                        {p.invited ? `${p.name} (invited)` : p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </Select>
            {person ? (
              <span className="muted xs">
                Only {person.name} receives this
                {person.invited ? ' — they have not accepted the invitation yet' : ''}.
              </span>
            ) : (
              <Select
                label="Who"
                value={audience}
                onChange={(event) => setAudience(event.target.value as MessageAudience)}
              >
                {MESSAGE_AUDIENCES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
            <Textarea
              label="Message"
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="e.g. Staff entrance tonight is on King Street — the front doors are closed."
              error={tooLong ? `${length} / ${MESSAGE_MAX} — shorten it to send.` : undefined}
              hint={
                tooLong
                  ? undefined
                  : `${length} / ${MESSAGE_MAX}. Sent as a push titled “${pushTitle}”; tapping it opens their shift.`
              }
            />
            <span className="muted xs">
              Everyone chosen receives it straight away. Anyone with notifications off is listed
              after you send, so you can phone them.
            </span>
          </div>
        )}
      </Modal>
    </>
  );
}
