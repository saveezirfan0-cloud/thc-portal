import { describe, expect, it } from 'vitest';
import { matchesGroup, matchesQuery, payrollIdRepeatsEmployeeId } from '../staff';
import type { StaffRow } from '../types';

/** ADR-0107 · the Staff directory's group filter and the Payroll ID search. */
const base = {
  id: 's-1',
  employee_id: 2200,
  status: 'compliant',
  removed: false,
  display_name: 'Sid Spud',
  role_names: ['Bar Staff'],
} as unknown as StaffRow;

const spud: StaffRow = { ...base, spudbros_express: true, payroll_id: '1641A' };
const own: StaffRow = { ...base, id: 's-2', display_name: 'Tia Own' };

describe('matchesGroup', () => {
  it('All shows everyone', () => {
    expect(matchesGroup(spud, 'all')).toBe(true);
    expect(matchesGroup(own, 'all')).toBe(true);
  });

  it('SpudBros Express shows only SpudBros Express staff', () => {
    expect(matchesGroup(spud, 'spudbros')).toBe(true);
    expect(matchesGroup(own, 'spudbros')).toBe(false);
  });

  it('THC only shows everyone else — a row from an older view has no marker and counts as THC', () => {
    expect(matchesGroup(spud, 'thc')).toBe(false);
    expect(matchesGroup(own, 'thc')).toBe(true);
  });

  it('a SpudBros person with THC shifts switched on is still SpudBros Express', () => {
    expect(matchesGroup({ ...spud, thc_shifts_enabled: true }, 'spudbros')).toBe(true);
  });
});

describe('matchesQuery — the Payroll ID', () => {
  it('finds a worker by their Payroll ID, in any case', () => {
    expect(matchesQuery(spud, '1641a')).toBe(true);
    expect(matchesQuery(spud, ' 1641A ')).toBe(true);
  });

  it('a worker with none is not found by it', () => {
    expect(matchesQuery(own, '1641a')).toBe(false);
  });

  it('still finds by name and by role', () => {
    expect(matchesQuery(spud, 'sid')).toBe(true);
    expect(matchesQuery(spud, 'bar')).toBe(true);
  });
});

describe('payrollIdRepeatsEmployeeId — the second line under the Employee ID', () => {
  it('is hidden when a numeric Payroll ID is the Employee ID (THC-06096 / 6096)', () => {
    expect(payrollIdRepeatsEmployeeId(6096, '6096')).toBe(true);
    expect(payrollIdRepeatsEmployeeId(183, '183')).toBe(true);
  });

  it('is shown for an ID with a letter, or a number that differs', () => {
    expect(payrollIdRepeatsEmployeeId(2200, '1641A')).toBe(false);
    expect(payrollIdRepeatsEmployeeId(2200, '1641')).toBe(false);
  });

  it('is shown when there is no Employee ID yet, and absent when there is no Payroll ID', () => {
    expect(payrollIdRepeatsEmployeeId(null, '6096')).toBe(false);
    expect(payrollIdRepeatsEmployeeId(6096, null)).toBe(false);
    expect(payrollIdRepeatsEmployeeId(6096, undefined)).toBe(false);
  });
});

describe('matchesQuery — the phone', () => {
  const withPhone: StaffRow = { ...base, phone: '+447700900456' };

  it('finds a worker by phone in the shapes a manager types', () => {
    for (const q of [
      '07700 900456',
      '07700900456',
      '+44 7700 900456',
      '0044 7700 900456',
      '900456',
      '447700900456',
    ]) {
      expect(matchesQuery(withPhone, q)).toBe(true);
    }
  });

  it('does not match a different number, or a worker with no phone', () => {
    expect(matchesQuery(withPhone, '07700 900999')).toBe(false);
    expect(matchesQuery(base, '07700 900456')).toBe(false);
  });
});
