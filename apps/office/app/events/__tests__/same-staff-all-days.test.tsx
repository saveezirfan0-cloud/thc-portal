import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeFormatProvider } from '@thc/ui';

/**
 * ADR-0116 in the Shift Builder: the per-role "Same staff on all days"
 * switch, what Duplicate carries, that the flag is a silent edit, and that
 * saving a Duplicate links the days (`link_event_series`) BEFORE the sections
 * and the first auto-assign round.
 */
const state = vi.hoisted(() => ({
  calls: [] as string[],
  linkError: null as null | { message: string },
  /** Does the source event have a "Same staff on all days" section? */
  sourceFlagged: true,
  sourceReadError: null as null | { message: string },
  rpc: vi.fn(async (fn: string, _args: unknown) => {
    state.calls.push(`rpc:${fn}`);
    if (fn === 'link_event_series') return { data: null, error: state.linkError };
    return { data: { queued: true } as Record<string, unknown>, error: null };
  }),
  sectionRows: [] as Record<string, unknown>[],
}));

function chain(result: unknown): unknown {
  const proxy: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => unknown) => resolve(result);
      }
      return () => proxy;
    },
  });
  return proxy;
}

function fakeDb() {
  return {
    rpc: state.rpc,
    from(table: string) {
      state.calls.push(`from:${table}`);
      switch (table) {
        case 'clients':
          return chain({ data: { pays_breaks: true, pays_buffer: true } });
        case 'venues':
          return chain({
            data: { name: 'V', address: 'A', location: '0101', geofence_radius_m: 150 },
          });
        case 'events':
          return chain({ data: { id: 'evt-new' }, error: null });
        case 'shift_requirements': {
          const rows = state.sectionRows;
          return new Proxy(function () {}, {
            get(_t, prop) {
              if (prop === 'then') {
                return (resolve: (value: unknown) => unknown) => resolve({ error: null });
              }
              if (prop === 'select') {
                return () =>
                  chain({
                    data: state.sourceFlagged ? [{ id: 'sec-flagged' }] : [],
                    error: state.sourceReadError,
                  });
              }
              if (prop === 'insert') {
                return (value: Record<string, unknown>[]) => {
                  state.calls.push('insert:shift_requirements');
                  rows.push(...value);
                  return chain({ error: null });
                };
              }
              return () => chain({ error: null });
            },
          });
        }
        default:
          throw new Error(`unexpected table ${table}`);
      }
    },
  };
}

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('../db', () => ({
  eventsDb: () => fakeDb(),
  supabaseConfigured: () => true,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { createEvent } = await import('../actions');
const { RoleSection, sameStaffHint } = await import('../_components/RoleSection');
const { draftFromSaved, newRoleDraft, reconfirmPlan, roleChanges, seriesContextFor, editRole } =
  await import('../draft');
import type { EventDraft } from '../draft';
import type { SavedEvent } from '../data';

const DRAFT: EventDraft = {
  clientId: 'client-1',
  venueId: 'venue-1',
  title: 'Tobacco Dock',
  date: '2026-11-21',
  overallStart: '09:00',
  overallEnd: '17:00',
  poNumber: '',
  onsiteContact: '',
  notes: '',
  autoAssign: true,
  requiredLanguages: ['English'],
  duplicateOf: null,
  roles: [],
};

const saved = (over: Partial<SavedEvent> = {}): SavedEvent => ({
  id: 'ev-fri',
  clientId: 'client-1',
  venueId: 'venue-1',
  title: 'Tobacco Dock',
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
      id: 'sec-bar',
      roleId: 'role-bar',
      start: '09:00',
      end: '17:00',
      headcount: 6,
      buffer: 1,
      chargeRate: 20,
      payRate: 12,
      dressCode: '',
      autoAssign: true,
      requiredGender: null,
      sameStaffAllDays: true,
      allocationPerHour: 7,
      confirmed: 0,
      booked: 0,
    },
  ],
  ...over,
});

describe('the draft', () => {
  it('a new role section does not ask for the same staff', () => {
    expect(newRoleDraft(DRAFT, 'role-bar').sameStaffAllDays).toBe(false);
  });

  it('Duplicate keeps the requirement on the clone — it is the client’s ask, not the day’s — and remembers its source', () => {
    const draft = draftFromSaved(saved(), () => [], 'duplicate');
    expect(draft.roles.map((r) => r.sameStaffAllDays)).toEqual([true]);
    expect(draft.roles.every((r) => r.id === null)).toBe(true);
    expect(draft.duplicateOf).toBe('ev-fri');
  });

  it('reopening a saved event keeps the stored flag and is not a duplicate', () => {
    const draft = draftFromSaved(saved(), () => [], 'edit');
    expect(draft.roles.map((r) => r.sameStaffAllDays)).toEqual([true]);
    expect(draft.duplicateOf).toBeNull();
  });

  it('switching it is a silent edit: nobody booked is re-asked (§3.5)', () => {
    const before = draftFromSaved(saved(), () => [], 'edit');
    const after = {
      ...before,
      roles: before.roles.map((r) => editRole(r, { sameStaffAllDays: false })),
    };
    const plan = reconfirmPlan(before, after);
    expect(plan.roles).toHaveLength(1);
    expect(plan.roles[0]!.changed).toEqual(['same_staff_all_days']);
    expect(plan.roles[0]!.reconfirming).toEqual([]);
    expect(roleChanges(before.roles[0]!, before.roles[0]!, false).changed).toEqual([]);
  });

  it('knows where the event sits in its job', () => {
    expect(seriesContextFor({ duplicateOf: null }, null)).toEqual({ kind: 'single' });
    expect(seriesContextFor({ duplicateOf: 'ev-fri' }, null)).toEqual({ kind: 'duplicate' });
    const days = [
      { eventId: 'ev-fri', date: '2026-11-20', cancelled: false },
      { eventId: 'ev-sat', date: '2026-11-21', cancelled: false },
      { eventId: 'ev-sun', date: '2026-11-22', cancelled: false },
    ];
    expect(seriesContextFor({ duplicateOf: null }, { id: 'ev-sat', seriesDays: days })).toEqual({
      kind: 'series',
      day: 2,
      of: 3,
    });
    expect(seriesContextFor({ duplicateOf: null }, { id: 'ev-fri', seriesDays: [] })).toEqual({
      kind: 'single',
    });
  });
});

describe('the switch on a role section', () => {
  const role = { ...newRoleDraft(DRAFT, 'role-bar'), id: 'sec-bar' };
  const render = (over: Partial<Parameters<typeof RoleSection>[0]> = {}) =>
    renderToStaticMarkup(
      <TimeFormatProvider format="24h">
        <RoleSection
          mode="edit"
          index={0}
          role={role}
          date={DRAFT.date}
          issues={[]}
          roles={[{ id: 'role-bar', name: 'Bar Staff', payRate: 12 }]}
          client={undefined}
          confirmed={0}
          booked={0}
          changed={new Set()}
          original={role}
          locked={false}
          series={{ kind: 'single' }}
          ratesVisible
          onChange={() => {}}
          onRemove={() => {}}
          {...over}
        />
      </TimeFormatProvider>,
    );

  it('is a plain switch (violet is Auto-Assign’s) labelled “Same staff on all days”, off by default', () => {
    const html = render();
    expect(html).toContain('Same staff on all days');
    expect(html).toMatch(/<label class="switch">[\s\S]*Same staff on all days/);
    expect(html).not.toContain('<label class="switch on">');
  });

  it('shows the requirement in the section header once it is on', () => {
    const html = render({ role: { ...role, sameStaffAllDays: true } });
    expect(html).toMatch(/<label class="switch on">[\s\S]*Same staff on all days/);
    // The header chip, alongside headcount and gender.
    expect(html).toContain('class="pill cyan"');
  });

  it('says on a locked (started) event that the requirement applies', () => {
    const html = render({ locked: true, role: { ...role, sameStaffAllDays: true } });
    expect(html).toContain('Same staff on all days');
    expect(html).toContain('Ongoing');
  });

  it('warns that already booked staff are not removed when it is switched on', () => {
    const html = render({
      booked: 3,
      changed: new Set(['same_staff_all_days']),
      role: { ...role, sameStaffAllDays: true },
    });
    expect(html).toContain('Already booked staff are not removed or re-asked');
    expect(render({ booked: 3 })).not.toContain('Already booked staff are not removed or re-asked');
  });

  it('explains itself according to where the event sits in its job', () => {
    expect(sameStaffHint(false, { kind: 'single' }, 'Bar Staff')).toMatch(
      /switch it on, save, then Duplicate to add the next day/,
    );
    expect(sameStaffHint(true, { kind: 'series', day: 2, of: 3 }, 'Bar Staff')).toBe(
      'Day 2 of 3: only people free for every other day of this job where Bar Staff also asks for the same staff are invited',
    );
    expect(sameStaffHint(true, { kind: 'duplicate' }, 'Bar Staff')).toMatch(
      /links this to the original as another day of one job if the original has this on/,
    );
    expect(sameStaffHint(true, { kind: 'single' }, 'Bar Staff')).toMatch(
      /Switch it on, save, then Duplicate this event to add the next day/,
    );
  });
});

describe('saving a Duplicate (createEvent)', () => {
  const input = (duplicateOf: string | null, same = true) => ({
    id: null,
    clientId: 'client-1',
    venueId: 'venue-1',
    title: 'Tobacco Dock',
    date: '2026-11-21',
    poNumber: '',
    onsiteContact: '',
    notes: '',
    autoAssign: true,
    requiredLanguages: ['English'],
    duplicateOf,
    roles: [
      {
        id: null,
        roleId: 'role-bar',
        start: '09:00',
        end: '17:00',
        headcount: 6,
        buffer: 1,
        chargeRate: 20,
        payRate: 12,
        dressCode: '',
        autoAssign: true,
        requiredGender: null,
        sameStaffAllDays: same,
        allocationPerHour: 7,
      },
    ],
  });

  async function outcome(value: ReturnType<typeof input>): Promise<string> {
    try {
      return `RETURNED:${JSON.stringify(await createEvent(value))}`;
    } catch (error) {
      return (error as Error).message;
    }
  }

  beforeEach(() => {
    state.calls.length = 0;
    state.linkError = null;
    state.sourceFlagged = true;
    state.sourceReadError = null;
    state.sectionRows.length = 0;
    state.rpc.mockClear();
  });

  it('writes the flag on the section', async () => {
    await outcome(input(null));
    expect(state.sectionRows[0]).toMatchObject({ same_staff_all_days: true });
    await outcome(input(null, false));
    expect(state.sectionRows[1]).toMatchObject({ same_staff_all_days: false });
  });

  it('links the clone to its source before the sections and before the first round', async () => {
    expect(await outcome(input('ev-fri'))).toBe('REDIRECT:/events/evt-new');
    expect(state.rpc).toHaveBeenCalledWith('link_event_series', {
      p_source: 'ev-fri',
      p_clone: 'evt-new',
    });
    expect(state.calls.indexOf('rpc:link_event_series')).toBeGreaterThan(-1);
    expect(state.calls.indexOf('rpc:link_event_series')).toBeLessThan(
      state.calls.indexOf('insert:shift_requirements'),
    );
    expect(state.calls.indexOf('insert:shift_requirements')).toBeLessThan(
      state.calls.indexOf('rpc:auto_assign_first_round'),
    );
  });

  it('a plain new event links nothing', async () => {
    await outcome(input(null));
    expect(state.calls).not.toContain('rpc:link_event_series');
  });

  it('a Duplicate of an event with no "Same staff on all days" role is only a copy: no series', async () => {
    state.sourceFlagged = false;
    expect(await outcome(input('ev-fri', false))).toBe('REDIRECT:/events/evt-new');
    expect(state.calls).not.toContain('rpc:link_event_series');
    expect(state.calls).toContain('insert:shift_requirements');
  });

  it('rolls the new event back when the original cannot be read', async () => {
    state.sourceReadError = { message: 'boom' };
    const result = await outcome(input('ev-fri'));
    expect(result).toContain('The original event could not be read');
    expect(state.calls).not.toContain('insert:shift_requirements');
    expect(state.calls).not.toContain('rpc:link_event_series');
  });

  it('rolls the new event back when the days cannot be linked — no half-built series', async () => {
    state.linkError = { message: 'event_not_found' };
    const result = await outcome(input('ev-gone'));
    expect(result).toContain('The days of this job could not be linked');
    expect(state.calls).toContain('from:events');
    expect(state.calls).not.toContain('insert:shift_requirements');
    expect(state.calls).not.toContain('rpc:auto_assign_first_round');
  });

  it('duplicating into another client is only a copy of the roles: it saves, unlinked', async () => {
    state.linkError = { message: 'series_other_client' };
    expect(await outcome(input('ev-fri'))).toBe('REDIRECT:/events/evt-new');
    expect(state.calls).toContain('insert:shift_requirements');
  });
});
