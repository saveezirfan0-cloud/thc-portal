/**
 * Office roles — who in the Back Office may use what (ADR-0050).
 *
 * The database is the authority: `office_can()` in
 * 20260930210100_office_roles.sql gates the account functions, the
 * settings writes and every money-only table, view and report. This file
 * mirrors that table so the screens can hide what the database would
 * refuse anyway — a nav item that always errors reads as broken, not as
 * "not for you". Pure, so the test pins it against the migration's matrix.
 */

export type OfficeRole = 'owner' | 'manager' | 'scheduler';
export type OfficePermission = 'users' | 'settings' | 'finance';

export const OFFICE_ROLES: readonly OfficeRole[] = ['owner', 'manager', 'scheduler'];

/** The default for a newly invited Back Office login (admin_register_account). */
export const DEFAULT_OFFICE_ROLE: OfficeRole = 'manager';

export const OFFICE_ROLE_LABEL: Readonly<Record<OfficeRole, string>> = {
  owner: 'Owner',
  manager: 'Manager',
  scheduler: 'Scheduler',
};

/** One line per role, for the invite picker and the access note on /users. */
export const OFFICE_ROLE_SUMMARY: Readonly<Record<OfficeRole, string>> = {
  owner: 'Everything, including Users & access and System settings.',
  manager:
    'Everything except Users & access and System settings — scheduling, compliance, staff, clients, rates, reports.',
  scheduler:
    'Scheduling, onboarding, compliance, check-in, staff, clients, venues and feedback — no pay or charge rates, margins, payroll, reports or bank details.',
};

/** `office_can()`'s matrix, exactly. */
const GRANTS: Readonly<Record<OfficeRole, readonly OfficePermission[]>> = {
  owner: ['users', 'settings', 'finance'],
  manager: ['finance'],
  scheduler: [],
};

export function isOfficeRole(value: unknown): value is OfficeRole {
  return typeof value === 'string' && (OFFICE_ROLES as readonly string[]).includes(value);
}

/**
 * May this role use this permission? An unknown role (no session, no
 * project, a profile that could not be read) is answered `true` here on
 * purpose: the screen then shows what it always showed and the database
 * refuses what it must. Hiding everything whenever a profile read hiccups
 * would lock an owner out of their own Settings for no reason the page
 * could explain.
 */
export function officeCan(
  role: OfficeRole | null | undefined,
  permission: OfficePermission,
): boolean {
  if (!role) return true;
  return GRANTS[role].includes(permission);
}

/** Which permission a Back Office section needs, by its route root. */
export const ROUTE_PERMISSION: Readonly<Record<string, OfficePermission>> = {
  '/reports': 'finance',
  '/roles': 'finance',
  '/settings': 'settings',
  '/users': 'users',
};

export function canOpen(role: OfficeRole | null | undefined, href: string): boolean {
  const needs = ROUTE_PERMISSION[href];
  return needs ? officeCan(role, needs) : true;
}

/** The menu without the sections this role cannot use. */
export function visibleNav<T extends { href: string }>(
  items: readonly T[],
  role: OfficeRole | null | undefined,
): T[] {
  return items.filter((item) => canOpen(role, item.href));
}

/** What the "Not available for your role" page says each section needs. */
export const PERMISSION_NEEDS: Readonly<Record<OfficePermission, string>> = {
  users: 'Users & access is for owners.',
  settings: 'System settings are for owners.',
  finance: 'Pay and charge rates, margins, payroll and reports are for owners and managers.',
};

/** The database's refusals added by 20260930210100, in words a manager can act on. */
const MESSAGES: Readonly<Record<string, string>> = {
  not_permitted: 'Your office role does not allow this. Ask an owner.',
  office_role_required: 'Choose an office role for this login.',
  office_role_not_allowed: 'A Client Portal login has no office role.',
  not_office_login: 'Only a Back Office login has an office role.',
  cannot_change_own_role: 'You cannot change your own role — ask another owner.',
  last_owner:
    'This is the last working owner. Make someone else an owner first, so somebody can still manage logins.',
  rates_need_finance:
    'Your office role cannot set pay or charge rates — the catalogue rates are used. Ask a manager to re-price.',
};

/** A message for one of the codes above, or null so the caller falls back to its own. */
export function explainOfficeError(message: string): string | null {
  const code = message.split(':')[0]?.trim() ?? '';
  return MESSAGES[code] ?? null;
}
