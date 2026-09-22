import { describe, expect, it } from 'vitest';
import { checkPassword, passwordError, passwordOk } from '../reset/rules';

/** A3's three rules — §10.2, wireframes/staff/auth.html. */
describe('set a new password (A3)', () => {
  it('needs ten characters, a number, and both fields to agree', () => {
    expect(passwordOk(checkPassword('shortnum1', 'shortnum1'))).toBe(false);
    expect(passwordOk(checkPassword('longenoughpw', 'longenoughpw'))).toBe(false);
    expect(passwordOk(checkPassword('longenough1', 'longenough2'))).toBe(false);
    expect(passwordOk(checkPassword('longenough1', 'longenough1'))).toBe(true);
  });

  it('an untouched form is not a match', () => {
    expect(checkPassword('', '').matches).toBe(false);
    expect(passwordError(checkPassword('', ''))).toBe('Passwords don’t match.');
  });

  it('reports the mismatch first — it is the one they can see', () => {
    expect(passwordError(checkPassword('abc', 'abd'))).toMatch(/match/);
    expect(passwordError(checkPassword('abc1', 'abc1'))).toMatch(/10 characters/);
    expect(passwordError(checkPassword('abcdefghijk', 'abcdefghijk'))).toMatch(/number/);
    expect(passwordError(checkPassword('abcdefghij1', 'abcdefghij1'))).toBeNull();
  });
});
