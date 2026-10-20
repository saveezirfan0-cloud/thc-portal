import { describe, expect, it } from 'vitest';
import {
  INVOICING_DEFAULT_FIRST_EVENT_DATE,
  invoicingProblems,
  isIsoDate,
  mergeInvoicing,
  readInvoicing,
  validateAccountNumber,
  validateFirstEventDate,
  validateInvoiceTime,
  validateInvoicing,
  validatePaymentTerms,
  validatePoWindow,
  validateSortCode,
  validateVatRate,
} from '../validate';
import type { InvoicingSettings } from '../types';

/** The row 20261022100000_invoices_sent.sql seeds (§2). */
const SEEDED: InvoicingSettings = {
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
  late_payment_note: 'Invoices exceeding these payment terms will be passed on for collection.',
};

const withOver = (over: Partial<InvoicingSettings>): InvoicingSettings => ({ ...SEEDED, ...over });
const withCompany = (over: Partial<InvoicingSettings['company']>): InvoicingSettings => ({
  ...SEEDED,
  company: { ...SEEDED.company, ...over },
});
const withBank = (over: Partial<InvoicingSettings['bank']>): InvoicingSettings => ({
  ...SEEDED,
  bank: { ...SEEDED.bank, ...over },
});

describe('invoicing settings (ADR-0175)', () => {
  it('accepts the seeded row', () => {
    expect(invoicingProblems(SEEDED)).toEqual({});
    expect(validateInvoicing(SEEDED)).toBeNull();
  });

  describe('send time: HH:MM on the 24-hour clock', () => {
    it.each(['00:00', '09:30', '10:00', '23:59'])('accepts %s', (time) => {
      expect(validateInvoiceTime(time)).toBeNull();
    });
    it.each(['', '9:30', '24:00', '10:60', '10.00', '10am', '10:00 pm', '1000'])(
      'refuses %j',
      (time) => {
        expect(validateInvoiceTime(time)).toMatch(/HH:MM/);
        expect(invoicingProblems(withOver({ time }))).toHaveProperty('time');
      },
    );
  });

  describe('first invoiced event date: an ISO day', () => {
    it('accepts a real day', () => {
      expect(validateFirstEventDate('2026-10-26')).toBeNull();
      expect(isIsoDate('2028-02-29')).toBe(true);
    });
    it.each(['', '26/10/2026', '2026-1-26', '2026-02-30', '2027-02-29', '2026-13-01'])(
      'refuses %j',
      (date) => {
        expect(validateFirstEventDate(date)).not.toBeNull();
        expect(invoicingProblems(withOver({ first_event_date: date }))).toHaveProperty(
          'first_event_date',
        );
      },
    );
  });

  describe('VAT rate: 0–100 %', () => {
    it.each([0, 5, 17.5, 20, 100])('accepts %s', (rate) => {
      expect(validateVatRate(rate)).toBeNull();
    });
    it.each([-1, 100.01, 101, Number.NaN, Number.POSITIVE_INFINITY, 12.345])(
      'refuses %s',
      (rate) => {
        expect(validateVatRate(rate)).not.toBeNull();
        expect(invoicingProblems(withOver({ vat_rate: rate }))).toHaveProperty('vat_rate');
      },
    );
  });

  describe('payment terms: 0–120 days', () => {
    it.each([0, 7, 30, 120])('accepts %s', (days) => {
      expect(validatePaymentTerms(days)).toBeNull();
    });
    it.each([-1, 121, 7.5, Number.NaN])('refuses %s', (days) => {
      expect(validatePaymentTerms(days)).not.toBeNull();
      expect(invoicingProblems(withOver({ payment_terms_days: days }))).toHaveProperty(
        'payment_terms_days',
      );
    });
  });

  describe('PO window: 1–31 days', () => {
    it.each([1, 7, 31])('accepts %s', (days) => {
      expect(validatePoWindow(days)).toBeNull();
    });
    it.each([0, 32, 2.5, Number.NaN])('refuses %s', (days) => {
      expect(validatePoWindow(days)).not.toBeNull();
      expect(invoicingProblems(withOver({ po_window_days: days }))).toHaveProperty(
        'po_window_days',
      );
    });
  });

  describe('sort code: NN-NN-NN', () => {
    it('accepts 30-15-99, trimmed', () => {
      expect(validateSortCode('30-15-99')).toBeNull();
      expect(validateSortCode(' 30-15-99 ')).toBeNull();
    });
    it.each(['', '301599', '30 15 99', '30-15-9', '3O-15-99', '30-15-999'])(
      'refuses %j',
      (code) => {
        expect(validateSortCode(code)).toMatch(/NN-NN-NN/);
        expect(invoicingProblems(withBank({ sort_code: code }))).toHaveProperty('bank.sort_code');
      },
    );
  });

  describe('account number: 8 digits', () => {
    it('accepts 14076660', () => {
      expect(validateAccountNumber('14076660')).toBeNull();
    });
    it.each(['', '1407666', '140766600', '1407666O', '1407 6660'])('refuses %j', (number) => {
      expect(validateAccountNumber(number)).not.toBeNull();
      expect(invoicingProblems(withBank({ account_number: number }))).toHaveProperty(
        'bank.account_number',
      );
    });
  });

  describe('company email', () => {
    it.each(['', 'info', 'info@thc', 'info @thc.co.uk'])('refuses %j', (email) => {
      expect(invoicingProblems(withCompany({ email }))).toHaveProperty('company.email');
    });
  });

  describe('required: the company name and the bank details', () => {
    it('refuses a blank company name', () => {
      expect(invoicingProblems(withCompany({ name: '  ' }))).toHaveProperty('company.name');
    });
    it('refuses a blank account name or bank', () => {
      expect(invoicingProblems(withBank({ account_name: '' }))).toHaveProperty('bank.account_name');
      expect(invoicingProblems(withBank({ bank: '' }))).toHaveProperty('bank.bank');
    });
    it('needs a VAT registration number while VAT is charged, not at 0%', () => {
      expect(invoicingProblems(withCompany({ vat_reg: '' }))).toHaveProperty('company.vat_reg');
      expect(
        invoicingProblems({ ...withCompany({ vat_reg: '' }), vat_rate: 0 }),
      ).not.toHaveProperty('company.vat_reg');
    });
    it('leaves company registration, website and the late-payment wording optional', () => {
      expect(
        validateInvoicing({
          ...withCompany({ company_reg: '', website: '' }),
          late_payment_note: '',
        }),
      ).toBeNull();
    });
  });

  it('refuses over-long text', () => {
    expect(invoicingProblems(withCompany({ website: 'w'.repeat(201) }))).toHaveProperty(
      'company.website',
    );
    expect(invoicingProblems(withOver({ late_payment_note: 'x'.repeat(1001) }))).toHaveProperty(
      'late_payment_note',
    );
  });

  it('refuses an on/off that is not a boolean', () => {
    expect(validateInvoicing({ ...SEEDED, enabled: 'yes' as unknown as boolean })).not.toBeNull();
  });

  it('the action’s answer is the first problem in screen order', () => {
    expect(validateInvoicing(withOver({ time: '25:00', vat_rate: 200 }))).toMatch(/HH:MM/);
  });
});

describe('reading settings.invoicing as invoicing_config() does', () => {
  it('reads the seeded row as it is', () => {
    expect(readInvoicing(SEEDED)).toEqual(SEEDED);
  });

  it('a missing row is off, with the defaults and no invented details', () => {
    const read = readInvoicing(null);
    expect(read).toMatchObject({
      enabled: false,
      time: '10:00',
      first_event_date: INVOICING_DEFAULT_FIRST_EVENT_DATE,
      po_window_days: 7,
      vat_rate: 20,
      payment_terms_days: 7,
      late_payment_note: '',
    });
    expect(read.company.name).toBe('');
    expect(read.bank.sort_code).toBe('');
  });

  it('numbers stored as strings are read; the PO window is at least 1', () => {
    expect(readInvoicing({ vat_rate: '17.5', po_window_days: 0 })).toMatchObject({
      vat_rate: 17.5,
      po_window_days: 1,
    });
  });

  it('a malformed time or date falls back to the default', () => {
    expect(readInvoicing({ time: '9am', first_event_date: 'soon' })).toMatchObject({
      time: '10:00',
      first_event_date: '2026-10-26',
    });
  });
});

describe('writing settings.invoicing back', () => {
  it('keeps keys this screen does not edit, at the top and inside company/bank', () => {
    const stored = {
      ...SEEDED,
      logo_path: 'brand/logo.png',
      company: { ...SEEDED.company, phone: '020 7946 0000' },
      bank: { ...SEEDED.bank, iban: 'GB00LOYD30159914076660' },
    };
    const merged = mergeInvoicing(stored, withOver({ vat_rate: 5, enabled: false }));
    expect(merged).toMatchObject({
      logo_path: 'brand/logo.png',
      vat_rate: 5,
      enabled: false,
      company: { phone: '020 7946 0000', name: SEEDED.company.name },
      bank: { iban: 'GB00LOYD30159914076660', sort_code: '30-15-99' },
    });
  });

  it('trims what was typed', () => {
    const merged = mergeInvoicing(null, withBank({ sort_code: ' 30-15-99 ' }));
    expect((merged['bank'] as Record<string, unknown>)['sort_code']).toBe('30-15-99');
  });
});
