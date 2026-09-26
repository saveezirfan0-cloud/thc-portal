/**
 * Request a change — name and photo. ADR-0044, docs/19 §3 (an addition to
 * Scope v1.6: §10.1 "corrections go through the office" gains an in-app
 * route; §9.6; §8 RC1–RC4; §1.5 ProfileChangeRequest).
 *
 * §10.1 locks the worker's name (right to work + payroll) and the photo
 * ("set once during onboarding and then locked"). Neither lock moves: the
 * worker asks, the office decides. One `profile_change_requests` row per
 * request, one pending per kind; the status machine is
 * `CHANGE_REQUEST_TRANSITIONS` in state.ts and `profile_change_transitions()`
 * in SQL, held to changeRequest.vectors.json by both suites.
 *
 * Approving a name never re-runs the right-to-work check on its own (Q13),
 * and issued PDFs and payroll exports are never corrected retroactively
 * (§1.7) — RC4 tells payroll instead.
 */

export const CHANGE_KINDS = ['name', 'photo'] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

export function isChangeKind(value: string): value is ChangeKind {
  return (CHANGE_KINDS as readonly string[]).includes(value);
}

/** `profile_change_requests_first_name` / `_last_name`: 1–100, trimmed. */
export const CHANGE_NAME_MAX = 100;
/** `profile_change_requests_note`. */
export const CHANGE_NOTE_MAX = 500;
/** `profile_change_requests_reason`: the rejection reason the worker reads. */
export const CHANGE_REASON_MAX = 300;

export const NAME_CHANGE_REFUSALS = [
  'first_required',
  'last_required',
  'first_too_long',
  'last_too_long',
  'unchanged',
] as const;

export type NameChangeRefusal = (typeof NAME_CHANGE_REFUSALS)[number];

export interface PersonName {
  first: string;
  last: string;
}

export type NameChangeValidation =
  { ok: true; first: string; last: string } | { ok: false; reason: NameChangeRefusal };

function chars(value: string): number {
  return Array.from(value).length;
}

/**
 * The name form's check. Trimmed, 1–100 characters each, and different from
 * the name on file — a capitalisation fix IS a change, so the comparison is
 * exact after trimming. `request_profile_change()` refuses the same.
 */
export function validateNameChange(
  proposed: PersonName,
  current?: PersonName | null,
): NameChangeValidation {
  const first = proposed.first.trim();
  const last = proposed.last.trim();
  if (!first) return { ok: false, reason: 'first_required' };
  if (!last) return { ok: false, reason: 'last_required' };
  if (chars(first) > CHANGE_NAME_MAX) return { ok: false, reason: 'first_too_long' };
  if (chars(last) > CHANGE_NAME_MAX) return { ok: false, reason: 'last_too_long' };
  if (current && current.first.trim() === first && current.last.trim() === last) {
    return { ok: false, reason: 'unchanged' };
  }
  return { ok: true, first, last };
}

/**
 * A rejection must say why, and the worker is shown it (docs/19 §3, the
 * `compliance_docs.rejection_reason` precedent). An approval needs none.
 */
export function decisionNeedsReason(approve: boolean): boolean {
  return !approve;
}

export type DecisionRefusal = 'reason_required' | 'reason_too_long';

/** The office's Approve / Reject form: null when it may be sent. */
export function validateDecision(
  approve: boolean,
  reason: string | null | undefined,
): DecisionRefusal | null {
  const text = (reason ?? '').trim();
  if (decisionNeedsReason(approve) && !text) return 'reason_required';
  if (chars(text) > CHANGE_REASON_MAX) return 'reason_too_long';
  return null;
}

function ownPath(prefix: string, path: string): boolean {
  return path.startsWith(prefix) && path.length > prefix.length && !path.includes('..');
}

/**
 * A proposed photo must be the worker's own upload: `photos/<staff_id>/…`
 * (the existing INSERT policy on the bucket). The table's CHECK refuses any
 * other prefix, so a forged request cannot point at somebody else's selfie.
 */
export function isOwnPhotoPath(staffId: string, path: string): boolean {
  return ownPath(`${staffId}/`, path);
}

/** Name-change evidence: `documents/<staff_id>/change-requests/…`. */
export function isOwnEvidencePath(staffId: string, path: string): boolean {
  return ownPath(`${staffId}/change-requests/`, path);
}
