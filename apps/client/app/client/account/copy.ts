import { DEFAULT_SENDER_ADDRESSES } from '@thc/notifications';

/**
 * "Your account" copy (ADR-0036), in a plain module so the server action,
 * the page and their tests read one string. A `'use server'` file may
 * export only async functions.
 */

/**
 * Where "Need something changed?" sends the customer.
 *
 * There is no single "office email" in the codebase. The office's own
 * mailbox is `settings.senders.admin` (§9.12, editable at /settings), which
 * the client role cannot read and must not be given (ADR-0004); its code
 * fallback appears as `DEFAULT_SENDER_ADDRESSES.admin`, `SUPPORT_EMAIL` in
 * @thc/domain, and as literals across the apps. So this uses the address the
 * §11.3 document footer prints (`COMPANY.email` in packages/pdf), which is
 * the same mailbox §11.4 names as the sender of the documents this page
 * lists the recipients of: timesheets@. It is read from the §9.12 register
 * rather than typed again, so there is one copy of the string in this app.
 */
export const OFFICE_EMAIL: string = DEFAULT_SENDER_ADDRESSES.timesheets;

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
