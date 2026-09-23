import { describe, expect, it } from 'vitest';
import {
  activationError,
  activationOk,
  checkActivationPassword,
  personalParts,
} from '../activate/rules';
import { checkPassword } from '../reset/rules';

/**
 * Activation's password rules — wireframes/public/activate.html: A3's
 * three (reset/rules.ts) plus a letter and "not your name or email".
 */
const AMARA = { firstName: 'Amara', lastName: 'Kalu', email: 'amara.kalu@example.com' };

describe('activation password rules', () => {
  it('the wireframe’s own example passes', () => {
    expect(
      activationOk(checkActivationPassword('Gala-Dinner-2026', 'Gala-Dinner-2026', AMARA)),
    ).toBe(true);
  });

  it('keeps every A3 rule exactly as A3 decides it', () => {
    for (const [pw, confirm] of [
      ['shortnum1', 'shortnum1'],
      ['longenoughpw', 'longenoughpw'],
      ['longenough1', 'longenough2'],
      ['longenough1', 'longenough1'],
    ] as const) {
      const a3 = checkPassword(pw, confirm);
      const act = checkActivationPassword(pw, confirm, null);
      expect({ long: act.long, hasNumber: act.hasNumber, matches: act.matches }).toEqual(a3);
    }
  });

  it('needs a letter — ten digits is not a password', () => {
    const checks = checkActivationPassword('1234567890', '1234567890', null);
    expect(checks.hasLetter).toBe(false);
    expect(activationError(checks)).toBe('Include at least one letter.');
  });

  it('refuses the name or the email, in any case, anywhere in the password', () => {
    for (const pw of [
      'Amara2026xyz',
      'xxKALU12345',
      'amara.kalu@example.com1',
      'my-amara.kalu-99',
    ]) {
      const checks = checkActivationPassword(pw, pw, AMARA);
      expect(checks.notPersonal, pw).toBe(false);
      expect(activationError(checks)).toMatch(/name or email/);
    }
  });

  it('skips pieces too short to be a rule anyone can follow', () => {
    expect(personalParts({ firstName: 'Li', lastName: 'Wu', email: 'li.wu@example.com' })).toEqual([
      'li.wu',
      'li.wu@example.com',
    ]);
    expect(
      activationOk(
        checkActivationPassword('Linen-Wuthering-9', 'Linen-Wuthering-9', {
          firstName: 'Li',
          lastName: 'Wu',
          email: 'li.wu@example.com',
        }),
      ),
    ).toBe(true);
  });

  it('with nobody known yet (before the link is verified) the personal rule cannot fail', () => {
    expect(checkActivationPassword('Amara2026xyz', 'Amara2026xyz', null).notPersonal).toBe(true);
  });

  it('an untouched form ticks nothing', () => {
    const checks = checkActivationPassword('', '', AMARA);
    expect(checks.matches).toBe(false);
    expect(checks.notPersonal).toBe(false);
    expect(activationOk(checks)).toBe(false);
  });

  it('reports the mismatch first, as A3 does', () => {
    expect(activationError(checkActivationPassword('Amara1', 'Amara2', AMARA))).toMatch(/match/);
  });
});
