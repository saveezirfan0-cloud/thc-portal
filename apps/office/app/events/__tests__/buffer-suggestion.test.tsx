import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { type BufferSuggestionRule, DEFAULT_BUFFER_RULE } from '@thc/domain';
import { TimeFormatProvider } from '@thc/ui';

/**
 * ADR-0181 in the Shift Builder: a new role section's Buffer follows the
 * suggested overs — 1 for every 5 rounded up; under 5 none, unless the
 * section's OWN start is before 08:00, then 1 — as the headcount or the
 * section's start changes, until the manager types one. A saved buffer —
 * edited or duplicated — is never changed by the suggestion; it is at most
 * shown beside the field.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { RoleSection } = await import('../_components/RoleSection');
const { bufferSuggestionPatch, draftFromSaved, editRole, newRoleDraft, reconfirmPlan } =
  await import('../draft');
import type { EventDraft, RoleDraft } from '../draft';
import type { SavedEvent } from '../data';

const RULE: BufferSuggestionRule = { ...DEFAULT_BUFFER_RULE };
const DOWN: BufferSuggestionRule = { ...DEFAULT_BUFFER_RULE, rounding: 'down' };
const OFF: BufferSuggestionRule = { ...DEFAULT_BUFFER_RULE, enabled: false };

const DRAFT: EventDraft = {
  clientId: 'client-1',
  venueId: 'venue-1',
  title: 'Gala Dinner',
  date: '2026-11-21',
  overallStart: '17:00',
  overallEnd: '23:30',
  poNumber: '',
  onsiteContact: '',
  notes: '',
  autoAssign: true,
  requiredLanguages: ['English'],
  duplicateOf: null,
  roles: [],
};

const EARLY: EventDraft = { ...DRAFT, overallStart: '06:00', overallEnd: '14:00' };

const saved = (buffer: number, headcount = 12, start = '17:00'): SavedEvent => ({
  id: 'ev-1',
  clientId: 'client-1',
  venueId: 'venue-1',
  title: 'Gala Dinner',
  date: '2026-11-20',
  poNumber: '',
  onsiteContact: '',
  notes: '',
  autoAssign: true,
  requiredLanguages: ['English'],
  cancelledAt: null,
  seriesDays: [],
  sections: [
    {
      id: 'sec-waiting',
      roleId: 'role-waiting',
      start,
      end: '23:30',
      headcount,
      buffer,
      chargeRate: 22.97,
      payRate: 14,
      dressCode: '',
      autoAssign: true,
      requiredGender: null,
      sameStaffAllDays: false,
      allocationPerHour: headcount + buffer,
      confirmed: 0,
      booked: 0,
      held: 0,
    },
  ],
});

/** Types a sequence of edits into one section, as the builder does. */
function type(role: RoleDraft, rule: BufferSuggestionRule, ...patches: Partial<RoleDraft>[]) {
  return patches.reduce<RoleDraft>((current, patch) => editRole(current, patch, rule), role);
}

const fresh = (draft: EventDraft = DRAFT, rule: BufferSuggestionRule = RULE) =>
  newRoleDraft(draft, 'role-waiting', 0, rule);

describe('a new role section follows the suggestion', () => {
  it('starts at 0 for one person starting at 17:00', () => {
    const role = fresh();
    expect(role.headcount).toBe(1);
    expect(role.buffer).toBe(0);
    expect(role.bufferTouched).toBe(false);
    expect(role.allocationPerHour).toBe(1);
  });

  it('starts at 1 for one person when the window starts before 08:00', () => {
    const role = fresh(EARLY);
    expect(role.start).toBe('06:00');
    expect(role.buffer).toBe(1);
    expect(role.allocationPerHour).toBe(2);
  });

  it('moves with the headcount: 4 → 0, 5 → 1, 6 → 2, 7 → 2, 10 → 2, 11 → 3', () => {
    let role = fresh();
    const seen: number[] = [];
    for (const headcount of [4, 5, 6, 7, 10, 11, 3]) {
      role = editRole(role, { headcount }, RULE);
      seen.push(role.buffer);
    }
    expect(seen).toEqual([0, 1, 2, 2, 2, 3, 0]);
  });

  it('rounds down when the rule says so', () => {
    expect(type(fresh(DRAFT, DOWN), DOWN, { headcount: 7 }).buffer).toBe(1);
  });

  it('moves with the section’s OWN start: 4 staff get 1 once it starts before 08:00', () => {
    const role = type(fresh(), RULE, { headcount: 4 });
    expect(role.buffer).toBe(0);
    const early = type(role, RULE, { start: '07:30' });
    expect(early.buffer).toBe(1);
    expect(early.allocationPerHour).toBe(5);
    expect(type(early, RULE, { start: '08:00' }).buffer).toBe(0);
  });

  it('a half-typed start is not early', () => {
    expect(type(fresh(), RULE, { headcount: 4 }, { start: '' }).buffer).toBe(0);
  });

  it('the early extra is for small roles only', () => {
    expect(type(fresh(EARLY), RULE, { headcount: 5 }).buffer).toBe(1);
  });

  it('keeps allocation per hour on headcount + buffer as it moves', () => {
    const role = type(fresh(), RULE, { headcount: 11 });
    expect(role.buffer).toBe(3);
    expect(role.allocationPerHour).toBe(14);
  });

  it('reads a headcount being retyped (cleared to 0) as no extras, then picks up again', () => {
    const role = type(fresh(EARLY), RULE, { headcount: 10 }, { headcount: 0 }, { headcount: 15 });
    expect(role.buffer).toBe(3);
  });
});

describe('typing a buffer stops it following', () => {
  it('keeps the typed number however the headcount or the start moves', () => {
    const role = type(
      fresh(),
      RULE,
      { headcount: 10 },
      { buffer: 4 },
      { headcount: 20 },
      { headcount: 2, start: '06:00' },
    );
    expect(role.bufferTouched).toBe(true);
    expect(role.buffer).toBe(4);
    // Allocation still follows headcount + buffer: it was not typed.
    expect(role.allocationPerHour).toBe(6);
  });

  it('typing the same number as the suggestion still counts as the manager’s', () => {
    const role = type(fresh(), RULE, { headcount: 5 }, { buffer: 1 }, { headcount: 10 });
    expect(role.buffer).toBe(1);
  });

  it('a typed allocation still stops only the allocation', () => {
    const role = type(fresh(), RULE, { allocationPerHour: 3 }, { headcount: 10 });
    expect(role.buffer).toBe(2);
    expect(role.allocationPerHour).toBe(3);
  });
});

describe('"Use suggestion" brings it back', () => {
  it('hands a new section back to the suggestion, which follows again', () => {
    const typed = type(fresh(), RULE, { headcount: 10 }, { buffer: 5 });
    const patch = bufferSuggestionPatch(typed, RULE);
    expect(patch).toEqual({ bufferTouched: false });
    const restored = type(typed, RULE, patch!, { headcount: 15 });
    expect(restored.buffer).toBe(3);
    expect(restored.bufferTouched).toBe(false);
  });

  it('offers nothing while the buffer already is the suggestion', () => {
    expect(bufferSuggestionPatch(type(fresh(), RULE, { headcount: 10 }), RULE)).toBeNull();
  });

  it('offers nothing with the rule off', () => {
    const role = type(fresh(DRAFT, OFF), OFF, { buffer: 3 });
    expect(bufferSuggestionPatch(role, OFF)).toBeNull();
  });
});

describe('with the rule switched off, the builder is as it was', () => {
  it('starts at 0 and never follows, early or not', () => {
    const role = type(fresh(EARLY, OFF), OFF, { headcount: 20 });
    expect(role.buffer).toBe(0);
    expect(role.allocationPerHour).toBe(20);
  });

  it('and with no rule at all', () => {
    expect(editRole(newRoleDraft(DRAFT, 'role-waiting'), { headcount: 20 }).buffer).toBe(0);
  });
});

describe('a saved buffer is never changed by the suggestion', () => {
  const dressCodes = () => [];

  it('editing: the saved 0 on 12 staff stays 0 as the headcount or start moves', () => {
    const draft = draftFromSaved(saved(0), dressCodes, 'edit');
    const role = type(draft.roles[0]!, RULE, { headcount: 20 }, { start: '06:00' });
    expect(role.bufferTouched).toBe(true);
    expect(role.buffer).toBe(0);
  });

  it('editing: reopening it is not an edit — nobody is asked anything', () => {
    const before = draftFromSaved(saved(0), dressCodes, 'edit');
    expect(reconfirmPlan(before, before).roles).toEqual([]);
  });

  it('editing: "Use suggestion" only sets the number, and it stays put after', () => {
    const draft = draftFromSaved(saved(0), dressCodes, 'edit');
    const patch = bufferSuggestionPatch(draft.roles[0]!, RULE);
    expect(patch).toEqual({ buffer: 3 });
    const role = type(draft.roles[0]!, RULE, patch!, { headcount: 30 });
    expect(role.buffer).toBe(3);
    // A silent edit (§3.5): buffer, never a re-confirmation.
    const plan = reconfirmPlan(draft, { ...draft, roles: [role] });
    expect(plan.roles[0]!.changed).toContain('buffer');
    expect(plan.roles[0]!.reconfirming).toEqual([]);
  });

  it('duplicating keeps the copied buffer', () => {
    const draft = draftFromSaved(saved(4), dressCodes, 'duplicate');
    const role = type(draft.roles[0]!, RULE, { headcount: 30 });
    expect(role.id).toBeNull();
    expect(role.buffer).toBe(4);
  });

  it('a role ADDED to a saved event is new, and follows', () => {
    const draft = draftFromSaved(saved(0), dressCodes, 'edit');
    expect(type(newRoleDraft(draft, 'role-chef', 0, RULE), RULE, { headcount: 6 }).buffer).toBe(2);
  });
});

// ---------------------------------------------------------------------
// What the office sees under the Buffer field
// ---------------------------------------------------------------------

function section(
  role: RoleDraft,
  rule: BufferSuggestionRule | null,
  mode: 'new' | 'edit' = 'new',
  clock: '24h' | '12h' = '24h',
) {
  return renderToStaticMarkup(
    <TimeFormatProvider format={clock}>
      <RoleSection
        mode={mode}
        index={0}
        role={role}
        date="2026-11-21"
        issues={[]}
        roles={[{ id: 'role-waiting', name: 'Waiting Staff', payRate: 14 }]}
        client={undefined}
        confirmed={0}
        booked={0}
        held={0}
        changed={new Set()}
        original={undefined}
        locked={false}
        series={{ kind: 'single' }}
        ratesVisible
        bufferRule={rule}
        onChange={() => undefined}
        onRemove={() => undefined}
      />
    </TimeFormatProvider>,
  );
}

/** The Buffer field's hint, alone. */
function bufferHint(html: string): string {
  const field = /<div class="buffer-field">([^]*?)<\/div><div class="field">/.exec(html)?.[1];
  expect(field, 'the buffer field').toBeDefined();
  return /<span class="hint">([^<]*)<\/span>/.exec(field!)?.[1] ?? '';
}

describe('the Buffer hint', () => {
  it('names the suggestion and the rule, and keeps "absolute, not %" and the pair', () => {
    const html = section(type(fresh(), RULE, { headcount: 10 }), RULE);
    expect(bufferHint(html)).toBe(
      'Suggested: 2 (1 for every 5, rounded up) · absolute, not % · shown as 10 (+2)',
    );
    expect(html).not.toContain('Use suggestion');
  });

  it('says why a small role gets what it gets', () => {
    expect(bufferHint(section(type(fresh(), RULE, { headcount: 3 }), RULE))).toBe(
      'Suggested: 0 (under 5 staff) · absolute, not % · shown as 3 (+0)',
    );
    expect(bufferHint(section(type(fresh(EARLY), RULE, { headcount: 3 }), RULE))).toBe(
      'Suggested: 1 (under 5 staff, starts before 08:00) · absolute, not % · shown as 3 (+1)',
    );
  });

  it('writes the early start on the operator’s clock', () => {
    const html = section(type(fresh(EARLY), RULE, { headcount: 3 }), RULE, 'new', '12h');
    expect(bufferHint(html)).toContain('starts before 8:00 am');
  });

  it('offers "Use suggestion (N)" as its own button, outside the hint', () => {
    const html = section(type(fresh(), RULE, { headcount: 10 }, { buffer: 0 }), RULE);
    expect(bufferHint(html)).toBe(
      'Suggested: 2 (1 for every 5, rounded up) · absolute, not % · shown as 10 (+0)',
    );
    expect(html).toMatch(
      /<span class="hint">[^<]*<\/span><\/div><button type="button" class="linkish sm">Use suggestion \(2\)<\/button>/,
    );
  });

  it('on a saved section, shows the suggestion beside the saved number', () => {
    const draft = draftFromSaved(saved(0), () => [], 'edit');
    const html = section(draft.roles[0]!, RULE, 'edit');
    expect(bufferHint(html)).toBe(
      'Suggested: 3 (1 for every 5, rounded up) · absolute, not % · shown as 12 (+0)',
    );
    expect(html).toContain('Use suggestion (3)');
    expect(html).toMatch(/<input[^>]*value="0"/);
  });

  it('is the plain hint with the rule off or absent', () => {
    const role = fresh(DRAFT, OFF);
    expect(bufferHint(section(role, OFF))).toBe('absolute, not % · shown as 1 (+0)');
    expect(bufferHint(section(role, null))).toBe('absolute, not % · shown as 1 (+0)');
  });
});
