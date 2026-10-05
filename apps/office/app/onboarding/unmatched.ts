/**
 * "Unmatched Willo responses" on /onboarding — what the panel says (§2.4,
 * ADR-0087). Pure, so it is tested without React.
 *
 * A Willo response is unmatched when the receiver got an event for a
 * participant the portal has no candidate for (created in Willo by hand, or
 * before the portal existed). The database lists them
 * (`willo_unmatched_responses()`); the office links one to a candidate, which
 * replays what Willo said, or dismisses it with a reason.
 */
import type { TimeFormat } from '@thc/domain';
import { shortStamp } from './view-model';
import type { CandidateRow, UnmatchedLinkResult, UnmatchedWilloRow } from './types';

/** The candidate statuses a Willo response can be linked to (the database refuses the rest). */
export const LINKABLE_STATUSES = ['interview_requested', 'interview_completed'] as const;

const EVENT_LABEL: Record<string, string> = {
  new_response: 'Interview completed',
  accepted: 'Accepted in Willo',
  rejected: 'Rejected in Willo',
  progress: 'Answering',
  received: 'Received in Willo',
};

/** "new_response" → "Interview completed"; an event THC has not met → "Some event". */
export function unmatchedEventLabel(event: string): string {
  const known = EVENT_LABEL[event];
  if (known) return known;
  const words = event.replace(/[_-]+/g, ' ').trim();
  return words === '' ? 'Unnamed event' : words.charAt(0).toUpperCase() + words.slice(1);
}

export function unmatchedEventTone(event: string): 'green' | 'coral' | 'cyan' | 'neutral' {
  if (event === 'accepted') return 'green';
  if (event === 'rejected') return 'coral';
  if (event === 'new_response') return 'cyan';
  return 'neutral';
}

/** The shortened key the table shows: enough to tell two apart, the full one is in the title. */
export function shortKey(key: string): string {
  return key.length <= 12 ? key : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** Heading count: "1 response" / "3 responses". */
export function unmatchedHeading(count: number): string {
  return count === 1
    ? '1 Willo response matches no candidate'
    : `${count} Willo responses match no candidate`;
}

/** First and last seen as one line, UK time (§1.8: audit stamps are UK-only). */
export function seenLine(row: UnmatchedWilloRow, format?: TimeFormat): string {
  const first = shortStamp(row.first_seen, format);
  const last = shortStamp(row.last_seen, format);
  return first === last ? `Seen ${first}` : `First seen ${first} · last ${last}`;
}

/** What linking will do, in the words the confirmation shows. */
export function linkConsequence(events: readonly string[]): string[] {
  const lines: string[] = [];
  if (events.includes('rejected')) {
    lines.push(
      'Willo rejected this response, so linking rejects the candidate and sends them E2 (or E2b if they had not done the interview).',
    );
  }
  if (events.includes('accepted') && !events.includes('rejected')) {
    lines.push(
      'Willo accepted this response. The card moves to Interview completed with Willo’s time; press Accept there to pick the role types and send the activation email (E3).',
    );
  }
  if (events.includes('new_response') && !events.includes('rejected')) {
    lines.push('The card moves to Interview completed with the time Willo recorded.');
  }
  if (lines.length === 0) {
    lines.push('Only the Willo key is saved on the candidate; no card moves.');
  }
  lines.push('The candidate will not be sent a second Willo invitation.');
  return lines;
}

/** The toast after a link: what happened to the card. */
export function linkedMessage(result: UnmatchedLinkResult, name: string): string {
  if (result.outcome === 'already_linked') return `${name} was already linked to this response.`;
  if (result.acceptPending) {
    return `${name} is linked. Willo accepted them — press Accept on their card to choose roles and send the activation email.`;
  }
  if (result.status === 'rejected') return `${name} is linked and was rejected, as Willo decided.`;
  if (result.status === 'interview_completed') {
    return `${name} is linked and moved to Interview completed.`;
  }
  return `${name} is linked to this Willo response.`;
}

export interface LinkOption {
  id: string;
  name: string;
  email: string;
  status: CandidateRow['status'];
  appliedAt: string;
  /** The name or email matches what the Willo delivery said. */
  suggested: boolean;
}

function fold(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function sameName(a: string, b: string): boolean {
  const left = fold(a).split(' ').filter(Boolean).sort().join(' ');
  const right = fold(b).split(' ').filter(Boolean).sort().join(' ');
  return left !== '' && left === right;
}

/**
 * Candidates the response can be linked to: waiting on the interview
 * decision, not removed (the board never lists them), and not already linked
 * to a Willo participant. A search narrows by name, email or phone; those
 * whose name or email matches what the delivery carried come first.
 */
export function linkOptions(
  candidates: readonly CandidateRow[],
  row: Pick<UnmatchedWilloRow, 'name' | 'email'>,
  query: string,
  limit = 8,
): LinkOption[] {
  const needle = fold(query);
  const email = row.email ? fold(row.email) : null;
  const options = candidates
    .filter(
      (candidate) =>
        (LINKABLE_STATUSES as readonly string[]).includes(candidate.status) &&
        !candidate.willo_linked,
    )
    .filter(
      (candidate) =>
        needle === '' ||
        [candidate.display_name, candidate.email, candidate.phone].some((part) =>
          fold(part ?? '').includes(needle),
        ),
    )
    .map<LinkOption>((candidate) => ({
      id: candidate.id,
      name: candidate.display_name,
      email: candidate.email,
      status: candidate.status,
      appliedAt: candidate.applied_at,
      suggested:
        (email !== null && fold(candidate.email) === email) ||
        (row.name !== null && sameName(candidate.display_name, row.name)),
    }));
  options.sort(
    (a, b) =>
      Number(b.suggested) - Number(a.suggested) ||
      Date.parse(b.appliedAt) - Date.parse(a.appliedAt) ||
      a.name.localeCompare(b.name),
  );
  return options.slice(0, limit);
}
