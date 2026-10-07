import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));

const rpc = vi.fn();
const from = vi.fn();
vi.mock('../db', () => ({
  eventsDb: () => ({ rpc, from }),
  supabaseConfigured: () => true,
}));

const { isMissingFunction, loadClientFilterOptions, loadEventsInRange } = await import('../data');

/** A query builder that answers any chain of calls with one result. */
function table(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const chain: Record<string, unknown> = {};
  const self = new Proxy(chain, {
    get: (_target, prop) =>
      prop === 'then' ? (resolve: (value: unknown) => void) => resolve(result) : () => self,
  });
  return self;
}

const row = {
  id: 'e1',
  title: 'Gala',
  event_date: '2026-10-07',
  venue_name: 'Hall',
  venue_address: '1 High St',
  po_number: null,
  cancelled_at: null,
  cancel_reason: null,
  client_id: 'c1',
  client_name: 'Client One',
  sections: [
    {
      role_name: 'Waiting Staff',
      // 06:00Z is 07:00 in London on 7 Oct (BST).
      starts_at: '2026-10-07T06:00:00+00:00',
      ends_at: '2026-10-07T14:30:00+00:00',
      headcount: 6,
      buffer: 1,
      confirmed: 4,
    },
  ],
};

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe('loadEventsInRange — one call (ADR-0103)', () => {
  it('asks the database for the period once and reads nothing else', async () => {
    rpc.mockResolvedValue({ data: [row], error: null });

    await loadEventsInRange('2026-10-01', '2026-10-31');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('office_events_in_range', {
      p_from: '2026-10-01',
      p_to: '2026-10-31',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('maps the rows to what the list and calendar draw, in UK time', async () => {
    rpc.mockResolvedValue({ data: [row], error: null });

    const { events, problem } = await loadEventsInRange('2026-10-07', '2026-10-07');

    expect(problem).toBeNull();
    expect(events).toEqual([
      {
        id: 'e1',
        title: 'Gala',
        date: '2026-10-07',
        clientId: 'c1',
        clientName: 'Client One',
        venueName: 'Hall',
        venueAddress: '1 High St',
        poNumber: '',
        cancelledAt: null,
        cancelReason: '',
        roles: [
          {
            roleName: 'Waiting Staff',
            start: '07:00',
            end: '15:30',
            headcount: 6,
            buffer: 1,
            confirmed: 4,
          },
        ],
      },
    ]);
  });

  it('keeps the placeholders the old read used for a missing client or role', async () => {
    rpc.mockResolvedValue({
      data: [{ ...row, client_name: null, sections: [{ ...row.sections[0]!, role_name: null }] }],
      error: null,
    });

    const { events } = await loadEventsInRange('2026-10-07', '2026-10-07');

    expect(events[0]!.clientName).toBe('Client');
    expect(events[0]!.roles[0]!.roleName).toBe('Role');
  });

  it('reads an empty period as no events, not as a problem', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await loadEventsInRange('1990-01-01', '1990-01-02')).toEqual({
      events: [],
      problem: null,
    });
  });

  it('says a real failure out loud and does not fall back over it', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });

    const result = await loadEventsInRange('2026-10-01', '2026-10-31');

    expect(result).toEqual({
      events: [],
      problem: 'Events could not be loaded: permission denied',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('falls back to the step-by-step read only when the function is not there yet', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });
    from.mockReturnValue(table({ data: [], error: null }));

    const result = await loadEventsInRange('2026-10-01', '2026-10-31');

    expect(from).toHaveBeenCalledWith('events');
    expect(result).toEqual({ events: [], problem: null });
  });
});

describe('isMissingFunction', () => {
  it('is true for the two ways a database reports a function that is not there', () => {
    expect(isMissingFunction({ code: 'PGRST202' })).toBe(true);
    expect(isMissingFunction({ code: '42883' })).toBe(true);
  });

  it('is false for anything else, so a real error is never hidden', () => {
    expect(isMissingFunction({ code: '42501' })).toBe(false);
    expect(isMissingFunction({})).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
    expect(isMissingFunction(undefined)).toBe(false);
  });
});

describe('loadClientFilterOptions', () => {
  it('reads the id and name of each client and nothing else', async () => {
    const select = vi.fn().mockReturnValue({
      order: () => Promise.resolve({ data: [{ id: 'c1', name: 'A' }], error: null }),
    });
    from.mockReturnValue({ select });

    expect(await loadClientFilterOptions()).toEqual({ clients: [{ id: 'c1', name: 'A' }] });
    expect(from).toHaveBeenCalledWith('clients');
    expect(select).toHaveBeenCalledWith('id, name');
  });

  it('reports a failed read instead of drawing a filter with no clients', async () => {
    from.mockReturnValue({
      select: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }),
    });

    expect(await loadClientFilterOptions()).toEqual({
      clients: [],
      unavailable: 'Clients could not be loaded: boom',
    });
  });
});
