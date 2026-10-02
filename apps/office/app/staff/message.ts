/**
 * Send push to hand-picked workers (ADR-0081) — the words, without React.
 *
 * The same message as the event board's Message staff (ADR-0069), to one
 * worker from their profile or to the workers ticked in the directory, with
 * no event: so the limit, the length count and the "sent / phone them"
 * summary are the board's own, not copies that could drift.
 */
import { MESSAGE_MAX, messageLength, messageSentSummary } from '../events/[id]/board-model';

export { MESSAGE_MAX, messageLength, messageSentSummary };

/** OM2's title, as the worker sees it above the message (packages/notifications). */
export const STAFF_PUSH_TITLE = 'Message from the office';

/** send_staff_message() refuses more: a hand-picked list, not a broadcast. */
export const MAX_RECIPIENTS = 200;

const REFUSAL_COPY: Readonly<Record<string, string>> = {
  message_required: 'Write the message first.',
  message_too_long: `Keep the message to ${MESSAGE_MAX} characters — a phone cuts off anything longer.`,
  nobody_to_message: 'Pick at least one worker to message.',
  too_many_recipients: `Pick ${MAX_RECIPIENTS} workers or fewer — this is for hand-picked people, not everyone.`,
  staff_removed:
    'Someone on the list has been removed (GDPR) and cannot be messaged. Reload the page and pick again.',
  staff_not_found: 'Someone on the list no longer exists. Reload the page and pick again.',
  not_authorised: 'Only the office can do this.',
  read_only: 'A view-only login cannot send messages.',
};

/** send_staff_message()'s refusal — returned or raised — as the manager reads it. */
export function staffMessageRefusal(reason: string): string {
  const known = Object.keys(REFUSAL_COPY).find((code) => reason.includes(code));
  return known ? REFUSAL_COPY[known]! : `The message was not sent (${reason || 'unknown'}).`;
}

/**
 * Whether Send push is offered for a worker: not a removed one (§1.7 — the
 * person no longer exists to us), and only to a login that may write. The
 * database refuses both whatever this says.
 */
export function canMessageWorker(status: string, canWrite: boolean): boolean {
  return canWrite && status !== 'removed';
}

/** Who the dialog says it is for: up to four names; past four, three and "and N more". */
export function recipientLine(names: readonly string[]): string {
  if (names.length === 0) return 'Nobody';
  if (names.length === 1) return names[0]!;
  if (names.length <= 4) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}
