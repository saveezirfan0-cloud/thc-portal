import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RoleSection } from '../_components/RoleSection';
import type { RoleDraft } from '../draft';

function role(payRate: number): RoleDraft {
  return {
    key: 'role-1',
    id: null,
    roleId: 'r-bartender',
    start: '17:00',
    end: '23:00',
    headcount: 12,
    buffer: 1,
    chargeRate: 30.69,
    payRate,
    dressCode: '',
    dressCodeOther: '',
    autoAssign: true,
    allocationPerHour: 13,
    allocationTouched: false,
  };
}

function render(payRate: number, ratesVisible = true): string {
  return renderToStaticMarkup(
    <RoleSection
      mode="new"
      index={0}
      role={role(payRate)}
      date="2026-10-14"
      issues={[]}
      roles={[{ id: 'r-bartender', name: 'Bartender', payRate: 19 }]}
      client={undefined}
      confirmed={0}
      booked={0}
      changed={new Set()}
      original={undefined}
      locked={false}
      ratesVisible={ratesVisible}
      onChange={() => {}}
      onRemove={() => {}}
    />,
  );
}

/** The figures under "Pay rate (base)", label → value, in order. */
function split(html: string): [string, string][] {
  const dl = html.match(/<dl class="rate-split"[^>]*>(.*?)<\/dl>/)?.[1] ?? '';
  return [...dl.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map((m) => [m[1]!, m[2]!]);
}

describe('Pay rate (base) in the Shift Builder (§9.8, §1.5)', () => {
  it('says what the worker sees, then holiday broken out, then the final rate', () => {
    expect(split(render(19))).toEqual([
      ['Staff App shows', '£19.00/h'],
      ['Holiday +12.07%', '+£2.29'],
      ['Final rate', '£21.29/h'],
    ]);
  });

  it('shows dashes, not £0.00, before a rate is entered', () => {
    expect(split(render(0)).map(([, v]) => v)).toEqual(['—', '—', '—']);
  });

  it('is absent for an office role without finance (ADR-0061)', () => {
    expect(render(19, false)).not.toContain('rate-split');
  });
});
