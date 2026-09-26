import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFICE_ROLE,
  OFFICE_ROLES,
  canOpen,
  explainOfficeError,
  isOfficeRole,
  isReadOnly,
  officeCan,
  visibleNav,
} from '../permissions';
import { actionLabel, explainAccountError } from '../accounts';

/**
 * ADR-0056, ADR-0060. The matrix below is `office_can()` in
 * 20261001201100_viewer_role_read_only.sql, and 741_office_roles /
 * 750_viewer_role assert the same rows in the database. If one changes,
 * both change.
 */
describe('office roles', () => {
  const matrix = {
    owner: { users: true, settings: true, finance: true, write: true },
    manager: { users: false, settings: false, finance: true, write: true },
    scheduler: { users: false, settings: false, finance: false, write: true },
    viewer: { users: false, settings: false, finance: true, write: false },
  } as const;

  for (const role of OFFICE_ROLES) {
    it(`${role}: matches office_can()`, () => {
      expect(officeCan(role, 'users')).toBe(matrix[role].users);
      expect(officeCan(role, 'settings')).toBe(matrix[role].settings);
      expect(officeCan(role, 'finance')).toBe(matrix[role].finance);
      expect(officeCan(role, 'write')).toBe(matrix[role].write);
    });
  }

  it('only a known viewer is read-only', () => {
    expect(isReadOnly('viewer')).toBe(true);
    for (const role of ['owner', 'manager', 'scheduler'] as const) {
      expect(isReadOnly(role)).toBe(false);
    }
    expect(isReadOnly(null)).toBe(false);
  });

  it('a new Back Office login defaults to manager', () => {
    expect(DEFAULT_OFFICE_ROLE).toBe('manager');
  });

  it('an unknown role hides nothing — the database still refuses', () => {
    expect(officeCan(null, 'users')).toBe(true);
    expect(officeCan(undefined, 'finance')).toBe(true);
  });

  it('recognises only the four roles', () => {
    expect(isOfficeRole('owner')).toBe(true);
    expect(isOfficeRole('viewer')).toBe(true);
    expect(isOfficeRole('auditor')).toBe(false);
    expect(isOfficeRole(null)).toBe(false);
  });
});

describe('navigation per role', () => {
  const nav = [
    '/dashboard',
    '/events',
    '/staff',
    '/clients',
    '/roles',
    '/reports',
    '/feedback',
    '/venues',
    '/settings',
    '/users',
    '/activity',
    '/account',
  ].map((href) => ({ href }));
  const hrefs = (role: Parameters<typeof visibleNav>[1]) =>
    visibleNav(nav, role).map((item) => item.href);

  it('an owner sees everything', () => {
    expect(hrefs('owner')).toEqual(nav.map((item) => item.href));
  });

  it('a manager loses Settings and Users & access', () => {
    const shown = hrefs('manager');
    expect(shown).not.toContain('/settings');
    expect(shown).not.toContain('/users');
    expect(shown).toContain('/reports');
    expect(shown).toContain('/roles');
    expect(shown).toContain('/activity');
  });

  it('a scheduler also loses Reports and Roles & rates, and keeps the operational screens', () => {
    const shown = hrefs('scheduler');
    for (const hidden of ['/settings', '/users', '/reports', '/roles']) {
      expect(shown).not.toContain(hidden);
    }
    for (const kept of ['/dashboard', '/events', '/staff', '/clients', '/venues', '/feedback']) {
      expect(shown).toContain(kept);
    }
  });

  it('a viewer sees what a manager sees, Reports and Roles & rates included', () => {
    expect(hrefs('viewer')).toEqual(hrefs('manager'));
  });

  it('a route with no gate is open to every role', () => {
    expect(canOpen('scheduler', '/checkin')).toBe(true);
  });
});

describe('the database refusals, in words', () => {
  it('explains the office-role codes', () => {
    expect(explainOfficeError('last_owner')).toMatch(/last working owner/);
    expect(explainOfficeError('not_permitted')).toMatch(/office role/);
    expect(explainOfficeError('cannot_change_own_role')).toMatch(/own role/);
    expect(explainOfficeError('read_only')).toMatch(/read-only/);
    expect(explainOfficeError('no_two_step')).toMatch(/two-step/);
  });

  it('the shared account explainer knows the viewer and two-step refusals (ADR-0060)', () => {
    expect(explainAccountError('read_only')).toMatch(/read-only \(Viewer\)/);
    expect(explainAccountError('cannot_reset_own_two_step')).toMatch(/My profile/);
    expect(explainAccountError('no_two_step')).toMatch(/nothing to reset/);
    expect(actionLabel('account.two_step_reset')).toBe('Reset two-step sign-in');
  });

  it('returns null for anything else, so the caller keeps its own message', () => {
    expect(explainOfficeError('name_required')).toBeNull();
  });
});
