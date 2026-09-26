/**
 * The rules and words shared by /account, /users and /activity (ADR-0055).
 *
 * Pure, so the screens can check a form before it is sent and the tests
 * can pin both halves. The database checks the same things again in
 * 20261001200000 — these only save a round trip and say it earlier.
 */

export const NAME_MAX = 120;
export const JOB_TITLE_MAX = 80;

/** The same shape `update_my_profile` accepts: digits, spaces, ( ) - and one leading +. */
const PHONE = /^\+?\(?[0-9][0-9 ()-]{5,22}$/;
/** Deliberately loose: GoTrue is the authority on what an address is. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateName(value: string): string | null {
  const name = value.trim();
  if (name.length < 2) return 'Enter a name of at least two characters.';
  if (name.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
  return null;
}

export function validatePhone(value: string): string | null {
  const phone = value.trim();
  if (!phone) return null;
  return PHONE.test(phone) ? null : 'Enter a phone number using digits, spaces and an optional +.';
}

export function validateJobTitle(value: string): string | null {
  return value.trim().length > JOB_TITLE_MAX
    ? `Keep the job title under ${JOB_TITLE_MAX} characters.`
    : null;
}

export function validateEmail(value: string): string | null {
  return EMAIL.test(value.trim()) ? null : 'Enter a valid email address.';
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** The database's refusals (20261001200000, 20261001201200), in words a manager can act on. */
const MESSAGES: Record<string, string> = {
  not_signed_in: 'Your session has ended. Sign in again.',
  not_authorised: 'Only the office can do this.',
  // ADR-0060: a viewer's write, refused by the office_read_only triggers.
  read_only:
    'Your login is read-only (Viewer), so nothing was changed. Ask an owner if this needs doing.',
  no_profile:
    'This login has no profile yet. Ask another admin to invite it again from Users & access.',
  use_staff_profile: 'A worker’s name is edited on their staff profile.',
  name_required: 'Enter a name of at least two characters.',
  phone_invalid: 'Enter a phone number using digits, spaces and an optional +.',
  job_title_too_long: `Keep the job title under ${JOB_TITLE_MAX} characters.`,
  role_not_allowed:
    'Workers get their login when they are accepted in Onboarding, not from this screen.',
  client_required: 'Pick the client this login belongs to.',
  unknown_client: 'That client no longer exists — refresh the page.',
  client_not_allowed: 'A Back Office login is not tied to a client.',
  unknown_account: 'That login no longer exists — refresh the page.',
  account_has_other_role:
    'This email address already belongs to a different kind of login (a worker or a client). Use another address.',
  account_has_other_client:
    'This email address already has a Client Portal login for a different client. Use another address.',
  already_signed_in:
    'This person already uses their login, so no link is issued — a link would let whoever holds it sign in as them. They can reset their own password with “Forgot password” on the sign-in screen.',
  use_staff_block:
    'A worker is blocked or removed on their staff profile, which also takes them off their shifts.',
  cannot_disable_self: 'You cannot switch off your own login.',
  reason_required: 'Give a reason — it goes in the activity log.',
  last_admin: 'This is the last working Back Office login. Invite another admin first.',
  // ADR-0060: Reset two-step on /users.
  not_office_login: 'Only a Back Office login has two-step sign-in.',
  cannot_reset_own_two_step:
    'You cannot reset your own two-step here — remove it from My profile, with a code from your phone.',
  no_two_step: 'This login does not have two-step on, so there is nothing to reset.',
};

export function explainAccountError(message: string): string {
  const code = message.split(':')[0]?.trim() ?? '';
  return (
    MESSAGES[code] ?? 'That did not save. Try again, and if it keeps happening tell a developer.'
  );
}

// ---------------------------------------------------------------------
// The activity log's words
// ---------------------------------------------------------------------

/** What each `audit_log.entity` is called on screen. */
export const ENTITY_LABEL: Readonly<Record<string, string>> = {
  staff: 'Staff',
  compliance_docs: 'Documents',
  booking: 'Bookings',
  event: 'Events',
  account: 'Users & access',
  settings: 'Settings',
  client: 'Clients',
  client_qualification: 'Qualifications',
};

export function entityLabel(entity: string): string {
  return ENTITY_LABEL[entity] ?? entity.replace(/_/g, ' ');
}

/**
 * The action codes the definer functions write, as a sentence fragment.
 * Anything not listed is shown as its code made readable, so a new action
 * appears on the log the day it ships rather than waiting for this list.
 */
const ACTION_LABEL: Readonly<Record<string, string>> = {
  application_submitted: 'Application submitted',
  onboarding_accept: 'Accepted candidate',
  onboarding_reject: 'Rejected candidate',
  onboarding_resend_activation: 'Resent activation link',
  link_staff_account: 'Linked Staff App login',
  quiz_unlocked: 'Unlocked the H&S quiz',
  contract_signed: 'Signed contract',
  block_manual: 'Blocked worker',
  unblock: 'Unblocked worker',
  reset_to_candidate: 'Reset to candidate',
  gdpr_remove: 'Removed worker (GDPR)',
  'rtw.verified': 'Verified right to work',
  'rtw.changed': 'Changed right to work',
  'rtw_check.requested': 'Requested gov.uk check',
  'rtw_check.reviewed': 'Reviewed gov.uk check',
  'document.uploaded': 'Uploaded document',
  'wtr_optout.signed': 'Signed 48-hour opt-out',
  'wtr_optout.cancelled': 'Cancelled 48-hour opt-out',
  'rota_guard.warned': 'Rota guard warning',
  'booking.manual_invite': 'Invited to a shift',
  'booking.application_accepted': 'Accepted shift application',
  'event.cancelled': 'Cancelled event',
  do_not_return_on: 'Marked do not return',
  do_not_return_off: 'Cleared do not return',
  'profile.updated': 'Updated own profile',
  'account.invited': 'Invited user',
  'account.reinvited': 'Re-sent user invite',
  'account.invite_emailed': 'Emailed user invite',
  'account.role_changed': 'Changed office role',
  'account.two_step_reset': 'Reset two-step sign-in',
  'account.disabled': 'Switched login off',
  'account.enabled': 'Switched login on',
  'settings.insert': 'Added setting',
  'settings.update': 'Changed setting',
  'settings.delete': 'Cleared setting',
  'settings.radius_changed': 'Changed default radius',
};

export function actionLabel(action: string): string {
  const known = ACTION_LABEL[action];
  if (known) return known;
  const words = action.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Where the row an entry is about lives in the Back Office, if anywhere. */
export function entityHref(entity: string, id: string | null): string | null {
  if (!id) return entity === 'settings' ? '/settings' : null;
  switch (entity) {
    case 'staff':
      return `/staff/${id}`;
    case 'event':
      return `/events/${id}`;
    case 'client':
      return `/clients/${id}`;
    case 'account':
      return '/users';
    default:
      return null;
  }
}

/** The role names used on /users — "admin" is the Back Office (§1.4). */
export const ROLE_LABEL: Readonly<Record<'admin' | 'client' | 'staff', string>> = {
  admin: 'Back Office',
  client: 'Client Portal',
  staff: 'Staff App',
};
