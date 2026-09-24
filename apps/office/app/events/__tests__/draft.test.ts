import { describe, expect, it } from 'vitest';
import { formatAllocationPair, ukInstant } from '@thc/domain';
import {
  DRESS_CODE_OTHER,
  type EventDraft,
  type RoleDraft,
  canRemoveRole,
  canSave,
  draftIssues,
  draftFromSaved,
  draftLocked,
  draftWindow,
  editRole,
  effectiveDressCode,
  newRoleDraft,
  reconfirmPlan,
  roleIssues,
} from '../draft';
import type { SavedEvent } from '../data';

const DATE = '2026-09-18';

function role(over: Partial<RoleDraft> = {}): RoleDraft {
  return {
    key: 'r1',
    id: null,
    roleId: 'role-waiting',
    start: '17:00',
    end: '23:30',
    headcount: 12,
    buffer: 2,
    chargeRate: 22.97,
    payRate: 14,
    dressCode: 'Black & whites',
    dressCodeOther: '',
    autoAssign: true,
    allocationPerHour: 14,
    allocationTouched: false,
    ...over,
  };
}

function event(over: Partial<EventDraft> = {}): EventDraft {
  return {
    clientId: 'client-leonardo',
    venueId: 'venue-leonardo',
    title: 'Gala Dinner',
    date: DATE,
    overallStart: '07:00',
    overallEnd: '23:30',
    poNumber: '4471-A',
    onsiteContact: 'Marco V.',
    notes: '',
    autoAssign: true,
    roles: [role()],
    ...over,
  };
}

describe('a new role is pre-filled with the event window, then edited on its own (§3.2)', () => {
  it('takes the overall window as its starting times', () => {
    const draft = event({ roles: [] });
    const added = newRoleDraft(draft, 'role-chef');
    expect(added.start).toBe('07:00');
    expect(added.end).toBe('23:30');
  });

  it('does not move the sections that are already there', () => {
    const draft = event();
    const added = newRoleDraft(draft, 'role-chef');
    expect(draft.roles[0]!.start).toBe('17:00');
    expect(added.start).toBe('07:00');
  });

  it('starts auto-assign from the event-level switch (§3.4)', () => {
    expect(newRoleDraft(event({ autoAssign: false }), 'role-chef').autoAssign).toBe(false);
  });
});

describe('allocation follows headcount + buffer until the manager takes over (§3.4)', () => {
  it('re-defaults while it is untouched', () => {
    const next = editRole(role({ allocationPerHour: 14 }), { headcount: 20 });
    expect(next.allocationPerHour).toBe(22);
  });

  it('follows the buffer too', () => {
    expect(editRole(role(), { buffer: 5 }).allocationPerHour).toBe(17);
  });

  it('stops following once it has been typed, and never resets itself', () => {
    const typed = editRole(role(), { allocationPerHour: 6 });
    expect(typed.allocationTouched).toBe(true);

    const later = editRole(typed, { headcount: 30 });
    expect(later.allocationPerHour).toBe(6);
  });

  it('is what the header pair says it is — never the collapsed total', () => {
    const next = editRole(role(), { headcount: 6, buffer: 1 });
    expect(formatAllocationPair(next.headcount, next.buffer)).toBe('6 (+1)');
    expect(next.allocationPerHour).toBe(7);
  });
});

describe('the derived event window, not the typed one (RULE-18)', () => {
  const draft = event({
    overallStart: '07:00',
    overallEnd: '23:30',
    roles: [
      role({ key: 'chef', start: '07:00', end: '15:00' }),
      role({ key: 'kp', start: '09:00', end: '17:00' }),
      role({ key: 'waiting', start: '17:00', end: '23:30' }),
    ],
  });

  it('runs from the earliest role start to the latest role end', () => {
    const window = draftWindow(draft)!;
    expect(window.startsAt).toEqual(ukInstant(DATE, '07:00'));
    expect(window.endsAt).toEqual(ukInstant(DATE, '23:30'));
  });

  it('ignores the overall window once roles exist', () => {
    const narrowed = { ...draft, overallStart: '20:00', overallEnd: '21:00' };
    const window = draftWindow(narrowed)!;
    expect(window.startsAt).toEqual(ukInstant(DATE, '07:00'));
  });

  it('follows an after-midnight role past the event date', () => {
    const late = event({ roles: [role({ start: '18:00', end: '01:00' })] });
    expect(draftWindow(late)!.endsAt).toEqual(ukInstant('2026-09-19', '01:00'));
  });
});

describe('a section is at least four hours, and Save waits for it (§3.2)', () => {
  it('flags the three-hour Host section', () => {
    const host = role({
      roleId: 'role-host',
      start: '18:00',
      end: '21:00',
      headcount: 1,
      buffer: 0,
    });
    expect(roleIssues(host, DATE)).toContain('below_minimum_hours');
  });

  it('disables Save while any section fails, and enables it once fixed', () => {
    const broken = event({
      roles: [role(), role({ key: 'host', start: '18:00', end: '21:00' })],
    });
    expect(canSave(broken)).toBe(false);

    const fixed = {
      ...broken,
      roles: [broken.roles[0]!, { ...broken.roles[1]!, end: '22:00' }],
    };
    expect(canSave(fixed)).toBe(true);
  });

  it('will not save an event with no roles at all', () => {
    const empty = event({ roles: [] });
    expect(canSave(empty)).toBe(false);
    expect(draftIssues(empty).event).toContain('Add at least one role');
  });

  it('flags a short section even before its role type has been chosen', () => {
    // The times are wrong on their own terms; hiding that behind an unrelated
    // empty field leaves the manager guessing why Save stays off.
    const nameless = role({ roleId: '', start: '18:00', end: '21:00' });
    expect(roleIssues(nameless, DATE)).toContain('below_minimum_hours');
    expect(draftIssues(event({ roles: [nameless] })).roles.get(nameless.key)).toContain(
      'below_minimum_hours',
    );
  });

  it('will not save without a client, a venue, a title or a date', () => {
    expect(canSave(event({ clientId: '' }))).toBe(false);
    expect(canSave(event({ venueId: '' }))).toBe(false);
    expect(canSave(event({ title: '   ' }))).toBe(false);
    expect(canSave(event({ date: '' }))).toBe(false);
  });
});

describe('editing is locked once the event has started (§3.2)', () => {
  const draft = event({
    roles: [
      role({ key: 'chef', start: '07:00', end: '15:00' }),
      role({ key: 'waiting', start: '17:00', end: '23:30' }),
    ],
  });

  it('is open the minute before the first role starts', () => {
    expect(draftLocked(draft, ukInstant(DATE, '06:59'))).toBe(false);
  });

  it('is locked from the derived start, including between two role sections', () => {
    expect(draftLocked(draft, ukInstant(DATE, '07:00'))).toBe(true);
    expect(draftLocked(draft, ukInstant(DATE, '16:00'))).toBe(true);
  });

  it('is locked for a past event', () => {
    expect(draftLocked(draft, ukInstant('2026-10-02', '09:00'))).toBe(true);
  });
});

describe('a section with people on it is never removed here (§3.2, §3.6)', () => {
  // bookings.shift_id cascades on delete: removing the section would wipe the
  // invitations and confirmations with it, which is not a transition §3.6 has.
  it('refuses a saved section that still has bookings', () => {
    const saved = role({ id: 'sec-waiting' });
    expect(canRemoveRole(saved, { 'sec-waiting': 9 })).toBe(false);
    expect(canRemoveRole(saved, { 'sec-waiting': 1 })).toBe(false);
  });

  it('allows one nobody is on', () => {
    expect(canRemoveRole(role({ id: 'sec-waiting' }), { 'sec-waiting': 0 })).toBe(true);
    expect(canRemoveRole(role({ id: 'sec-waiting' }), {})).toBe(true);
  });

  it('always allows a section that was never saved', () => {
    expect(canRemoveRole(role({ id: null }), { 'sec-waiting': 9 })).toBe(true);
  });
});

describe('what an edit does to the people already booked (§3.5)', () => {
  const before = event({
    roles: [
      role({ key: 'chef', id: 'sec-chef', roleId: 'role-chef', start: '07:00', end: '15:00' }),
      role({ key: 'waiting', id: 'sec-waiting', start: '17:00', end: '23:30' }),
    ],
  });

  function after(patch: Partial<RoleDraft>, eventPatch: Partial<EventDraft> = {}) {
    return {
      ...before,
      ...eventPatch,
      roles: [before.roles[0]!, { ...before.roles[1]!, ...patch }],
    };
  }

  it('re-confirms only the role whose start moved', () => {
    const plan = reconfirmPlan(before, after({ start: '16:30' }));
    expect(plan.roles.map((r) => r.key)).toEqual(['waiting']);
    expect(plan.roles[0]!.reconfirming).toEqual(['starts_at']);
  });

  it('treats an end-time change the same as a start-time change', () => {
    expect(reconfirmPlan(before, after({ end: '00:30' })).roles[0]!.reconfirming).toEqual([
      'ends_at',
    ]);
  });

  it('re-confirms on a dress-code change, including a per-event override', () => {
    const changed = after({ dressCode: DRESS_CODE_OTHER, dressCodeOther: 'Black tie' });
    expect(reconfirmPlan(before, changed).roles[0]!.reconfirming).toEqual(['dress_code']);
    expect(effectiveDressCode(changed.roles[1]!)).toBe('Black tie');
  });

  it('applies headcount, buffer and charge rate silently', () => {
    const plan = reconfirmPlan(before, after({ headcount: 10, buffer: 3, chargeRate: 25 }));
    expect(plan.roles[0]!.changed).toEqual(['headcount', 'buffer', 'charge_rate']);
    expect(plan.roles[0]!.reconfirming).toEqual([]);
  });

  it('re-confirms every role when the date moves', () => {
    const plan = reconfirmPlan(before, after({}, { date: '2026-09-19' }));
    expect(plan.roles.map((r) => r.key).sort()).toEqual(['chef', 'waiting']);
    for (const change of plan.roles) expect(change.reconfirming).toContain('event_date');
  });

  it('asks nobody on a role added just now — nobody is booked on it yet', () => {
    const added = { ...before, roles: [...before.roles, role({ key: 'new', id: null })] };
    expect(reconfirmPlan(before, added).roles).toEqual([]);
  });

  it('reports a venue change separately, because it reaches everyone booked', () => {
    expect(reconfirmPlan(before, { ...before, venueId: 'venue-excel' }).venueChanged).toBe(true);
    expect(reconfirmPlan(before, before).venueChanged).toBe(false);
  });
});

describe('a saved event reopened, and Duplicate (§3.2)', () => {
  const saved: SavedEvent = {
    id: 'ev-gala',
    clientId: 'client-leonardo',
    venueId: 'venue-leonardo',
    title: 'Gala Dinner',
    date: DATE,
    poNumber: '4471-A',
    onsiteContact: 'Front desk',
    notes: 'Service lift at the rear',
    autoAssign: false,
    cancelledAt: null,
    sections: [
      {
        id: 'sec-chef',
        roleId: 'role-chef',
        start: '07:00',
        end: '15:00',
        headcount: 2,
        buffer: 0,
        chargeRate: 30.69,
        payRate: 19,
        dressCode: 'Chef whites',
        autoAssign: false,
        allocationPerHour: 3,
        confirmed: 2,
        booked: 2,
      },
      {
        id: 'sec-waiting',
        roleId: 'role-waiting',
        start: '17:00',
        end: '01:30',
        headcount: 12,
        buffer: 2,
        chargeRate: 22.97,
        payRate: 14,
        dressCode: 'Burgundy bow tie (supplied)',
        autoAssign: true,
        allocationPerHour: 14,
        confirmed: 9,
        booked: 13,
      },
    ],
  };
  const dressCodes = (roleId: string) =>
    roleId === 'role-chef' ? ['Chef whites'] : ['Black & whites'];

  it('edit keeps the section ids, the date and the switches as stored', () => {
    const draft = draftFromSaved(saved, dressCodes, 'edit');
    expect(draft.date).toBe(DATE);
    expect(draft.roles.map((r) => r.id)).toEqual(['sec-chef', 'sec-waiting']);
    expect(draft.autoAssign).toBe(false);
    expect(draft.roles.map((r) => r.autoAssign)).toEqual([false, true]);
    // The derived window pre-fills a new role: earliest start → latest end.
    expect([draft.overallStart, draft.overallEnd]).toEqual(['07:00', '01:30']);
  });

  it('duplicate copies the roles but no section id — so no staff come with it', () => {
    const draft = draftFromSaved(saved, dressCodes, 'duplicate');
    expect(draft.roles.every((r) => r.id === null)).toBe(true);
    expect(
      draft.roles.map((r) => [r.roleId, r.start, r.end, r.headcount, r.buffer, r.payRate]),
    ).toEqual([
      ['role-chef', '07:00', '15:00', 2, 0, 19],
      ['role-waiting', '17:00', '01:30', 12, 2, 14],
    ]);
    expect(draft.roles.map((r) => r.chargeRate)).toEqual([30.69, 22.97]);
    expect(draft.roles.map((r) => r.allocationPerHour)).toEqual([3, 14]);
    expect([draft.clientId, draft.venueId, draft.title, draft.poNumber]).toEqual([
      'client-leonardo',
      'venue-leonardo',
      'Gala Dinner',
      '4471-A',
    ]);
  });

  it('duplicate leaves the date empty, so it cannot be saved onto the same day by accident', () => {
    const draft = draftFromSaved(saved, dressCodes, 'duplicate');
    expect(draft.date).toBe('');
    expect(canSave(draft)).toBe(false);
    expect(canSave({ ...draft, date: '2026-10-02' })).toBe(true);
  });

  it('duplicate starts auto-assign ON at event and role level, the §3.4 default', () => {
    const draft = draftFromSaved(saved, dressCodes, 'duplicate');
    expect(draft.autoAssign).toBe(true);
    expect(draft.roles.every((r) => r.autoAssign)).toBe(true);
  });

  it('a dress code not on the client list reopens as this event’s "Other" text', () => {
    for (const as of ['edit', 'duplicate'] as const) {
      const [chef, waiting] = draftFromSaved(saved, dressCodes, as).roles;
      expect([chef!.dressCode, chef!.dressCodeOther]).toEqual(['Chef whites', '']);
      expect([waiting!.dressCode, waiting!.dressCodeOther]).toEqual([
        DRESS_CODE_OTHER,
        'Burgundy bow tie (supplied)',
      ]);
      expect(effectiveDressCode(waiting!)).toBe('Burgundy bow tie (supplied)');
    }
  });
});
