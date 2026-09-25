import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §3.4: "from the moment the event is created it adds allocation invites
 * every hour". The cron fires at :17, so the save itself posts the first
 * round through auto_assign_first_round() (20260928110200) — after the
 * sections exist, before the redirect, and never in a way that can fail
 * a save that has already happened.
 */
const state = vi.hoisted(() => ({
  calls: [] as string[],
  rpc: vi.fn(async (fn: string, _args: unknown) => {
    state.calls.push(`rpc:${fn}`);
    return { data: { queued: true } as Record<string, unknown>, error: null };
  }),
  sectionsError: null as null | { message: string },
}));

/** A stand-in for the PostgREST builder: every method chains, `await` resolves. */
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
          return chain({ data: { id: 'evt-1' }, error: null });
        case 'shift_requirements':
          return chain({ error: state.sectionsError });
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

const { createEvent } = await import('../actions');

const INPUT = {
  id: null,
  clientId: 'client-1',
  venueId: 'venue-1',
  title: 'Gala dinner',
  date: '2026-10-18',
  poNumber: '',
  onsiteContact: '',
  notes: '',
  autoAssign: true,
  roles: [
    {
      id: null,
      roleId: 'role-1',
      start: '17:00',
      end: '23:30',
      headcount: 12,
      buffer: 1,
      chargeRate: 22.97,
      payRate: 14,
      dressCode: '',
      autoAssign: true,
      allocationPerHour: 13,
    },
  ],
};

async function outcome(): Promise<string> {
  try {
    const result = await createEvent(INPUT);
    return `RETURNED:${JSON.stringify(result)}`;
  } catch (error) {
    return (error as Error).message;
  }
}

beforeEach(() => {
  state.calls.length = 0;
  state.sectionsError = null;
  state.rpc.mockClear();
});

describe('creating an event posts the first auto-assign round (§3.4)', () => {
  it('after the sections are saved and before the redirect', async () => {
    expect(await outcome()).toBe('REDIRECT:/events/evt-1');
    expect(state.rpc).toHaveBeenCalledWith('auto_assign_first_round', { p_event: 'evt-1' });
    const sections = state.calls.lastIndexOf('from:shift_requirements');
    const round = state.calls.indexOf('rpc:auto_assign_first_round');
    expect(sections).toBeGreaterThan(-1);
    expect(round).toBeGreaterThan(sections);
  });

  it('never when the sections failed — there is no event to fill', async () => {
    state.sectionsError = { message: 'min_4h' };
    expect(await outcome()).toBe('RETURNED:{"error":"min_4h"}');
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('and a failure of the round does not fail the save — the :17 round catches up', async () => {
    state.rpc.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    expect(await outcome()).toBe('REDIRECT:/events/evt-1');
  });

  it('or a refusal from it (auto-assign off is reported, not thrown)', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { queued: false, reason: 'nothing_due' },
      error: null,
    });
    expect(await outcome()).toBe('REDIRECT:/events/evt-1');
  });
});
