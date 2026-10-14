/**
 * "Rate everyone" (ADR-0134 P4) — the rules, without React.
 *
 * After a forty-person event the customer had forty popups to open. The
 * dialog lists everyone still to rate with a star row each; a person left
 * without stars is skipped. Each entry is sent through the SAME write as the
 * single popup — `leaveFeedback` → `submit_client_feedback()`, once per
 * worker — so every rule the database holds (the event has started, the
 * worker is on this customer's line-up, one entry per person per event,
 * the comment's length, not a removed worker) is applied to each, and one
 * refusal never takes the others down with it.
 */
import { feedbackTextTooLong, isRemoved } from '../../rules';
import type { LineupRow } from '../../rules';

/** One person's row in the dialog, as the customer has filled it. */
export interface RateDraft {
  /** 0 = not rated: skipped. */
  rating: number;
  text: string;
}

export type RateState =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'sent' }
  | { state: 'failed'; message: string };

/**
 * Who the dialog lists: everyone on the visible line-up the customer has not
 * rated yet, and who can be rated at all (not a removed worker, §1.7), in
 * the order the page lists them. Empty means there is nothing to offer.
 */
export function stillToRate<T extends LineupRow>(
  people: readonly T[],
  sentHere: ReadonlySet<string> = new Set(),
): T[] {
  return people.filter((p) => !p.feedbackGiven && !sentHere.has(p.bookingId) && !isRemoved(p));
}

/** The dialog is offered once there are at least this many to rate. */
export const RATE_ALL_FROM = 2;

/**
 * The rows a "Send" press sends, in order: rated (1–5), and not already
 * sent from this dialog. A row that failed is sent again — that is "try
 * again".
 */
export function sendQueue(
  people: readonly Pick<LineupRow, 'bookingId'>[],
  drafts: Readonly<Record<string, RateDraft>>,
  states: Readonly<Record<string, RateState>>,
): string[] {
  return people
    .map((p) => p.bookingId)
    .filter((id) => {
      const rating = drafts[id]?.rating ?? 0;
      return rating >= 1 && rating <= 5 && states[id]?.state !== 'sent';
    });
}

/** A comment over the limit is caught before anything is sent. */
export function tooLong(drafts: Readonly<Record<string, RateDraft>>, ids: readonly string[]) {
  return ids.filter((id) => feedbackTextTooLong(drafts[id]?.text ?? ''));
}

/**
 * The footer button's words: "Send 3 ratings", "Send 1 rating", or what is
 * happening while it happens ("Sending 2 of 3…").
 */
export function sendLabel(count: number, progress: { done: number; of: number } | null): string {
  if (progress) return `Sending ${Math.min(progress.done + 1, progress.of)} of ${progress.of}…`;
  if (count === 0) return 'Choose stars to send';
  return count === 1 ? 'Send 1 rating' : `Send ${count} ratings`;
}

/**
 * The line read out after a send (aria-live): how many went and how many
 * did not, so a screen reader hears the outcome without walking the list.
 * Null before anything was sent.
 */
export function sendSummary(states: Readonly<Record<string, RateState>>): string | null {
  const all = Object.values(states);
  const sent = all.filter((s) => s.state === 'sent').length;
  const failed = all.filter((s) => s.state === 'failed').length;
  if (sent === 0 && failed === 0) return null;
  const parts: string[] = [];
  if (sent > 0) parts.push(sent === 1 ? '1 rating sent' : `${sent} ratings sent`);
  if (failed > 0)
    parts.push(
      failed === 1
        ? "1 couldn't be sent — see the row below and try again"
        : `${failed} couldn't be sent — see the rows below and try again`,
    );
  return parts.join(' · ');
}
