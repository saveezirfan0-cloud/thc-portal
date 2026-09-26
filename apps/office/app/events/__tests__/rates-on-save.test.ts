import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0061: what the Shift Builder's save sends about rates.
 *
 * No signed-in session may SELECT a rate column any more, so:
 *   · an office role without finance sends no rate at all — the database
 *     sets the catalogue rates on the section (shift_rates_office_guard);
 *   · an edit UPDATEs the stored sections and INSERTs the new ones instead
 *     of upserting: an upsert's `ON CONFLICT … SET pay_rate =
 *     EXCLUDED.pay_rate` reads the column and would be refused for every
 *     office role, managers included.
 */
const state = vi.hoisted(() => ({
  ops: [] as { table: string; method: string; args: unknown[] }[],
}));

/** A PostgREST builder stand-in that records every call and resolves to `result`. */
function recorder(table: string, result: unknown): unknown {
  const proxy: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => unknown) => resolve(result);
      }
      return (...args: unknown[]) => {
        state.ops.push({ table, method: String(prop), args });
        return proxy;
      };
    },
  });
  return proxy;
}

const STORED_SECTION = {
  id: 'sec-1',
  starts_at: '2026-10-18T16:00:00Z',
  ends_at: '2026-10-18T22:30:00Z',
  dress_code: null,
};

function fakeDb() {
  return {
    rpc: async () => ({ data: null, error: null }),
    from(table: string) {
      switch (table) {
        case 'clients':
          return recorder(table, { data: { pays_breaks: true, pays_buffer: true } });
        case 'venues':
          return recorder(table, {
            data: { name: 'V', address: 'A', location: '0101', geofence_radius_m: 150 },
          });
        case 'events':
          return recorder(table, {
            data: { id: 'evt-1', event_date: '2026-10-18', venue_address: 'A', cancelled_at: null },
            error: null,
          });
        case 'shift_requirements':
          return recorder(table, { data: [STORED_SECTION], error: null });
        case 'bookings':
          return recorder(table, { data: [], error: null });
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

const { createEvent, updateEvent } = await import('../actions');

function section(id: string | null, rates: { chargeRate: number | null; payRate: number | null }) {
  return {
    id,
    roleId: 'role-1',
    start: '17:00',
    end: '23:30',
    headcount: 12,
    buffer: 1,
    ...rates,
    dressCode: '',
    autoAssign: true,
    allocationPerHour: 13,
  };
}

function input(id: string | null, roles: ReturnType<typeof section>[]) {
  return {
    id,
    clientId: 'client-1',
    venueId: 'venue-1',
    title: 'Gala dinner',
    date: '2026-10-18',
    poNumber: '',
    onsiteContact: '',
    notes: '',
    autoAssign: true,
    roles,
  };
}

async function run(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!(error as Error).message.startsWith('REDIRECT:')) throw error;
  }
}

const sectionWrites = () =>
  state.ops.filter(
    (op) => op.table === 'shift_requirements' && ['insert', 'update', 'upsert'].includes(op.method),
  );

beforeEach(() => {
  state.ops.length = 0;
});

describe('saving role sections without reading a rate (ADR-0061)', () => {
  it('a scheduler’s new event sends no rate — the database sets the catalogue rates', async () => {
    await run(() => createEvent(input(null, [section(null, { chargeRate: null, payRate: null })])));
    const [write] = sectionWrites();
    expect(write?.method).toBe('insert');
    const rows = write?.args[0] as Record<string, unknown>[];
    expect(rows[0]).not.toHaveProperty('pay_rate');
    expect(rows[0]).not.toHaveProperty('charge_rate');
    expect(rows[0]).toMatchObject({ role_id: 'role-1', headcount: 12, buffer: 1 });
  });

  it('a manager’s new event sends the rates they set', async () => {
    await run(() => createEvent(input(null, [section(null, { chargeRate: 22.97, payRate: 14 })])));
    const rows = sectionWrites()[0]?.args[0] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ charge_rate: 22.97, pay_rate: 14 });
  });

  it('an edit updates the stored section and inserts the new one — never an upsert', async () => {
    await run(() =>
      updateEvent(
        input('evt-1', [
          section('sec-1', { chargeRate: 23.5, payRate: 14.5 }),
          section(null, { chargeRate: 22.97, payRate: 14 }),
        ]),
      ),
    );
    const writes = sectionWrites();
    expect(writes.map((w) => w.method)).toEqual(['update', 'insert']);
    expect(writes[0]?.args[0]).toMatchObject({ charge_rate: 23.5, pay_rate: 14.5 });
    expect(writes[0]?.args[0]).not.toHaveProperty('id');
    const scoped = state.ops.filter(
      (op) => op.table === 'shift_requirements' && op.method === 'eq',
    );
    expect(scoped.map((op) => op.args)).toContainEqual(['id', 'sec-1']);
    expect(scoped.map((op) => op.args)).toContainEqual(['event_id', 'evt-1']);
  });

  it('a scheduler’s edit leaves the stored rates alone by not sending them', async () => {
    await run(() =>
      updateEvent(input('evt-1', [section('sec-1', { chargeRate: null, payRate: null })])),
    );
    const [write] = sectionWrites();
    expect(write?.method).toBe('update');
    expect(write?.args[0]).not.toHaveProperty('pay_rate');
    expect(write?.args[0]).not.toHaveProperty('charge_rate');
  });
});
