/**
 * Password rules for A3 — §10.2, wireframes/staff/auth.html.
 *
 * The rules themselves live in `@thc/domain` (password.ts) since the Back
 * Office and Client Portal gained their own A3: one definition for three
 * apps, so no screen ticks a password another server refuses. This module
 * keeps the names the Staff App already imports.
 */
export {
  PASSWORD_MIN_LENGTH as MIN_LENGTH,
  checkPassword,
  passwordError,
  passwordOk,
} from '@thc/domain';
export type { PasswordChecks } from '@thc/domain';
