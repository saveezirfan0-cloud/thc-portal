import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArrivalRow, EventArrivals } from '../arrivals';

/**
 * "11 of 13 arrived" (ADR-0038). Counts only, from `client_arrivals_v`, under
 * the caller's own session (ADR-0004). The loader must never break the page,
 * and the pill must never say more than two numbers.
 */
const state = vi.hoisted(() => ({
  configured: true,
  rows: [] as unknown[] | null,
  error: null as { message: string } | null,
  throws: false,
  calls: [] as {
    table: string;
    columns?: string;
    in?: [string, string[]];
    eq?: [string, unknown];
  }[],
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('../data', () => ({ supabaseConfigured: () => state.configured }));
vi.mock('@thc/db/server', () => ({
  createClient: () => {
    if (state.throws) throw new Error('boom');
    return {
      from: (table: string) => {
        const call: (typeof state.calls)[number] = { table };
        state.calls.push(call);
        const result = () => Promise.resolve({ data: state.rows, error: state.error });
        const chain = {
          select: (columns: string) => {
            call.columns = columns;
            return chain;
          },
          eq: (column: string, value: unknown) => {
            call.eq = [column, value];
            return chain;
          },
          in: (column: string, values: string[]) => {
            call.in = [column, values];
            return chain;
          },
          then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
            result().then(ok, bad),
        };
        return chain;
      },
    };
  },
}));

const { groupArrivals, loadArrivals } = await import('../arrivals');
const { Arrivals, arrivalsFor } = await import('../ArrivalsPill');

const EV = '70000000-0000-4000-8000-000000000001';
const EV2 = '70000000-0000-4000-8000-000000000002';
const S1 = '71000000-0000-4000-8000-000000000001';
const S2 = '71000000-0000-4000-8000-000000000002';
const S3 = '71000000-0000-4000-8000-000000000003';

const ROWS: ArrivalRow[] = [
  { shift_id: S1, event_id: EV, confirmed: 8, arrived: 7 },
  { shift_id: S2, event_id: EV, confirmed: 5, arrived: 4 },
  { shift_id: S3, event_id: EV2, confirmed: 2, arrived: 0 },
];

beforeEach(() => {
  state.configured = true;
  state.rows = ROWS;
  state.error = null;
  state.throws = false;
  state.calls = [];
});

describe('groupArrivals', () => {
  it('totals each event over its role sections and keeps the sections', () => {
    expect(groupArrivals(ROWS)).toEqual({
      [EV]: {
        confirmed: 13,
        arrived: 11,
        bySection: { [S1]: { confirmed: 8, arrived: 7 }, [S2]: { confirmed: 5, arrived: 4 } },
      },
      [EV2]: { confirmed: 2, arrived: 0, bySection: { [S3]: { confirmed: 2, arrived: 0 } } },
    });
  });

  it('never shows more arrived than confirmed, and reads junk as zero', () => {
    const out = groupArrivals([
      { shift_id: S1, event_id: EV, confirmed: 2, arrived: 5 },
      { shift_id: S2, event_id: EV, confirmed: '3', arrived: null },
      { shift_id: S3, event_id: EV, confirmed: -1, arrived: 'x' },
      null as unknown as ArrivalRow,
    ]);
    expect(out[EV]).toMatchObject({ confirmed: 5, arrived: 2 });
  });

  it('counts a section once even if it comes back twice', () => {
    const out = groupArrivals([ROWS[0]!, ROWS[0]!]);
    expect(out[EV]).toMatchObject({ confirmed: 8, arrived: 7 });
  });
});

describe('loadArrivals', () => {
  it('reads client_arrivals_v by its four named columns, and nothing else', async () => {
    const out = await loadArrivals();
    expect(out[EV]).toMatchObject({ confirmed: 13, arrived: 11 });
    expect(state.calls).toEqual([
      { table: 'client_arrivals_v', columns: 'shift_id, event_id, confirmed, arrived' },
    ]);
  });

  it('never reads a base table (ADR-0004)', async () => {
    await loadArrivals([EV]);
    const tables = state.calls.map((c) => c.table);
    for (const closed of ['bookings', 'check_logs', 'shift_requirements', 'roles', 'staff']) {
      expect(tables).not.toContain(closed);
    }
  });

  it('narrows to the given events, with no tenancy filter of its own', async () => {
    await loadArrivals([EV]);
    expect(state.calls[0]!.in).toEqual(['event_id', [EV]]);
    expect(state.calls[0]).not.toHaveProperty('eq');
  });

  it('asks for nothing when handed no events', async () => {
    expect(await loadArrivals([])).toEqual({});
    expect(state.calls).toEqual([]);
  });

  it('is an empty map, never an error, when Supabase is not configured', async () => {
    state.configured = false;
    expect(await loadArrivals()).toEqual({});
    expect(state.calls).toEqual([]);
  });

  it('is an empty map when the view errors', async () => {
    state.error = { message: 'permission denied for view client_arrivals_v' };
    expect(await loadArrivals()).toEqual({});
  });

  it('is an empty map when the client throws', async () => {
    state.throws = true;
    expect(await loadArrivals()).toEqual({});
  });

  it('is an empty map when the view returns no data at all', async () => {
    state.rows = null;
    expect(await loadArrivals()).toEqual({});
  });
});

describe('<Arrivals />', () => {
  const counts: EventArrivals = groupArrivals(ROWS)[EV]!;

  it('renders "11 of 13 arrived" as a green-dot pill', () => {
    const html = renderToStaticMarkup(<Arrivals counts={counts} />);
    expect(html).toContain('11 of 13 arrived');
    expect(html).toMatch(/class="pill green arrivals"/);
    expect(html).toContain('<i class="dot"></i>');
  });

  it('says two numbers and nothing else: no names, no times, no per-person labels', () => {
    const text = renderToStaticMarkup(<Arrivals counts={counts} />)
      .replace(/<[^>]+>/g, '')
      .trim();
    expect(text).toBe('11 of 13 arrived');
    expect(text).not.toMatch(/late|no-show|no show|:\d\d/i);
  });

  it('renders nothing without a row, or with nobody confirmed', () => {
    expect(renderToStaticMarkup(<Arrivals counts={undefined} />)).toBe('');
    expect(renderToStaticMarkup(<Arrivals counts={null} />)).toBe('');
    expect(
      renderToStaticMarkup(<Arrivals counts={{ confirmed: 0, arrived: 0, bySection: {} }} />),
    ).toBe('');
  });

  it('per role: counts only the named sections', () => {
    expect(renderToStaticMarkup(<Arrivals counts={counts} shiftIds={[S2]} />)).toContain(
      '4 of 5 arrived',
    );
    expect(arrivalsFor(counts, [S1, S2, S1])).toEqual({ confirmed: 13, arrived: 11 });
    // A section the view did not return (another event's, or none) shows nothing.
    expect(renderToStaticMarkup(<Arrivals counts={counts} shiftIds={[S3]} />)).toBe('');
    expect(renderToStaticMarkup(<Arrivals counts={counts} shiftIds={[]} />)).toBe('');
  });

  it("per role: nothing before that role's own start (RULE-18), shown from it", () => {
    const startsAt = '2026-09-25T16:00:00Z';
    const before = renderToStaticMarkup(
      <Arrivals counts={counts} shiftIds={[S2]} startsAt={startsAt} now="2026-09-25T15:59:59Z" />,
    );
    const at = renderToStaticMarkup(
      <Arrivals counts={counts} shiftIds={[S2]} startsAt={startsAt} now={new Date(startsAt)} />,
    );
    expect(before).toBe('');
    expect(at).toContain('4 of 5 arrived');
  });

  it('passes size and class through', () => {
    const html = renderToStaticMarkup(<Arrivals counts={counts} large className="sm" />);
    expect(html).toMatch(/class="pill green lg arrivals sm"/);
  });
});
