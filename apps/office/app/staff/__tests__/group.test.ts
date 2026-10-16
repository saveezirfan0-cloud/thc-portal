import { describe, expect, it } from 'vitest';
import { matchesGroup, matchesQuery } from '../staff';
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
