import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type BufferSuggestionRule, DEFAULT_BUFFER_RULE } from '@thc/domain';

/**
 * ADR-0181 on /settings: "Suggested overs". The save writes exactly the
 * four keys of the rule under `buffer_suggestion` and refuses a rule the
 * builder could not read before anything is written; the screen reads a
 * missing or malformed row as the default; the block says the rule as a
 * sentence the office can read aloud.
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

beforeEach(() => {
  db.rows = [];
  db.upsert.mockReset();
  db.upsert.mockResolvedValue({ error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('saveBufferSuggestion', () => {
  it('writes exactly the four keys under buffer_suggestion', async () => {
    const sent = { enabled: true, per: 5, rounding: 'up', minimum: 1, extra: 'dropped' };
    expect(await saveBufferSuggestion(sent as BufferSuggestionRule)).toEqual({ ok: true });
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'buffer_suggestion',
        value: { enabled: true, per: 5, rounding: 'up', minimum: 1 },
      }),
      { onConflict: 'key' },
    );
  });

  it('saves the rule switched off', async () => {
    expect(await saveBufferSuggestion({ ...DEFAULT_BUFFER_RULE, enabled: false })).toEqual({
      ok: true,
    });
  });

  it.each<[string, Partial<BufferSuggestionRule> | Record<string, unknown>, string]>([
    [
      'a cleared "for every" box',
      { per: Number.NaN },
      '"For every" is a whole number of staff from 1 to 100.',
    ],
    ['per 0', { per: 0 }, '"For every" is a whole number of staff from 1 to 100.'],
    ['a fractional per', { per: 2.5 }, '"For every" is a whole number of staff from 1 to 100.'],
    ['a negative minimum', { minimum: -1 }, '"At least" is a whole number from 0 to 20.'],
    ['a cleared minimum', { minimum: Number.NaN }, '"At least" is a whole number from 0 to 20.'],
    ['another rounding', { rounding: 'nearest' }, 'Choose rounded down or up.'],
  ])('refuses %s, writing nothing', async (_, over, message) => {
    const rule = { ...DEFAULT_BUFFER_RULE, ...over } as BufferSuggestionRule;
    expect(await saveBufferSuggestion(rule)).toEqual({ ok: false, message });
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it('passes on the viewer refusal as the screen’s words', async () => {
    db.upsert.mockResolvedValue({ error: { code: 'P0001', message: 'read_only' } });
    expect(await saveBufferSuggestion({ ...DEFAULT_BUFFER_RULE })).toEqual({
      ok: false,
      message: READ_ONLY_MESSAGE,
    });
  });

  it('never shows the database’s own text', async () => {
    db.upsert.mockResolvedValue({
      error: { code: '42501', message: 'new row violates row-level security policy "x"' },
    });
    const result = await saveBufferSuggestion({ ...DEFAULT_BUFFER_RULE });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('row-level');
  });
});

describe('loadSettings reads the rule as the builder does', () => {
  it('reads a stored rule', async () => {
    db.rows = [
      { key: 'buffer_suggestion', value: { enabled: false, per: 4, rounding: 'up', minimum: 1 } },
    ];
    expect((await loadSettings()).bufferSuggestion).toEqual({
      enabled: false,
      per: 4,
      rounding: 'up',
      minimum: 1,
    });
  });

  it('falls back to one for every five when the row is missing or malformed', async () => {
    expect((await loadSettings()).bufferSuggestion).toEqual(DEFAULT_BUFFER_RULE);
    db.rows = [{ key: 'buffer_suggestion', value: { per: 'five' } }];
    expect((await loadSettings()).bufferSuggestion).toEqual(DEFAULT_BUFFER_RULE);
  });
});

describe('the "Suggested overs" block', () => {
  const html = (rule: BufferSuggestionRule) =>
    renderToStaticMarkup(<BufferSuggestionBlock rule={rule} />);

  it('says the rule as a sentence, with the three values in it', () => {
    const page = html(DEFAULT_BUFFER_RULE);
    expect(page).toContain('Suggested overs');
    expect(page).toContain('One extra for every');
    expect(page).toContain('staff, rounded');
    expect(page).toContain('per role.');
    expect(page).toContain('The Shift Builder fills this in; you can always change it.');
    expect(page).toMatch(
      /aria-label="Staff for each extra"[^>]*value="5"|value="5"[^>]*aria-label="Staff for each extra"/,
    );
    expect(page).toContain('<option value="down" selected="">down</option>');
  });

  it('has the on/off switch, on by default', () => {
    const page = html(DEFAULT_BUFFER_RULE);
    expect(page).toContain('role="switch" aria-checked="true"');
    expect(page).toContain('On — new role sections start with the suggested buffer');
    const off = html({ ...DEFAULT_BUFFER_RULE, enabled: false });
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain('Off — new role sections start with no buffer');
  });

  it('shows worked examples in the 6 (+1) form', () => {
    expect(bufferExamples(DEFAULT_BUFFER_RULE)).toBe(
      '4 → 4 (+0) · 5 → 5 (+1) · 7 → 7 (+1) · 10 → 10 (+2) · 20 → 20 (+4)',
    );
    expect(bufferExamples({ ...DEFAULT_BUFFER_RULE, rounding: 'up', minimum: 1 })).toBe(
      '4 → 4 (+1) · 5 → 5 (+1) · 7 → 7 (+2) · 10 → 10 (+2) · 20 → 20 (+4)',
    );
    expect(bufferExamples({ ...DEFAULT_BUFFER_RULE, per: 0 })).toBeNull();
  });

  it('says a saved buffer is never changed by it', () => {
    expect(html(DEFAULT_BUFFER_RULE)).toContain(
      'A buffer already saved on an event is never changed by it',
    );
  });
});
