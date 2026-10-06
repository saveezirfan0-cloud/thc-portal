import { describe, expect, it } from 'vitest';
import { groupRolesByArea, roleArea } from '../roleArea.ts';

describe('roleArea', () => {
  it('puts guest-facing roles in Front of House and kitchen / logistics in Back of House', () => {
    expect(roleArea('Waiting Staff')).toBe('foh');
    expect(roleArea("Evening Waiting Staff Leo's Bar")).toBe('foh');
    expect(roleArea('Kitchen Porter')).toBe('boh');
    expect(roleArea('Breakdown/Set Up Staff')).toBe('boh');
  });

  it('ignores case and stray spaces, and sends unknown roles to other', () => {
    expect(roleArea('  bar staff ')).toBe('foh');
    expect(roleArea('Sommelier')).toBe('other');
  });
});

describe('groupRolesByArea', () => {
  const roles = ['Waiting Staff', 'Chef', 'Bar Staff', 'Kitchen Porter', 'Sommelier'].map(
    (name, i) => ({ id: String(i), name }),
  );

  it('orders FOH, BOH, other — each A to Z', () => {
    const groups = groupRolesByArea(roles);
    expect(groups.map((g) => g.label)).toEqual(['Front of House', 'Back of House', 'Other roles']);
    expect(groups[0]!.roles.map((r) => r.name)).toEqual(['Bar Staff', 'Waiting Staff']);
    expect(groups[1]!.roles.map((r) => r.name)).toEqual(['Chef', 'Kitchen Porter']);
  });

  it('leaves out empty groups and never drops a role', () => {
    expect(groupRolesByArea([{ name: 'Host' }]).map((g) => g.area)).toEqual(['foh']);
    const all = groupRolesByArea(roles).flatMap((g) => g.roles);
    expect(all).toHaveLength(roles.length);
  });
});
