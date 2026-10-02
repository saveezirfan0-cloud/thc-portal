/**
 * Send push from a worker's profile (ADR-0081) — the words, without React.
 *
 * The same message as the event board's Message staff (ADR-0069), to one
 * worker and with no event: so the limit, the length count and the "sent /
 * phone them" summary are the board's own, not copies that could drift.
 */
import { MESSAGE_MAX, messageLength, messageSentSummary } from '../../events/[id]/board-model';

export { MESSAGE_MAX, messageLength, messageSentSummary };

/** OM2's title, as the worker sees it above the message (packages/notifications). */
export const STAFF_PUSH_TITLE = 'Message from the office';

const REFUSAL_COPY: Readonly<Record<string, string>> = {
  message_required: 'Write the message first.',
  message_too_long: `Keep the message to ${MESSAGE_MAX} characters — a phone cuts off anything longer.`,
  staff_removed: 'This worker has been removed (GDPR) — there is nobody to message.',
  staff_not_found: 'This worker no longer exists. Reload the page.',
  not_authorised: 'Only the office can do this.',
  read_only: 'A view-only login cannot send messages.',
};

/** send_staff_message()'s refusal — returned or raised — as the manager reads it. */
export function staffMessageRefusal(reason: string): string {
  const known = Object.keys(REFUSAL_COPY).find((code) => reason.includes(code));
  return known ? REFUSAL_COPY[known]! : `The message was not sent (${reason || 'unknown'}).`;
}

/**
 * Whether Send push is offered: not on a removed profile (§1.7 — the person
 * no longer exists to us), and only for a login that may write. The
 * database refuses both whatever this says.
 */
export function canMessageWorker(status: string, canWrite: boolean): boolean {
  return canWrite && status !== 'removed';
}
