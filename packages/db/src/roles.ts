/** §1.4. Every table is protected by RLS; the app layer only routes. */
export const ROLES = ['admin', 'client', 'staff'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Which app each role belongs in. A forged URL is stopped here and again by RLS. */
export const HOME_PATH: Readonly<Record<Role, string>> = {
  admin: '/dashboard',
  client: '/events',
  staff: '/shifts',
};
