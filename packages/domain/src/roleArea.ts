/**
 * Front of House / Back of House — how the role pickers are ordered.
 *
 * The role catalogue is one flat list (`roles.name`, unique), which is hard to
 * scan at 20+ roles. The office pickers group it instead: FOH is guest-facing
 * service, BOH is kitchen, cleaning, logistics and set-up. It is a display
 * grouping only — it gates nothing, and no rule, rate or invitation reads it.
 *
 * Keyed by name because the catalogue has no area column yet. A role this list
 * does not know (new or renamed under Roles) lands in "Other", so it is never
 * hidden from a picker.
 */

export type RoleArea = 'foh' | 'boh' | 'other';

export const ROLE_AREA_LABEL: Record<RoleArea, string> = {
  foh: 'Front of House',
  boh: 'Back of House',
  other: 'Other roles',
};

const FOH_ROLES = [
  'Bar Staff',
  'Barista',
  'Cloakroom Staff',
  'Day Waiting Staff M&E',
  'Delegate Registration Assistant',
  'Evening Waiting Staff',
  "Evening Waiting Staff Leo's Bar",
  'Host',
  'Mid Morning Waiting',
  'Receptionist',
  'Runner',
  'Team Leader',
  'Waiting Staff',
  'Wine Waiting Service',
];

const BOH_ROLES = [
  'Breakdown/Set Up Staff',
  'Chef',
  'Cleaning Staff',
  'Housekeeping Staff',
  'Kitchen Assistant',
  'Kitchen Porter',
  'Lifting and Shifting',
  'On-site Delivery Support',
];

const AREA_BY_NAME = new Map<string, RoleArea>([
  ...FOH_ROLES.map((name): [string, RoleArea] => [name.toLowerCase(), 'foh']),
  ...BOH_ROLES.map((name): [string, RoleArea] => [name.toLowerCase(), 'boh']),
]);

export function roleArea(name: string): RoleArea {
  return AREA_BY_NAME.get(name.trim().toLowerCase()) ?? 'other';
}

export interface RoleAreaGroup<T> {
  area: RoleArea;
  label: string;
  roles: T[];
}

/**
 * Splits roles into Front of House, Back of House and Other, in that order,
 * each A → Z. An empty group is left out, so "Other" only appears when a
 * role needs it.
 */
export function groupRolesByArea<T extends { name: string }>(
  roles: readonly T[],
): RoleAreaGroup<T>[] {
  const sorted = [...roles].sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
  return (['foh', 'boh', 'other'] as const)
    .map((area) => ({
      area,
      label: ROLE_AREA_LABEL[area],
      roles: sorted.filter((role) => roleArea(role.name) === area),
    }))
    .filter((group) => group.roles.length > 0);
}
