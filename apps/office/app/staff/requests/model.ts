import { formatLocalStamp, formatUkStamp } from '../[id]/profile';
import type { ChangeKind, ChangeRequestRow, ChangeStatus } from './types';

/**
 * Presentation rules for the change-request queue (/staff/requests) and
 * the /staff/:id banner — ADR-0044, `wireframes/backoffice/change-requests.html`.
 * Pure, so the ones that are easy to get wrong are driven directly by
 * Vitest.
 */

export const UK = 'Europe/London';

export function kindLabel(kind: ChangeKind): string {
  return kind === 'name' ? 'Name' : 'Photo';
}

function join(first: string | null | undefined, last: string | null | undefined): string | null {
  const text = [first, last].filter((part) => part && part.trim() !== '').join(' ');
  return text === '' ? null : text;
}

/**
 * The name on the profile the request was measured against. While pending
 * that is the profile now; once decided it is the snapshot the database
 * took at the decision (`previous_value`), because the profile may since
 * have moved on — an approved request's "now" is otherwise its own result.
 */
export function nameBefore(row: ChangeRequestRow): string | null {
  if (row.status !== 'pending' && row.previous_value?.firstName !== undefined) {
    return join(row.previous_value.firstName, row.previous_value.lastName);
  }
  return join(row.current_first_name, row.current_last_name);
}

export function nameRequested(row: ChangeRequestRow): string | null {
  return join(row.proposed_first_name, row.proposed_last_name);
}

/** The Decided table's Change column: "Amara Kalu → Amara Okafor", "new photo". */
export function changeSummary(row: ChangeRequestRow): string {
  if (row.removed) return '— anonymised';
  if (row.kind === 'photo') return 'new photo';
  return `${nameBefore(row) ?? '—'} → ${nameRequested(row) ?? '—'}`;
}

export function decisionLabel(status: ChangeStatus): {
  label: string;
  tone: 'green' | 'coral' | 'amber' | undefined;
} {
  switch (status) {
    case 'approved':
      return { label: 'Approved', tone: 'green' };
    case 'rejected':
      return { label: 'Rejected', tone: 'coral' };
    case 'withdrawn':
      return { label: 'Withdrawn', tone: undefined };
    default:
      return { label: 'Pending', tone: 'amber' };
  }
}

/**
 * Who closed it. The office's decisions name the manager; a withdrawal has
 * no manager — the worker withdrew it, or §1.7's removal did.
 */
export function decidedBy(row: ChangeRequestRow): string {
  if (row.decided_by_name) return row.decided_by_name;
  if (row.status === 'withdrawn') return row.removed ? 'GDPR removal' : '— the worker';
  return '—';
}

/** "Requested Wed 17 Sep · 09:12 UK time" — a record of when, so UK only (§1.8). */
export function requestedAt(iso: string): string {
  return `${formatLocalStamp(iso, UK)} UK time`;
}

/** The dotted audit stamp the Decided table and the banner use (§1.8). */
export function ukStamp(iso: string | null): string {
  return formatUkStamp(iso);
}

/** The evidence link's text: the file name the worker uploaded under. */
export function evidenceName(path: string | null): string | null {
  if (!path) return null;
  const name = path.split('/').pop();
  return name && name !== '' ? name : null;
}

/** Pending first-come first-served (ADR-0044): oldest first. */
export function oldestFirst<T extends { created_at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * The database's refusals, in words a manager can act on. Anything not
 * listed is shown as the database said it — hiding an unknown error is how
 * a real fault gets reported as "try again".
 */
const MESSAGES: Record<string, string> = {
  already_decided:
    'This request has already been decided — refresh to see the outcome. A decision is never changed; the worker can ask again.',
  reason_required: 'Give a reason — the worker is shown it.',
  reason_too_long: 'Keep the reason to 300 characters.',
  request_not_found: 'This request no longer exists.',
  not_authorised: 'Only the office can do this.',
  evidence_unchecked:
    'Tick “I’ve checked the evidence matches the right-to-work document” before approving a name.',
};

export function decisionMessage(message: string): string {
  const key = Object.keys(MESSAGES).find((code) => message.includes(code));
  return key ? (MESSAGES[key] as string) : message;
}

/**
 * Approve is enabled for a name only once the evidence tick is on; a photo
 * has no evidence to tick (ADR-0044 §3). The server action asks again.
 */
export function canApprove(kind: ChangeKind, evidenceChecked: boolean): boolean {
  return kind === 'photo' || evidenceChecked;
}
