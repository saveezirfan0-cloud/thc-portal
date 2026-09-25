import { describe, expect, it } from 'vitest';
import { ukInstant } from '@thc/domain';
import type { EventInput } from '../actions';
import {
  EDIT_CLIENT_LOCKED,
  NEEDS_TIMES,
  clientChanged,
  reconfirmKey,
  validateEventInput,
} from '../save-rules';

const DATE = '2026-09-18';

function input(over: Partial<EventInput> = {}): EventInput {
  return {
    id: null,
    clientId: 'client-leonardo',
    venueId: 'venue-leonardo',
    title: 'Gala Dinner',
    date: DATE,
    poNumber: '',
    onsiteContact: '',
    notes: '',
    autoAssign: true,
    roles: [
      {
        id: null,
        roleId: 'role-waiting',
        start: '17:00',
        end: '23:30',
        headcount: 12,
        buffer: 2,
        chargeRate: 22.97,
        payRate: 14,
        dressCode: 'Black & whites',
        autoAssign: true,
        allocationPerHour: 14,
      },
    ],
    ...over,
  };
}

describe('the server re-checks the payload (§3.2)', () => {
  it('accepts a complete event', () => {
    expect(validateEventInput(input())).toBeNull();
  });

  // A caller that bypasses the disabled button used to reach `ukInstant`,
  // which throws a RangeError on a blank; the action promises `{ error }`.
  it('refuses a blank start or end before resolving it, without throwing', () => {
    const blankStart = input({ roles: [{ ...input().roles[0]!, start: '' }] });
    expect(() => validateEventInput(blankStart)).not.toThrow();
    expect(validateEventInput(blankStart)).toBe(NEEDS_TIMES);
    const blankEnd = input({ roles: [{ ...input().roles[0]!, end: '' }] });
    expect(validateEventInput(blankEnd)).toBe(NEEDS_TIMES);
  });

  it('refuses a malformed date the same way', () => {
    expect(() => validateEventInput(input({ date: '18/09/2026' }))).not.toThrow();
    expect(validateEventInput(input({ date: '18/09/2026' }))).toBe('Set the event date.');
  });

  it('still applies the four-hour floor once the shape is right', () => {
    const short = input({ roles: [{ ...input().roles[0]!, start: '17:00', end: '19:00' }] });
    expect(validateEventInput(short)).toMatch(/4 hours/);
  });
});

describe('the client is not on the editable list (§3.2)', () => {
  it("refuses a save that names another client, in the manager's words", () => {
    expect(clientChanged('client-leonardo', 'client-dorchester')).toBe(true);
    expect(clientChanged('client-leonardo', 'client-leonardo')).toBe(false);
    expect(EDIT_CLIENT_LOCKED).toMatch(/cannot be changed/);
  });
});

describe('the N11 key names what changed (§3.5, §8)', () => {
  const startsAt = ukInstant(DATE, '19:00');
  const endsAt = ukInstant(DATE, '23:00');

  it('is stable for a re-save of identical values', () => {
    expect(reconfirmKey('b1', { startsAt, endsAt, dressCode: null })).toBe(
      reconfirmKey('b1', { startsAt, endsAt, dressCode: null }),
    );
  });

  it('changes when only the END moves, so the second push is not a no-op', () => {
    const later = ukInstant('2026-09-19', '01:00');
    expect(reconfirmKey('b1', { startsAt, endsAt, dressCode: null })).not.toBe(
      reconfirmKey('b1', { startsAt, endsAt: later, dressCode: null }),
    );
  });

  it('changes when only the dress code moves', () => {
    expect(reconfirmKey('b1', { startsAt, endsAt, dressCode: 'Chef whites' })).not.toBe(
      reconfirmKey('b1', { startsAt, endsAt, dressCode: 'Kitchen blacks' }),
    );
  });

  it("is per booking, under the register's N11 prefix", () => {
    const key = reconfirmKey('b1', { startsAt, endsAt, dressCode: null });
    expect(key.startsWith('N11:booking:b1:')).toBe(true);
    expect(key).not.toBe(reconfirmKey('b2', { startsAt, endsAt, dressCode: null }));
  });
});
