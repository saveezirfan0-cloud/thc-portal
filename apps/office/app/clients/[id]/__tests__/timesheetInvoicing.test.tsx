import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimesheetSettingsInput } from '../timesheetInvoicing';
import type { TimesheetInvoicingSettings, TimesheetRateRow } from '../types';

/**
 * ADR-0210: the client card's Timesheet invoicing panel and its rate card.
 * The settings are saved through `set_client_timesheet_invoicing()`, the
 * rates written to `timesheet_rates` under its finance + write policy, and
 * the database's refusals reach the manager as sentences.
 */

type Err = { code?: string; message: string; details?: string | null };
const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
  error: null as Err | null,
}));
const revalidatePath = vi.fn();

// from('timesheet_rates') builder, recording the last call
const table = vi.hoisted(() => ({
  calls: [] as { op: string; row?: Record<string, unknown>; eq: [string, string][] }[],
  reply: {
    data: [{ id: 'r-1' }] as unknown[] | null,
    error: null as null | { code?: string; message: string },
  },
}));
function builder(op: string, row?: Record<string, unknown>) {
  const call = { op, row, eq: [] as [string, string][] };
  table.calls.push(call);
  const chain = {
    eq(column: string, value: string) {
      call.eq.push([column, value]);
      return chain;
    },
    select: () => Promise.resolve(table.reply),
  };
  return chain;
}

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    rpc,
    from: () => ({
      insert: (row: Record<string, unknown>) => builder('insert', row),
      update: (row: Record<string, unknown>) => builder('update', row),
      delete: () => builder('delete'),
    }),
  }),
}));

const actions = await import('../timesheetActions');
const rules = await import('../timesheetInvoicing');
const { TimesheetInvoicing } = await import('../TimesheetInvoicing');

const CLIENT = '22222222-2222-4222-8222-222222222222';
const RATE = '33333333-3333-4333-8333-333333333333';

const settings: TimesheetInvoicingSettings = {
  mode: 'timesheet',
  format: 'named',
  displayName: 'Taster UK SBX (Liverpool)',
  venue: 'Liverpool ONE',
  venueAddress: '1 Chavasse Park\nLiverpool',
  dateLabel: 'W/C Date',
  omitEventDates: true,
  defaultRole: 'Service Staff',
  excludedStaff: ['Jane Doe'],
  poRequired: true,
  paymentTermsDays: 30,
  xeroContactId: null,
};
const rates: TimesheetRateRow[] = [
  { id: 'r-1', role_name: 'Service Staff', aliases: [], charge_rate: 17.77 },
  { id: 'r-2', role_name: 'Shift Leader', aliases: ['Shift Lead'], charge_rate: 19.52 },
];

const input = (over: Partial<TimesheetSettingsInput> = {}) => ({
  mode: 'timesheet' as const,
  format: 'named' as const,
  displayName: ' Taster ',
  venue: '',
  venueAddress: '',
  dateLabel: 'W/C Date',
  omitEventDates: true,
  defaultRole: 'Service Staff',
  excludedStaff: [' Jane Doe ', 'jane doe', ''],
  poRequired: true,
  paymentTermsDays: 30,
  ...over,
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  rpc.mockClear();
  revalidatePath.mockClear();
  table.calls.length = 0;
  table.reply = { data: [{ id: 'r-1' }], error: null };
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('the rules', () => {
  it('trims and de-duplicates names ignoring case', () => {
    expect(rules.normaliseList([' Jane  Doe ', 'jane doe', '', 'Bob'])).toEqual([
      'Jane Doe',
      'Bob',
    ]);
    expect(rules.splitList('KP, Kitchen Porter ; kp\nTeam Lead')).toEqual([
      'KP',
      'Kitchen Porter',
      'Team Lead',
    ]);
  });

  it('reads payment terms: blank is the default, 0 to 120 whole days', () => {
    expect(rules.parseTerms('')).toBeNull();
    expect(rules.parseTerms(' 30 ')).toBe(30);
    expect(rules.parseTerms('0')).toBe(0);
    expect(rules.parseTerms('120')).toBe(120);
    expect(rules.parseTerms('121')).toBe('invalid');
    expect(rules.parseTerms('-1')).toBe('invalid');
    expect(rules.parseTerms('2.5')).toBe('invalid');
    expect(rules.parseTerms('abc')).toBe('invalid');
  });

  it('refuses terms out of range, an unknown mode, and a too-long field', () => {
    expect(rules.settingsProblem(input())).toBeNull();
    expect(rules.settingsProblem(input({ paymentTermsDays: 121 }))).toMatch(/0 to 120/);
    expect(rules.settingsProblem(input({ paymentTermsDays: 1.5 }))).toMatch(/whole number/);
    expect(rules.settingsProblem(input({ mode: 'both' as never }))).toMatch(
      /how this client is invoiced/,
    );
    expect(rules.settingsProblem(input({ dateLabel: 'x'.repeat(41) }))).toMatch(/at most 40/);
    expect(rules.settingsProblem(input({ paymentTermsDays: null }))).toBeNull();
  });

  it('reads a rate in pounds and pence', () => {
    expect(rules.parseRate('18.98')).toBe(18.98);
    expect(rules.parseRate('£19')).toBe(19);
    expect(rules.parseRate('18.985')).toBeNull();
    expect(rules.parseRate('-1')).toBeNull();
    expect(rules.parseRate('')).toBeNull();
  });

  it('checks a rate row, and drops an alias that repeats the role', () => {
    expect(rules.rateProblem({ roleName: 'KP', aliases: [], chargeRate: 17.77 })).toBeNull();
    expect(rules.rateProblem({ roleName: ' ', aliases: [], chargeRate: 1 })).toMatch(
      /Name the role/,
    );
    expect(rules.rateProblem({ roleName: 'KP', aliases: [], chargeRate: -1 })).toMatch(/negative/);
    expect(rules.rateProblem({ roleName: 'KP', aliases: [], chargeRate: 1.234 })).toMatch(/pence/);
    expect(rules.rateProblem({ roleName: 'KP', aliases: [], chargeRate: 1_000_000 })).toMatch(
      /too large/,
    );
    expect(rules.cleanAliases('Waiting', ['waiting', 'Waiting Staff', 'waiting staff'])).toEqual([
      'Waiting Staff',
    ]);
  });

  it('warns when the default role is not on the rate card (by name or alias)', () => {
    expect(rules.defaultRoleOnCard('shift lead', rates)).toBe(true);
    expect(rules.defaultRoleOnCard('Service Staff', rates)).toBe(true);
    expect(rules.defaultRoleOnCard('Chef', rates)).toBe(false);
    expect(rules.defaultRoleOnCard('', rates)).toBe(true);
  });
});

describe('saveTimesheetInvoicing', () => {
  it('calls set_client_timesheet_invoicing with the cleaned settings', async () => {
    expect(await actions.saveTimesheetInvoicing(CLIENT, input())).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('set_client_timesheet_invoicing', {
      p_client: CLIENT,
      p_mode: 'timesheet',
      p_format: 'named',
      p_display_name: 'Taster',
      p_venue: null,
      p_venue_address: null,
      p_date_label: 'W/C Date',
      p_omit_dates: true,
      p_default_role: 'Service Staff',
      p_excluded_staff: ['Jane Doe'],
      p_po_required: true,
      p_terms_days: 30,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${CLIENT}`);
  });

  it('sends null terms for the default', async () => {
    await actions.saveTimesheetInvoicing(CLIENT, input({ paymentTermsDays: null }));
    expect(rpc.mock.calls[0]![1]['p_terms_days']).toBeNull();
  });

  it('refuses invalid settings before the round trip', async () => {
    const result = await actions.saveTimesheetInvoicing(CLIENT, input({ paymentTermsDays: 500 }));
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('turns a viewer’s and a scheduler’s refusal into a sentence', async () => {
    rpc.mockResolvedValueOnce({
      error: { code: '42501', message: 'not_permitted', details: 'finance' },
    });
    const result = await actions.saveTimesheetInvoicing(CLIENT, input());
    expect(!result.ok && result.message).toMatch(/owner or a manager with finance/);
    rpc.mockResolvedValueOnce({ error: { message: 'read_only' } });
    expect((await actions.saveTimesheetInvoicing(CLIENT, input())).ok).toBe(false);
  });
});

describe('the timesheet rate card', () => {
  const row = {
    roleName: ' Shift Leader ',
    aliases: ['Shift Lead', 'shift leader', 'Team Lead'],
    chargeRate: 19.52,
  };

  it('adds a role for this client, aliases cleaned', async () => {
    expect(await actions.addTimesheetRate(CLIENT, row)).toEqual({ ok: true });
    expect(table.calls[0]).toMatchObject({
      op: 'insert',
      row: {
        client_id: CLIENT,
        role_name: 'Shift Leader',
        aliases: ['Shift Lead', 'Team Lead'],
        charge_rate: 19.52,
      },
    });
  });

  it('says a role is already there instead of the constraint’s name', async () => {
    table.reply = {
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "timesheet_rates_client_role_idx"',
      },
    };
    const result = await actions.addTimesheetRate(CLIENT, row);
    expect(!result.ok && result.message).toMatch(/already on this client/);
    expect(!result.ok && result.message).not.toMatch(/constraint/);
  });

  it('edits only this client’s row, and says so when the row is gone or not theirs', async () => {
    expect(await actions.updateTimesheetRate(CLIENT, RATE, row)).toEqual({ ok: true });
    expect(table.calls[0]).toMatchObject({
      op: 'update',
      eq: [
        ['id', RATE],
        ['client_id', CLIENT],
      ],
    });
    table.reply = { data: [], error: null };
    const gone = await actions.updateTimesheetRate(CLIENT, RATE, row);
    expect(!gone.ok && gone.message).toMatch(/no longer exists|cannot change/);
  });

  it('removes a row', async () => {
    expect(await actions.removeTimesheetRate(CLIENT, RATE)).toEqual({ ok: true });
    expect(table.calls[0]).toMatchObject({
      op: 'delete',
      eq: [
        ['id', RATE],
        ['client_id', CLIENT],
      ],
    });
    table.reply = { data: [], error: null };
    expect((await actions.removeTimesheetRate(CLIENT, RATE)).ok).toBe(false);
  });

  it('validates a rate before it is written', async () => {
    expect((await actions.addTimesheetRate(CLIENT, { ...row, chargeRate: -3 })).ok).toBe(false);
    expect((await actions.addTimesheetRate('nope', row)).ok).toBe(false);
    expect(table.calls).toHaveLength(0);
  });
});

describe('the panel', () => {
  const render = (
    canWrite: boolean,
    over: Partial<TimesheetInvoicingSettings> = {},
    excluded = true,
  ) =>
    renderToStaticMarkup(
      <TimesheetInvoicing
        clientId={CLIENT}
        settings={{ ...settings, ...over }}
        rates={rates}
        excludedFromEvents={excluded}
        canWrite={canWrite}
      />,
    );

  it('shows the settings, the ADR-0203 interaction and the rate card', () => {
    const html = render(true);
    expect(html).toContain('Timesheet invoicing');
    expect(html).toContain('Timesheet — invoiced from an uploaded timesheet');
    expect(html).toContain('left out of event');
    expect(html).toContain('W/C Date');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Required on every invoice');
    expect(html).toContain('30 days');
    expect(html).toContain('Matched by name on the first invoice pushed');
    expect(html).toContain('Timesheet rate card');
    expect(html).toContain('Shift Lead');
    expect(html).toContain('£19.52');
    expect(html).toContain('+ Add role');
    expect(html).toContain('Edit');
  });

  it('a viewer sees the same and none of the controls', () => {
    const html = render(false);
    expect(html).toContain('Service Staff');
    expect(html).not.toContain('+ Add role');
    expect(html).not.toContain('>Edit<');
    expect(html).not.toContain('Remove');
  });

  it('an events client says its events are invoiced from the sign-in log; blank terms read as the default', () => {
    const html = render(false, { mode: 'events', paymentTermsDays: null, dateLabel: null });
    expect(html).toContain('Events — invoiced from the sign-in log');
    expect(html).toContain('Default terms');
    expect(html).toContain('Date (default)');
  });

  it('warns when the default role is not on the rate card', () => {
    expect(render(true, { defaultRole: 'Chef' })).toContain('Not on the rate card below');
    expect(render(true)).not.toContain('Not on the rate card below');
  });

  it('shows the Xero contact once the job has matched it', () => {
    expect(render(true, { xeroContactId: 'abc-123' })).toContain('abc-123');
  });
});
