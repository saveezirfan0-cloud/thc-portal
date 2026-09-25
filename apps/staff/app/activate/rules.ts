/**
 * Password rules for activation — §1.4, §10.2, wireframes/public/activate.html.
 *
 * A3's rules (reset/rules.ts: ten characters, a number, both fields
 * agree) plus the two the activation frame adds: a letter, and not the
 * person's own name or email. Built ON A3's function, not beside it, so
 * the two screens cannot drift on the rules they share.
 *
 * As with A3 the form uses this for the live checklist and the server
 * action for the decision.
 */
import { checkPassword, MIN_LENGTH } from '../reset/rules';
import type { PasswordChecks } from '../reset/rules';

export { MIN_LENGTH };

export interface Personal {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  /** The account already has a password: the link is spent (§2.7). */
  activated?: boolean;
}

export interface ActivationChecks extends PasswordChecks {
  hasLetter: boolean;
  notPersonal: boolean;
}

/**
 * The pieces of a person a password must not contain: each name, each
 * part of the email's local part, and the whole address. Pieces shorter
 * than three characters are skipped — refusing every password with "li"
 * in it would be a rule nobody can follow.
 */
export function personalParts(person: Personal | null | undefined): string[] {
  if (!person) return [];
  const email = (person.email ?? '').trim().toLowerCase();
  const local = email.split('@')[0] ?? '';
  const pieces = [
    person.firstName ?? '',
    person.lastName ?? '',
    ...(person.firstName ?? '').split(/[\s'’-]+/),
    ...(person.lastName ?? '').split(/[\s'’-]+/),
    local,
    ...local.split(/[._+-]+/),
    email,
  ];
  const out = new Set<string>();
  for (const piece of pieces) {
    const p = piece.trim().toLowerCase();
    if (p.length >= 3) out.add(p);
  }
  return [...out];
}

export function checkActivationPassword(
  password: string,
  confirm: string,
  person: Personal | null | undefined,
): ActivationChecks {
  const lower = password.toLowerCase();
  return {
    ...checkPassword(password, confirm),
    hasLetter: /\p{L}/u.test(password),
    notPersonal: password.length > 0 && !personalParts(person).some((p) => lower.includes(p)),
  };
}

export function activationOk(checks: ActivationChecks): boolean {
  return (
    checks.long && checks.hasNumber && checks.hasLetter && checks.notPersonal && checks.matches
  );
}

/** The one message for a password that fails — the mismatch first, as A3 does. */
export function activationError(checks: ActivationChecks): string | null {
  if (!checks.matches) return 'Passwords don’t match.';
  if (!checks.long) return `Use at least ${MIN_LENGTH} characters.`;
  if (!checks.hasNumber) return 'Include at least one number.';
  if (!checks.hasLetter) return 'Include at least one letter.';
  if (!checks.notPersonal) return 'Don’t use your name or email address in your password.';
  return null;
}
