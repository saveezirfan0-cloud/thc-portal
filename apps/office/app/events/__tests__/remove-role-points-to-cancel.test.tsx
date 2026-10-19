import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TimeFormatProvider } from '@thc/ui';
import { RoleSection } from '../_components/RoleSection';
import type { RoleDraft } from '../draft';

/**
 * A manager who wants an event off the schedule hits the greyed-out Remove on
 * a role with people booked. The line under it must say where the whole event
 * is cancelled (§3.3), not only how to withdraw people.
 */
const role: RoleDraft = {
  key: 'role-1',
  id: 'sec-waiting',
  roleId: 'r1',
  start: '18:30',
  end: '23:30',
  headcount: 5,
  buffer: 0,
  chargeRate: 0,
  payRate: 12.71,
  dressCode: '',
  dressCodeOther: '',
  autoAssign: false,
  requiredGender: null,
  sameStaffAllDays: false,
  allocationPerHour: 5,
  allocationTouched: false,
};

function render(booked: number, boardHref?: string) {
  return renderToStaticMarkup(
    <TimeFormatProvider format="24h">
      <RoleSection
        mode="edit"
        index={1}
        role={role}
        date="2026-10-23"
        issues={[]}
        roles={[{ id: 'r1', name: 'Evening Waiting Staff M&E', payRate: 12.71 }]}
        client={undefined}
        confirmed={0}
        booked={booked}
        changed={new Set()}
        original={role}
        locked={false}
        series={{ kind: 'single' }}
        ratesVisible
        onChange={() => {}}
        onRemove={() => {}}
        {...(boardHref ? { boardHref } : {})}
      />
    </TimeFormatProvider>,
  );
}

describe('Remove on a booked role section', () => {
  it('names Cancel event and links to the board', () => {
    const html = render(3, '/events/evt-1');
    expect(html).toContain('Remove is off');
    expect(html).toContain('Cancel event');
    expect(html).toContain('href="/events/evt-1"');
  });

  it('says nothing when nobody is booked', () => {
    expect(render(0, '/events/evt-1')).not.toContain('Remove is off');
  });
});
