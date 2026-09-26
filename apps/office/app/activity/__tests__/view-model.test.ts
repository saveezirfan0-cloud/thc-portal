import { describe, expect, it } from 'vitest';
import { actorName, describe as describeRow, parsePeriod, periodStart } from '../view-model';
import {
  actionLabel,
  entityHref,
  entityLabel,
  explainAccountError,
  validatePhone,
} from '../../_lib/accounts';

describe('activity rows', () => {
  it('a settings change reads from → to, without repeating its key', () => {
    expect(
      describeRow({ data: { key: 'booked_elsewhere_gap_minutes', from: 120, to: 150 } }),
    ).toEqual(['120 → 150']);
  });

  it('other data reads as Key: value pairs, ids left out', () => {
    expect(
      describeRow({ data: { reason: 'Late twice', staffId: 'x', fields: ['full_name', 'phone'] } }),
    ).toEqual(['Reason: Late twice', 'Fields: full_name, phone']);
  });

  it('no actor is the system; an actor with no profile left is a former user', () => {
    expect(actorName({ actor: null, actor_name: null })).toBe('System');
    expect(actorName({ actor: 'u', actor_name: null })).toBe('Former user');
    expect(actorName({ actor: 'u', actor_name: 'Gisela M.' })).toBe('Gisela M.');
  });

  it('known actions read as words, and a new one still reads', () => {
    expect(actionLabel('block_manual')).toBe('Blocked worker');
    expect(actionLabel('account.disabled')).toBe('Switched login off');
    expect(actionLabel('payroll.exported_twice')).toBe('Payroll exported twice');
  });

  it('links a record to its Back Office page where one exists', () => {
    expect(entityHref('staff', 'abc')).toBe('/staff/abc');
    expect(entityHref('event', 'abc')).toBe('/events/abc');
    expect(entityHref('settings', null)).toBe('/settings');
    expect(entityHref('booking', 'abc')).toBeNull();
    expect(entityLabel('compliance_docs')).toBe('Documents');
  });

  it('periods default to 30 days and count back from now', () => {
    expect(parsePeriod('nonsense')).toBe('30d');
    const now = new Date('2026-09-25T12:00:00Z');
    expect(periodStart('24h', now)).toBe('2026-09-24T12:00:00.000Z');
    expect(periodStart('all', now)).toBeNull();
  });
});

describe('account rules', () => {
  it('accepts UK and international phone shapes and refuses words', () => {
    expect(validatePhone('')).toBeNull();
    expect(validatePhone('+44 7700 900123')).toBeNull();
    expect(validatePhone('(020) 7946-0958')).toBeNull();
    expect(validatePhone('call me')).not.toBeNull();
  });

  it('turns the database’s refusal codes into words, whatever follows the code', () => {
    expect(explainAccountError('last_admin')).toMatch(/last working Back Office login/);
    expect(explainAccountError('account_has_other_role: detail')).toMatch(
      /different kind of login/,
    );
    expect(explainAccountError('something new')).toMatch(/did not save/);
  });
});
