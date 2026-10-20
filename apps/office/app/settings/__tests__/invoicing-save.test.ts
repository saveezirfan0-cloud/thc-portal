import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoicingSettings } from '../types';

/**
 * ADR-0175: saving the Invoicing block writes the whole `invoicing` object
 * back under its own key, laid over the stored row, and refuses an invalid
 * draft before anything is read or written.
 */
const db = vi.hoisted(() => ({
  stored: null as unknown,
  readError: null as null | { code?: string; message: string },
  upsert: vi.fn(async (..._args: unknown[]) => ({
    error: null as null | { code?: string; message: string },
  })),
  select: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../data', () => ({ supabaseConfigured: () => true }));
vi.mock('../db', () => ({
  settingsDb: () => ({
    from: () => ({
      upsert: db.upsert,
      select: (...args: unknown[]) => {
        db.select(...args);
        return {
          eq: () => ({
            maybeSingle: async () => ({
              data: db.stored === null ? null : { value: db.stored },
              error: db.readError,
            }),
          }),
        };
      },
    }),
  }),
}));

const { saveInvoicing } = await import('../actions');
const { READ_ONLY_MESSAGE } = await import('../../_lib/sessionRole');

const DRAFT: InvoicingSettings = {
  enabled: true,
  time: '10:00',
  first_event_date: '2026-10-26',
  po_window_days: 7,
  vat_rate: 20,
  payment_terms_days: 7,
  company: {
    name: 'THE HOSPITALITY COMPANY (London) Ltd',
    company_reg: '12411407',
    vat_reg: '388046760',
    email: 'info@thehospitalitycompany.co.uk',
    website: 'www.thehospitalitycompany.co.uk',
  },
  bank: {
    account_name: 'THE HOSPITALITY COMPANY (London) Ltd',
    bank: 'Lloyds Bank',
    account_number: '14076660',
    sort_code: '30-15-99',
  },
  late_payment_note: 'A £35.00 late payment fee will be added.',
};

beforeEach(() => {
  db.stored = null;
  db.readError = null;
  db.upsert.mockReset();
  db.upsert.mockResolvedValue({ error: null });
  db.select.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('saveInvoicing', () => {
  it('writes the whole object under key invoicing, keeping unknown keys', async () => {
    db.stored = { ...DRAFT, vat_rate: 17.5, footer: 'kept', bank: { ...DRAFT.bank, iban: 'kept' } };
    expect(await saveInvoicing({ ...DRAFT, time: '09:30' })).toEqual({ ok: true });
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'invoicing',
        value: expect.objectContaining({
          time: '09:30',
          vat_rate: 20,
          footer: 'kept',
          bank: expect.objectContaining({ iban: 'kept', sort_code: '30-15-99' }),
        }),
      }),
      { onConflict: 'key' },
    );
  });

  it('refuses an invalid draft before reading or writing', async () => {
    const result = await saveInvoicing({ ...DRAFT, bank: { ...DRAFT.bank, sort_code: '301599' } });
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/NN-NN-NN/) });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it('a read-only login is told so', async () => {
    db.upsert.mockResolvedValueOnce({ error: { code: '42501', message: 'read_only' } });
    expect(await saveInvoicing(DRAFT)).toEqual({ ok: false, message: READ_ONLY_MESSAGE });
  });

  it('a refused read is generic copy, and nothing is written', async () => {
    db.readError = { code: '42501', message: 'permission denied for table settings' };
    const result = await saveInvoicing(DRAFT);
    expect(result.ok).toBe(false);
    expect(result).not.toMatchObject({ message: expect.stringContaining('permission') });
    expect(db.upsert).not.toHaveBeenCalled();
  });
});
