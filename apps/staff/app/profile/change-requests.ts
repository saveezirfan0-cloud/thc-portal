import { UK_ZONE, formatDateIn, formatTimeIn } from '@thc/domain';
import type { ChangeKind } from '@thc/domain';

/**
 * Request a change — what the worker reads about their own requests
 * (ADR-0038, docs/18 §3, `wireframes/staff/request-change.html`).
 *
 * §10.1's name and photo locks never move; a request is the in-app route
 * to the office, which decides on /staff/requests. This file turns the rows
 * `my_profile_change_requests()` returns into the status line on Profile
 * details, and the RPC's refusal codes into sentences.
 */

export type ChangeStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

/** One row of `my_profile_change_requests()`. Never carries decided_by. */
export interface ChangeRequest {
  id: string;
  kind: ChangeKind;
  status: ChangeStatus;
  proposedFirstName: string | null;
  proposedLastName: string | null;
  proposedPhotoPath: string | null;
  workerNote: string | null;
  /** The office's reason on a rejection — shown to the worker as written. */
  decisionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export function toChangeRequest(row: Record<string, unknown>): ChangeRequest {
  return {
    id: row['id'] as string,
    kind: row['kind'] as ChangeKind,
    status: row['status'] as ChangeStatus,
    proposedFirstName: (row['proposed_first_name'] as string | null) ?? null,
    proposedLastName: (row['proposed_last_name'] as string | null) ?? null,
    proposedPhotoPath: (row['proposed_photo_path'] as string | null) ?? null,
    workerNote: (row['worker_note'] as string | null) ?? null,
    decisionReason: (row['decision_reason'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    decidedAt: (row['decided_at'] as string | null) ?? null,
  };
}

const NOUN: Record<ChangeKind, string> = { name: 'Name', photo: 'Photo' };

export type StatusLine =
  | { state: 'pending'; id: string; text: string; detail: string }
  | { state: 'rejected'; id: string; text: string }
  | null;

/**
 * The line under the locked field, from the newest request of that kind:
 *
 *   pending    "Name change requested · with the office" + Withdraw, and
 *              "Requested: Amara Okafor · Thu 18 Sep, 14:37 (UK time)"
 *   rejected   "Not changed: {reason}" + Request again
 *   otherwise  nothing — approved has already changed the field, and a
 *              withdrawal was the worker's own doing.
 */
export function statusLine(requests: readonly ChangeRequest[], kind: ChangeKind): StatusLine {
  const latest = requests
    .filter((r) => r.kind === kind)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!latest) return null;
  if (latest.status === 'pending') {
    const what =
      kind === 'name'
        ? `${latest.proposedFirstName ?? ''} ${latest.proposedLastName ?? ''}`.trim()
        : 'a new photo';
    return {
      state: 'pending',
      id: latest.id,
      text: `${NOUN[kind]} change requested · with the office`,
      detail: `Requested: ${what} · ${ukStamp(latest.createdAt)} (UK time)`,
    };
  }
  if (latest.status === 'rejected') {
    return {
      state: 'rejected',
      id: latest.id,
      text: `Not changed: ${latest.decisionReason ?? 'the office could not make this change.'}`,
    };
  }
  return null;
}

/** Whether "Request a change" is offered: never while one is pending. */
export function canRequest(requests: readonly ChangeRequest[], kind: ChangeKind): boolean {
  return !requests.some((r) => r.kind === kind && r.status === 'pending');
}

/** "Thu 18 Sep, 14:37" in UK time — the moment the request was made. */
export function ukStamp(iso: string): string {
  const at = new Date(iso);
  return `${formatDateIn(at, UK_ZONE, { weekday: 'short' })}, ${formatTimeIn(at, UK_ZONE)}`;
}

/** Where "Request a change" and "Request again" go. */
export function requestHref(kind: ChangeKind): string {
  return `/profile/details/request?kind=${kind}`;
}

/** The RPC's refusal codes, as sentences (20260930120200). */
export const CHANGE_REASONS: Record<string, string> = {
  already_pending:
    'You already have a request with the office. Withdraw it first if you want to change it.',
  first_required: 'Enter your first name.',
  last_required: 'Enter your last name.',
  first_too_long: 'Keep your first name to 100 characters.',
  last_too_long: 'Keep your last name to 100 characters.',
  unchanged: 'That’s the same as what’s on file now.',
  evidence_required:
    'Add a photo or scan of your evidence — for example a marriage certificate, deed poll, or a passport in the new name.',
  invalid_path: 'The upload did not complete. Please try again.',
  file_not_found: 'The upload did not complete. Please try again.',
  unsupported_file_type: 'Upload a PDF, JPG or PNG.',
  file_empty: 'That file is empty.',
  file_too_large: 'That file is over 10 MB.',
  photo_required: 'Take a photo first.',
  wrong_path: 'The upload did not complete. Please try again.',
  note_too_long: 'Keep the note to 500 characters.',
  not_pending: 'The office has already dealt with this request.',
  not_found: 'We couldn’t find that request.',
  bad_kind: 'That isn’t something you can ask to change here.',
  not_editable:
    'Your profile is closed to edits. If something needs correcting, contact the office at admin@thehospitalitycompany.co.uk.',
  account_closed: 'We couldn’t find your record. Please contact the office.',
  unknown_staff: 'We couldn’t find your record. Please contact the office.',
};

export function changeReason(raw: string): string {
  for (const [code, text] of Object.entries(CHANGE_REASONS)) {
    if (raw === code || raw.includes(code)) return text;
  }
  return 'That didn’t go through. Please try again.';
}
