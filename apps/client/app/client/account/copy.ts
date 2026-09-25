import { DEFAULT_SENDER_ADDRESSES } from '@thc/notifications';

/**
 * "Your account" copy (ADR-0036), in a plain module so the server action,
 * the page and their tests read one string. A `'use server'` file may
 * export only async functions.
 */

/**
 * Where "Need something changed?" sends the customer.
 *
 * There is no single "office email" the client can read: the office's own
 * mailbox is `settings.senders.admin` (§9.12, editable at /settings), which
 * the client role cannot read and must not be given (ADR-0004). Its code
 * fallback, `DEFAULT_SENDER_ADDRESSES.admin`, is the address the sign-in
 * page footer already shows the customer, and a change to their details is
 * an office conversation rather than a question about one document — so it
 * goes to admin@, not to the timesheets@ sender. Read from the §9.12
 * register rather than typed again.
 */
export const OFFICE_EMAIL: string = DEFAULT_SENDER_ADDRESSES.admin;

export const ACCOUNT_COPY = {
  title: 'Your account',
  description: 'Who is signed in, and where The Hospitality Company sends your documents.',
  noProject:
    'This environment has no Supabase project, so your account details cannot be loaded. See docs/04-setup-github-vercel-supabase.md.',
  loadFailed: 'We could not load your account details just now. Refresh the page to try again.',
  recipientsHelp:
    'The allocation sheet and the signed timesheet for each of your events are emailed to these addresses.',
  managedByThc:
    'Your name, sign-in email, company and the addresses above are managed by The Hospitality Company, so they cannot be edited here. If anything is wrong or out of date, email the office and we will update it for you.',
} as const;

/**
 * Change password messages. The rule failures themselves come from
 * `passwordError()` in @thc/domain, the same function /reset uses, so the
 * two forms never disagree about what a valid password is.
 */
export const PASSWORD_COPY = {
  currentMissing: 'Enter your current password.',
  currentWrong: 'Your current password is incorrect.',
  samePassword: 'Choose a new password that is different from your current one.',
  // Word for word what /reset says (apps/client/app/reset/actions.ts).
  breached: 'That password has appeared in a known data breach. Choose a different one.',
  tooMany: 'Too many attempts. Wait a few minutes, then try again.',
  reauth: 'For your security, sign out and sign back in, then change your password straight away.',
  signedOut: 'Your session has ended. Sign in again, then change your password.',
  noProject:
    'Changing your password is not available yet — this environment has no Supabase project.',
  failed: 'We could not change your password. Try again in a moment.',
  changed:
    'Password changed. You are still signed in here; every other device has been signed out.',
} as const;
