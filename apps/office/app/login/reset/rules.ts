/**
 * Password rules for A3 (§10.2) — the same three the Staff App holds in
 * apps/staff/app/reset/rules.ts. Readable by both the form (as they type)
 * and the server action (which decides); one function used twice, so the
 * screen never ticks a password the server then rejects.
 *
 * Duplicated per app for now; one copy belongs in packages/domain.
 */
export interface PasswordChecks {
  long: boolean;
  hasNumber: boolean;
  matches: boolean;
}

export const MIN_LENGTH = 10;

export function checkPassword(password: string, confirm: string): PasswordChecks {
  return {
    long: password.length >= MIN_LENGTH,
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
  if (!checks.long) return `Use at least ${MIN_LENGTH} characters.`;
  if (!checks.hasNumber) return 'Include at least one number.';
  return null;
}
