import { beforeEach, describe, expect, it, vi } from 'vitest';
import { officeCopyText, splitAddresses, validateOfficeCopy } from '../officeCopy';

/**
 * ADR-0179: the "Office copy of timesheets" block. Up to five addresses,
 * trimmed, lower-cased and de-duplicated; empty is off. Saved under
 * `document_office_copy` as `{ emails }` — the shape the database guard and
 * document_office_copy() read.
 */
const db = vi.hoisted(() => ({
  upsert: vi.fn(async (..._args: unknown[]) => ({
    error: null as null | { code?: string; message: string },
  })),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../data', () => ({ supabaseConfigured: () => true }));
vi.mock('../db', () => ({ settingsDb: () => ({ from: () => ({ upsert: db.upsert }) }) }));

const { saveDocumentOfficeCopy } = await import('../officeCopyActions');
const { READ_ONLY_MESSAGE } = await import('../../_lib/sessionRole');

beforeEach(() => {
  db.upsert.mockClear();
  db.upsert.mockResolvedValue({ error: null });
});

describe('validateOfficeCopy', () => {
  it('splits on lines, commas, semicolons and spaces; trims, lower-cases, de-dupes', () => {
    expect(splitAddresses(' Sam@THC.co.uk\nsam@thc.co.uk, b@x.co; c@x.co  d@x.co\n\n')).toEqual([
      'sam@thc.co.uk',
      'b@x.co',
      'c@x.co',
      'd@x.co',
    ]);
    expect(validateOfficeCopy('Sam@THC.co.uk\n')).toEqual({ ok: true, emails: ['sam@thc.co.uk'] });
  });

  it('empty is off — a valid save of nobody', () => {
    expect(validateOfficeCopy('')).toEqual({ ok: true, emails: [] });
    expect(validateOfficeCopy(' \n ')).toEqual({ ok: true, emails: [] });
  });

  it('refuses an address that is not one', () => {
    expect(validateOfficeCopy('sam@thc')).toEqual({
      ok: false,
      message: '“sam@thc” is not a valid email address.',
    });
    expect(validateOfficeCopy('good@x.co\nnope')).toMatchObject({ ok: false });
  });

  it('refuses more than five', () => {
    expect(validateOfficeCopy('a@x.co b@x.co c@x.co d@x.co e@x.co')).toMatchObject({ ok: true });
    expect(validateOfficeCopy('a@x.co b@x.co c@x.co d@x.co e@x.co f@x.co')).toEqual({
      ok: false,
      message: 'Up to 5 addresses can get the office copy.',
    });
    // A repeat does not count twice.
    expect(validateOfficeCopy('a@x.co A@x.co b@x.co c@x.co d@x.co e@x.co')).toMatchObject({
      ok: true,
    });
  });

  it('shows the saved list one per line', () => {
    expect(officeCopyText(['a@x.co', 'b@x.co'])).toBe('a@x.co\nb@x.co');
  });
});

describe('saveDocumentOfficeCopy', () => {
  it('writes { emails } under document_office_copy, cleaned', async () => {
    expect(await saveDocumentOfficeCopy(' Sam@THC.co.uk\nsam@thc.co.uk ')).toEqual({ ok: true });
    expect(db.upsert).toHaveBeenCalledTimes(1);
    const [row, options] = db.upsert.mock.calls[0]! as [Record<string, unknown>, unknown];
    expect(row).toMatchObject({
      key: 'document_office_copy',
      value: { emails: ['sam@thc.co.uk'] },
    });
    expect(options).toEqual({ onConflict: 'key' });
  });

  it('saves an empty box as off, keeping the row', async () => {
    expect(await saveDocumentOfficeCopy('')).toEqual({ ok: true });
    const [row] = db.upsert.mock.calls[0]! as [Record<string, unknown>];
    expect(row).toMatchObject({ key: 'document_office_copy', value: { emails: [] } });
  });

  it('refuses an invalid list before writing anything', async () => {
    expect(await saveDocumentOfficeCopy('not-an-email')).toMatchObject({ ok: false });
    expect(await saveDocumentOfficeCopy('a@x.co b@x.co c@x.co d@x.co e@x.co f@x.co')).toMatchObject(
      { ok: false },
    );
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it('a refused write (a manager, by RLS) reads as a sentence, never the database text', async () => {
    db.upsert.mockResolvedValueOnce({
      error: {
        code: '42501',
        message: 'new row violates row-level security policy for table "settings"',
      },
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await saveDocumentOfficeCopy('sam@thc.co.uk');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).not.toMatch(/row-level|settings/);
    spy.mockRestore();
  });

  it('a read-only session is told so', async () => {
    db.upsert.mockResolvedValueOnce({ error: { code: 'P0001', message: 'read_only' } });
    expect(await saveDocumentOfficeCopy('sam@thc.co.uk')).toEqual({
      ok: false,
      message: READ_ONLY_MESSAGE,
    });
  });
});
