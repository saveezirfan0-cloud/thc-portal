/**
 * Password rules for A3 Set new password — §10.2, `wireframes/staff/auth.html`,
 * and the same A3 the Back Office and Client Portal land on after a reset
 * (`wireframes/backoffice/login.html`, `wireframes/client/login.html`).
 *
 * The wireframe shows them as a live checklist, so the rules have to be
 * readable by both the form (as the person types) and the server action
 * (which is the one that actually decides). One function, used by every
 * app — copies drift, and the server ends up rejecting a password the
 * screen ticked.
 */
export interface PasswordChecks {
  long: boolean;
  hasNumber: boolean;
  matches: boolean;
}

export const PASSWORD_MIN_LENGTH = 10;

export function checkPassword(password: string, confirm: string): PasswordChecks {
  return {
    long: password.length >= PASSWORD_MIN_LENGTH,
    hasNumber: /\d/.test(password),
    // An empty pair is not a match: otherwise the checklist ticks green on
    // an untouched form.
    matches: password.length > 0 && password === confirm,
  };
}

export function passwordOk(checks: PasswordChecks): boolean {
  return checks.long && checks.hasNumber && checks.matches;
}

/** The one message for a password that fails the rules. */
export function passwordError(checks: PasswordChecks): string | null {
  if (!checks.matches) return 'Passwords don’t match.';
  if (!checks.long) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!checks.hasNumber) return 'Include at least one number.';
  return null;
}
