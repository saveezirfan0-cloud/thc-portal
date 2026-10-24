/**
 * settings.xero (ADR-0210 §6, ADR-0211): the office's choices for the Xero
 * push. Pure, so the job, the /settings Xero tab and its server action share
 * one reading and one set of refusals.
 */

export const XERO_INVOICE_STATUSES = ['DRAFT', 'SUBMITTED', 'AUTHORISED'] as const;
export type XeroInvoiceStatus = (typeof XERO_INVOICE_STATUSES)[number];

export interface XeroSettings {
  enabled: boolean;
  /** Only invoice numbers from this one are pushed; earlier history is never sent. */
  from_number: number;
  invoice_status: XeroInvoiceStatus;
  /** The Xero chart-of-accounts code the lines are posted to (a sales account). */
  sales_account_code: string;
  /** Xero's tax type for a line, e.g. OUTPUT2 = 20% (VAT on Income). */
  tax_type: string;
  attach_pdf: boolean;
}

export const DEFAULT_XERO_SETTINGS: XeroSettings = {
  enabled: false,
  from_number: 4000,
  invoice_status: 'DRAFT',
  sales_account_code: '200',
  tax_type: 'OUTPUT2',
  attach_pdf: true,
};

export const FROM_NUMBER_MAX = 99_999_999;

function plain(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The stored row with every value defaulted; a bad value falls back, never throws. */
export function readXeroSettings(raw: unknown): XeroSettings {
  const row = plain(raw);
  const d = DEFAULT_XERO_SETTINGS;
  const from = Number(row['from_number']);
  const status = row['invoice_status'];
  const account =
    typeof row['sales_account_code'] === 'string' ? row['sales_account_code'].trim() : '';
  const tax = typeof row['tax_type'] === 'string' ? row['tax_type'].trim() : '';
  return {
    enabled: row['enabled'] === true,
    from_number:
      Number.isInteger(from) && from >= 1 && from <= FROM_NUMBER_MAX ? from : d.from_number,
    invoice_status: (XERO_INVOICE_STATUSES as readonly unknown[]).includes(status)
      ? (status as XeroInvoiceStatus)
      : d.invoice_status,
    sales_account_code: account || d.sales_account_code,
    tax_type: tax || d.tax_type,
    attach_pdf: row['attach_pdf'] !== false,
  };
}

const ACCOUNT_CODE = /^[A-Za-z0-9._-]{1,10}$/;
const TAX_TYPE = /^[A-Za-z0-9_]{1,40}$/;

export interface XeroSettingsProblems {
  from_number?: string;
  invoice_status?: string;
  sales_account_code?: string;
  tax_type?: string;
}

export function xeroProblems(s: XeroSettings): XeroSettingsProblems {
  const out: XeroSettingsProblems = {};
  if (!Number.isInteger(s.from_number) || s.from_number < 1 || s.from_number > FROM_NUMBER_MAX) {
    out.from_number = `Enter an invoice number between 1 and ${FROM_NUMBER_MAX}.`;
  }
  if (!(XERO_INVOICE_STATUSES as readonly unknown[]).includes(s.invoice_status)) {
    out.invoice_status = 'Choose Draft, Awaiting approval or Approved.';
  }
  if (typeof s.sales_account_code !== 'string' || !ACCOUNT_CODE.test(s.sales_account_code.trim())) {
    out.sales_account_code = 'Enter the Xero account code (up to 10 letters, digits, . - _).';
  }
  if (typeof s.tax_type !== 'string' || !TAX_TYPE.test(s.tax_type.trim())) {
    out.tax_type = 'Enter the Xero tax type, e.g. OUTPUT2.';
  }
  return out;
}

/** The first refusal, as the save action's message; null when the draft is fine. */
export function validateXero(s: XeroSettings): string | null {
  if (typeof s?.enabled !== 'boolean' || typeof s?.attach_pdf !== 'boolean') {
    return 'Nothing to save.';
  }
  const p = xeroProblems(s);
  return p.from_number ?? p.invoice_status ?? p.sales_account_code ?? p.tax_type ?? null;
}

/** Laid over the stored row so a key this screen does not edit survives the save. */
export function mergeXero(stored: unknown, draft: XeroSettings): Record<string, unknown> {
  return {
    ...plain(stored),
    enabled: draft.enabled,
    from_number: draft.from_number,
    invoice_status: draft.invoice_status,
    sales_account_code: draft.sales_account_code.trim(),
    tax_type: draft.tax_type.trim(),
    attach_pdf: draft.attach_pdf,
  };
}
