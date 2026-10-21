import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type BufferSuggestionRule, DEFAULT_BUFFER_RULE } from '@thc/domain';
import { TimeFormatProvider } from '@thc/ui';

/**
 * ADR-0181 on /settings: "Suggested overs". The save writes exactly the six
 * keys of the rule under `buffer_suggestion` and refuses a rule the builder
 * could not read before anything is written; the screen reads a missing or
 * malformed row as the default; the block reads the rule back as a sentence
 * the office can read aloud, with the early start typed in a "(UK time)"
 * time box.
 */
const db = vi.hoisted(() => ({
  rows: [] as { key: string; value: unknown }[],
  upsert: vi.fn(async (..._args: unknown[]) => ({
    error: null as null | { code?: string; message: string },
  })),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('../db', () => ({ settingsDb: () => ({ from: () => ({ upsert: db.upsert }) }) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () =>
        table === 'settings'
          ? { returns: async () => ({ data: db.rows, error: null }) }
          : { order: () => ({ returns: async () => ({ data: [], error: null }) }) },
    }),
  }),
}));

process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost';
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon';

const { saveBufferSuggestion } = await import('../actions');
const { loadSettings } = await import('../data');
const { BufferSuggestionBlock, bufferExamples } = await import('../BufferSuggestionBlock');
const { READ_ONLY_MESSAGE } = await import('../../_lib/sessionRole');

const rule = (over: Partial<BufferSuggestionRule> = {}): BufferSuggestionRule => ({
  ...DEFAULT_BUFFER_RULE,
  ...over,
});

beforeEach(() => {
  db.rows = [];
  db.upsert.mockReset();
  db.upsert.mockResolvedValue({ error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('saveBufferSuggestion', () => {
  it('writes exactly the six keys under buffer_suggestion', async () => {
    const sent = { ...rule({ rounding: 'down' }), minimum: 1, extra: 'dropped' };
    expect(await saveBufferSuggestion(sent as BufferSuggestionRule)).toEqual({ ok: true });
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'buffer_suggestion', value: rule({ rounding: 'down' }) }),
      { onConflict: 'key' },
    );
  });

  it('saves the rule switched off, and with no early start', async () => {
    expect(await saveBufferSuggestion(rule({ enabled: false }))).toEqual({ ok: true });
    expect(await saveBufferSuggestion(rule({ early_start_before: null }))).toEqual({ ok: true });
  });

  it.each<[string, Partial<BufferSuggestionRule> | Record<string, unknown>, string]>([
    [
      'a cleared "for every" box',
      { per: Number.NaN },
      '"One extra for every" is a whole number of staff from 1 to 100.',
    ],
    ['per 0', { per: 0 }, '"One extra for every" is a whole number of staff from 1 to 100.'],
    ['another rounding', { rounding: 'nearest' }, 'Choose rounded up or down.'],
    [
      'a negative "roles under"',
      { from_headcount: -1 },
      '"Roles under" is a whole number of staff from 0 to 100.',
    ],
    [
      'a bad early start',
      { early_start_before: '8am' },
      'The early start is a time like 08:00, or blank for none.',
    ],
    [
      'a cleared early extra',
      { early_start_extra: Number.NaN },
      'The early-start extra is a whole number from 0 to 20.',
    ],
  ])('refuses %s, writing nothing', async (_, over, message) => {
    expect(await saveBufferSuggestion(rule(over as Partial<BufferSuggestionRule>))).toEqual({
      ok: false,
      message,
    });
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it('passes on the viewer refusal as the screen’s words', async () => {
    db.upsert.mockResolvedValue({ error: { code: 'P0001', message: 'read_only' } });
    expect(await saveBufferSuggestion(rule())).toEqual({ ok: false, message: READ_ONLY_MESSAGE });
  });

  it('never shows the database’s own text', async () => {
    db.upsert.mockResolvedValue({
      error: { code: '42501', message: 'new row violates row-level security policy "x"' },
    });
    const result = await saveBufferSuggestion(rule());
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('row-level');
  });
});

describe('loadSettings reads the rule as the builder does', () => {
  it('reads a stored rule', async () => {
    const stored = rule({ enabled: false, per: 4, rounding: 'down', early_start_before: null });
    db.rows = [{ key: 'buffer_suggestion', value: stored }];
    expect((await loadSettings()).bufferSuggestion).toEqual(stored);
  });

  it('falls back to the client’s rule when the row is missing or malformed', async () => {
    expect((await loadSettings()).bufferSuggestion).toEqual(DEFAULT_BUFFER_RULE);
    db.rows = [{ key: 'buffer_suggestion', value: { per: 'five' } }];
    expect((await loadSettings()).bufferSuggestion).toEqual(DEFAULT_BUFFER_RULE);
  });
});

describe('the "Suggested overs" block', () => {
  const html = (r: BufferSuggestionRule, clock: '24h' | '12h' = '24h') =>
    renderToStaticMarkup(
      <TimeFormatProvider format={clock}>
        <BufferSuggestionBlock rule={r} />
      </TimeFormatProvider>,
    );

  it('reads the rule back as one sentence', () => {
    const page = html(DEFAULT_BUFFER_RULE);
    expect(page).toContain('Suggested overs');
    expect(page).toContain(
      'One extra for every 5 staff, rounded up. Roles under 5 staff get none, unless they start before 08:00 — then 1 extra.',
    );
    expect(page).toContain('The Shift Builder fills this in; you can always change it.');
  });

  it('labels every field, the time "(UK time)" and never a browser time input', () => {
    const page = html(DEFAULT_BUFFER_RULE);
    for (const label of [
      'One extra for every (staff)',
      'Rounded',
      'Roles under (staff) get none',
      'Unless they start before (UK time)',
      'Then this many extra',
    ]) {
      expect(page).toContain(`>${label}</label>`);
    }
    expect(page).not.toContain('type="time"');
    expect(page).toMatch(/value="08:00"/);
    expect(page).toContain('<option value="up" selected="">up</option>');
    expect(page).not.toContain('style=');
  });

  it('writes the early start on the operator’s clock', () => {
    const page = html(DEFAULT_BUFFER_RULE, '12h');
    expect(page).toContain('unless they start before 8:00 am — then 1 extra.');
  });

  it('has the on/off switch, on by default', () => {
    const page = html(DEFAULT_BUFFER_RULE);
    expect(page).toContain('role="switch" aria-checked="true"');
    expect(page).toContain('On — new role sections start with the suggested buffer');
    const off = html(rule({ enabled: false }));
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain('Off — new role sections start with no buffer');
  });

  it('shows worked examples in the 6 (+1) form', () => {
    expect(bufferExamples(DEFAULT_BUFFER_RULE)).toBe(
      '4 → 4 (+0) · 4 before 08:00 → 4 (+1) · 5 → 5 (+1) · 6 → 6 (+2) · 7 → 7 (+2) · 10 → 10 (+2) · 11 → 11 (+3)',
    );
    expect(bufferExamples(rule({ rounding: 'down', early_start_before: null }))).toBe(
      '4 → 4 (+0) · 5 → 5 (+1) · 6 → 6 (+1) · 7 → 7 (+1) · 10 → 10 (+2) · 11 → 11 (+2)',
    );
    expect(bufferExamples(rule({ per: 0 }))).toBeNull();
  });

  it('says a saved buffer is never changed by it, and whose start counts', () => {
    const page = html(DEFAULT_BUFFER_RULE);
    expect(page).toContain('a buffer already saved on an event is never changed by it');
    expect(page).toContain('each role’s own start time');
  });
});
