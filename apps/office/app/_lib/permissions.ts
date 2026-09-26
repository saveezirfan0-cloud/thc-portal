/**
 * Office roles — who in the Back Office may use what (ADR-0056, ADR-0060).
 *
 * The database is the authority: `office_can()` (20261001200100, and
 * 20261001201100 for the viewer) gates the account functions, the
 * settings writes and every money-only table, view and report, and the
 * `office_read_only` triggers refuse every write a viewer makes. This file
 * mirrors that table so the screens can hide what the database would
 * refuse anyway — a nav item that always errors reads as broken, not as
 * "not for you". Pure, so the test pins it against the migration's matrix.
 */

export type OfficeRole = 'owner' | 'manager' | 'scheduler' | 'viewer';
export type OfficePermission = 'users' | 'settings' | 'finance' | 'write';

export const OFFICE_ROLES: readonly OfficeRole[] = ['owner', 'manager', 'scheduler', 'viewer'];

/** The default for a newly invited Back Office login (admin_register_account). */
export const DEFAULT_OFFICE_ROLE: OfficeRole = 'manager';

export const OFFICE_ROLE_LABEL: Readonly<Record<OfficeRole, string>> = {
  owner: 'Owner',
  manager: 'Manager',
  scheduler: 'Scheduler',
  viewer: 'Viewer',
};

/** One line per role, for the invite picker and the access note on /users. */
export const OFFICE_ROLE_SUMMARY: Readonly<Record<OfficeRole, string>> = {
  owner: 'Everything, including Users & access and System settings.',
  manager:
    'Everything except Users & access and System settings — scheduling, compliance, staff, clients, rates, reports.',
  scheduler:
    'Scheduling, onboarding, compliance, check-in, staff, clients, venues and feedback — no pay or charge rates, margins, payroll, reports or bank details.',
  viewer:
    'Read-only: sees what a manager sees, reports and rates included, and cannot change anything — for an auditor, an accountant or someone shadowing the office.',
};

/** `office_can()`'s matrix, exactly. */
const GRANTS: Readonly<Record<OfficeRole, readonly OfficePermission[]>> = {
  owner: ['users', 'settings', 'finance', 'write'],
  manager: ['finance', 'write'],
  scheduler: ['write'],
  viewer: ['finance'],
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

/**
 * Is this a read-only login (ADR-0060)? Only a KNOWN viewer is: an unknown
 * role is not treated as read-only, for the reason `officeCan` gives —
 * the database refuses a viewer's writes whatever the screen shows.
 */
export function isReadOnly(role: OfficeRole | null | undefined): boolean {
  return role === 'viewer';
}

/** The Back Office shell's banner for a viewer (ADR-0060). */
export const READ_ONLY_BANNER = {
  title: 'Read-only access',
  body: 'You can open every screen your role shows, reports included, but you cannot change anything — a save, send or delete will be refused. Ask an owner if something needs changing.',
} as const;

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
  finance:
    'Pay and charge rates, margins, payroll and reports are for owners, managers and viewers.',
  write: 'Your login is read-only.',
};

/**
 * The database's refusals added by 20261001200100 and 20261001201100 /
 * 220200 (ADR-0060), in words a manager can act on.
 */
const MESSAGES: Readonly<Record<string, string>> = {
  not_permitted: 'Your office role does not allow this. Ask an owner.',
  read_only:
    'Your login is read-only (Viewer), so nothing was changed. Ask an owner if this needs doing.',
  cannot_reset_own_two_step:
    'You cannot reset your own two-step here — remove it from My profile, with a code from your phone.',
  no_two_step: 'This login does not have two-step on, so there is nothing to reset.',
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
