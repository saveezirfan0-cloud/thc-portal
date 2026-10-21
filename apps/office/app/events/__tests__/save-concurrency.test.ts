import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Saving an edited event (§3.2, §3.5) made one UPDATE per stored section and
 * one flag-and-queue per section whose time, dress code or venue changed,
 * strictly one after another (go-live audit M5). They now run up to eight at
 * a time (`_lib/pool.ts`), each still refused or done on its own:
 *
 *   · the first refused UPDATE is the one the manager reads, in the
 *     builder's order, and nothing new starts after it;
 *   · every changed section is flagged and queued, whatever another
 *     section's queueing did.
 */
const state = vi.hoisted(() => ({
  inFlight: 0,
  peak: 0,
  updates: [] as string[],
  flagged: [] as string[],
  queued: 0,
  refuse: new Set<string>(),
  queueFails: new Set<string>(),
}));

const SECTIONS = Array.from({ length: 12 }, (_, n) => ({
  id: `sec-${n}`,
  starts_at: '2026-10-18T16:00:00Z',
  ends_at: '2026-10-18T22:30:00Z',
  dress_code: null,
}));

/** A builder that records its filters and resolves, a moment later, to `answer()`. */
function builder(table: string, answer: (eqs: [string, unknown][], op: string) => unknown) {
  const eqs: [string, unknown][] = [];
  let op = 'select';
  const proxy: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => unknown) => {
          state.inFlight += 1;
          state.peak = Math.max(state.peak, state.inFlight);
          setTimeout(() => {
            state.inFlight -= 1;
            resolve(answer(eqs, op));
          }, 2);
        };
      }
      return (...args: unknown[]) => {
        if (prop === 'eq') eqs.push([args[0] as string, args[1]]);
        if (prop === 'update' || prop === 'insert' || prop === 'delete') op = String(prop);
        return proxy;
      };
    },
  });
  void table;
  return proxy;
}

function fakeDb() {
  return {
    rpc: async (_fn: string, args: { p_rows: { booking_id?: string }[] }) => {
      state.queued += 1;
      const shift = JSON.stringify(args.p_rows);
      const failed = [...state.queueFails].some((id) => shift.includes(`b-${id}`));
      return { data: null, error: failed ? { message: 'queue down' } : null };
    },
    from(table: string) {
      switch (table) {
        case 'venues':
          return builder(table, () => ({
            data: { name: 'V', address: 'A', location: '0101', geofence_radius_m: 150 },
          }));
        case 'events':
          return builder(table, () => ({
            data: { event_date: '2026-10-18', venue_address: 'A', cancelled_at: null },
            error: null,
          }));
        case 'shift_requirements':
          return builder(table, (eqs, op) => {
            if (op !== 'update') return { data: SECTIONS, error: null };
            const id = eqs.find(([column]) => column === 'id')![1] as string;
            state.updates.push(id);
            return {
              data: null,
              error: state.refuse.has(id) ? { code: '23514', message: 'check' } : null,
            };
          });
        case 'bookings':
          return builder(table, (eqs, op) => {
            if (op !== 'update') return { data: [], error: null };
            const shift = eqs.find(([column]) => column === 'shift_id')![1] as string;
            state.flagged.push(shift);
            return { data: [{ id: `b-${shift}`, staff_id: `w-${shift}` }], error: null };
          });
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
vi.mock('../db', () => ({ eventsDb: () => fakeDb(), supabaseConfigured: () => true }));

const { updateEvent } = await import('../actions');

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T09:00:00Z'));
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  state.inFlight = 0;
  state.peak = 0;
  state.updates.length = 0;
  state.flagged.length = 0;
  state.queued = 0;
  state.refuse.clear();
  state.queueFails.clear();
});

/** Every stored section, its end moved from 23:30 to `end`. */
function edit(end = '23:30') {
  return {
    id: 'evt-1',
    clientId: 'client-1',
    venueId: 'venue-1',
    title: 'Gala dinner',
    date: '2026-10-18',
    poNumber: '',
    onsiteContact: '',
    notes: '',
    autoAssign: true,
    requiredLanguages: ['English'],
    securityCleared: false,
    roles: SECTIONS.map((s) => ({
      id: s.id,
      roleId: 'role-1',
      start: '17:00',
      end,
      headcount: 4,
      buffer: 0,
      chargeRate: null,
      payRate: null,
      dressCode: '',
      autoAssign: true,
      requiredGender: null,
      sameStaffAllDays: false,
      allocationPerHour: 8,
    })),
  };
}

async function save(input: ReturnType<typeof edit>): Promise<unknown> {
  try {
    return await updateEvent(input);
  } catch (error) {
    if ((error as Error).message.startsWith('REDIRECT:')) return 'saved';
    throw error;
  }
}

describe('saving an edited event', () => {
  it('updates its sections several at a time, never more than eight', async () => {
    expect(await save(edit())).toBe('saved');
    expect([...state.updates].sort()).toEqual(SECTIONS.map((s) => s.id).sort());
    expect(state.peak).toBeGreaterThan(1);
    expect(state.peak).toBeLessThanOrEqual(8);
  });

  it('reports the first refusal and starts nothing after it', async () => {
    state.refuse.add('sec-2');
    const result = await save(edit());
    expect(result).toEqual({ error: expect.any(String) });
    // The eight already in flight finish; the rest never start.
    expect(state.updates.length).toBeLessThan(SECTIONS.length);
  });

  it('flags and queues every moved section, even when one queueing fails', async () => {
    state.queueFails.add('sec-5');
    // 23:00 UK instead of 23:30: every section's end moved, so each is re-asked.
    expect(await save(edit('23:00'))).toBe('saved');
    expect([...state.flagged].sort()).toEqual(SECTIONS.map((s) => s.id).sort());
    expect(state.queued).toBe(SECTIONS.length);
  });
});
