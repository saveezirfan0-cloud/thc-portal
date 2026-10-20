import { DEFAULT_WEIGHTS, parseWeights } from '@thc/domain';
import { KANBAN_STAGES } from './types';
import type {
  InvoicingBank,
  InvoicingCompany,
  InvoicingSettings,
  ScoringWeights,
  Senders,
  WilloStageMap,
} from './types';

/**
 * What /settings refuses to save (§6, §2.4, §9.11, §9.12).
 *
 * Pure, so the screen and the server action share one answer and the rules
 * can be tested without a database. Every one of these is a setting that
 * fails silently if it is wrong — a weight set that does not sum to 1
 * still produces scores, and a sender address with a typo still sends
 * mail, into the void. Silent failure is what makes them worth validating
 * here rather than trusting an admin to be careful.
 */

/** The five §6 factors, in the order the screen lists them. */
export const WEIGHT_FIELDS: {
  key: keyof ScoringWeights;
  label: string;
  hint: string;
}[] = [
  { key: 'show_rate', label: 'Show rate', hint: 'Shifts turned up to, as a percentage.' },
  { key: 'rating', label: 'Client rating', hint: 'Average star rating out of 5.' },
  {
    key: 'proximity',
    label: 'Proximity',
    hint: 'Home-to-venue distance. Falls away past about 30 km.',
  },
  {
    key: 'fair_rotation',
    label: 'Fair rotation',
    hint: 'Favours workers with fewer shifts already booked.',
  },
  {
    key: 'venue_history',
    label: 'Venue history',
    hint: 'Times this worker has worked this venue before.',
  },
];

/** §6's shipped weights, in the `settings` row's own spelling. */
export const SHIPPED_WEIGHTS: ScoringWeights = {
  show_rate: DEFAULT_WEIGHTS.show,
  rating: DEFAULT_WEIGHTS.rating,
  proximity: DEFAULT_WEIGHTS.proximity,
  fair_rotation: DEFAULT_WEIGHTS.fair,
  venue_history: DEFAULT_WEIGHTS.venue,
};

/** Float noise: 0.30 + 0.25 + 0.25 + 0.10 + 0.10 is not exactly 1 in binary. */
const EPSILON = 0.0005;

export function weightTotal(weights: ScoringWeights): number {
  return (
    weights.show_rate +
    weights.rating +
    weights.proximity +
    weights.fair_rotation +
    weights.venue_history
  );
}

/**
 * The weights must sum to 1.
 *
 * §6's score is a weighted sum of five factors each normalised to 0-100,
 * so a set summing to 0.9 quietly caps every worker at 90 and a set
 * summing to 1.2 pushes the top of the pool past 100. Neither breaks
 * anything visibly — the RANKING is unchanged, which is exactly why this
 * is the kind of mistake that survives for months. The screen refuses it.
 */
export function validateWeights(weights: ScoringWeights): string | null {
  for (const { key, label } of WEIGHT_FIELDS) {
    const value = weights[key];
    if (!Number.isFinite(value)) return `${label} must be a number.`;
    if (value < 0 || value > 1) return `${label} must be between 0 and 1.`;
  }
  const total = weightTotal(weights);
  if (Math.abs(total - 1) > EPSILON) {
    return `The five weights must add up to 1.00 — they currently add up to ${total.toFixed(2)}.`;
  }
  return null;
}

/**
 * Reading the row back. `parseWeights` in @thc/domain is the only sanctioned
 * way to turn the stored JSON into weights (its keys differ from the
 * interface the scorer uses), so this goes through it rather than casting.
 */
export function readWeights(row: unknown): ScoringWeights {
  const parsed = parseWeights(row);
  return {
    show_rate: parsed.show,
    rating: parsed.rating,
    proximity: parsed.proximity,
    fair_rotation: parsed.fair,
    venue_history: parsed.venue,
  };
}

export function validateWillo(map: WilloStageMap): string | null {
  const entries: [string, string][] = [
    ['New response', map.new_response],
    ['Accepted', map.accepted],
    ['Rejected', map.rejected],
  ];
  for (const [label, stage] of entries) {
    if (!(KANBAN_STAGES as readonly string[]).includes(stage)) {
      return `${label} must map to one of: ${KANBAN_STAGES.join(', ')}.`;
    }
  }
  // §2.4: "Rejected in Willo → the system rejects automatically." Pointing
  // it anywhere else turns an automatic rejection into an advancement.
  if (map.rejected !== 'rejected') {
    return 'A Willo rejection must map to the Rejected stage.';
  }
  return null;
}

/**
 * §2.4's "Review interview on Willo" link template. Blank is allowed — it
 * means "not connected yet" and the button says so. Anything else must be
 * an https URL carrying `{id}`, because that is the only substitution the
 * view performs: a template without it would send every card to the same
 * page.
 */
export function validateWilloReviewUrlTemplate(value: string): string | null {
  const template = value.trim();
  if (template === '') return null;
  if (!template.includes('{id}')) {
    return 'The template must contain {id} where Willo’s candidate id goes.';
  }
  let url: URL;
  try {
    url = new URL(template.replace('{id}', 'x'));
  } catch {
    return 'The template is not a valid URL.';
  }
  if (url.protocol !== 'https:') return 'The Willo link must be https.';
  return null;
}

/** ADR-0149. The same limit `willo_interview_public_url()` applies in the database. */
export const WILLO_INTERVIEW_URL_MAX = 500;

/**
 * ADR-0149: the interview's public link, which the OC1 reminder email carries
 * so a candidate who cannot find Willo's invitation can still record.
 * Blank is allowed (no link, the email as it was). Otherwise one https URL:
 * no spaces, no `user@` and at most 500 characters — what the database reads
 * back as a link (`willo_interview_public_url()`), so a value this accepts is
 * one the reminder will carry and one it refuses is never half-saved.
 */
export function validateWilloInterviewUrl(value: string): string | null {
  const link = value.trim();
  if (link === '') return null;
  if (link.length > WILLO_INTERVIEW_URL_MAX) {
    return `The interview link is longer than ${WILLO_INTERVIEW_URL_MAX} characters.`;
  }
  if (/\s/.test(link)) return 'The interview link must not contain spaces.';
  if (/[<>"']/.test(link)) return 'The interview link must not contain < > " or \' characters.';
  if (!/^https?:/i.test(link)) return 'The interview link is not a valid URL.';
  if (!/^https:/.test(link)) return 'The interview link must be https.';
  // The database's own rule (`willo_interview_public_url()`): a literal
  // `https://`, then a host with no `@` before the first `/`.
  if (!/^https:\/\/[^/\s@]+(\/\S*)?$/.test(link)) {
    return /@/.test(link.split('/')[2] ?? '')
      ? 'The interview link must not contain a login.'
      : 'The interview link is not a valid URL.';
  }
  try {
    new URL(link);
  } catch {
    return 'The interview link is not a valid URL.';
  }
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * §9.12 is explicit that ALL outgoing mail comes from one of two addresses
 * and that "no-reply addresses are not used", because replies to either go
 * to a monitored mailbox. An address starting `no-reply` or `noreply` is
 * therefore refused rather than accepted with a warning.
 */
export function validateSenders(senders: Senders): string | null {
  const entries: [string, string][] = [
    ['Timesheets sender', senders.timesheets],
    ['Admin sender', senders.admin],
  ];
  for (const [label, address] of entries) {
    if (!EMAIL.test(address.trim())) return `${label} is not a valid email address.`;
    if (/^no-?reply@/i.test(address.trim())) {
      return `${label}: no-reply addresses are not used — replies go to a monitored mailbox.`;
    }
  }
  // Optional: blank means replies go to the sending address.
  const replies: [string, string | undefined][] = [
    ['Timesheets reply-to', senders.timesheets_reply_to],
    ['Admin reply-to', senders.admin_reply_to],
  ];
  for (const [label, address] of replies) {
    const value = address?.trim() ?? '';
    if (value === '') continue;
    if (!EMAIL.test(value)) return `${label} is not a valid email address.`;
    if (/^no-?reply@/i.test(value)) {
      return `${label}: replies must reach a monitored mailbox, not a no-reply address.`;
    }
  }
  return null;
}

/** §9.11: the slider's range, and so the range a standard radius may sit in. */
export const MIN_RADIUS_M = 100;
export const MAX_RADIUS_M = 3000;

export function validateRadius(label: string, metres: number): string | null {
  if (!Number.isInteger(metres)) return `${label}: the radius is a whole number of metres.`;
  if (metres < MIN_RADIUS_M || metres > MAX_RADIUS_M) {
    return `${label}: the radius must be between ${MIN_RADIUS_M} m and ${MAX_RADIUS_M} m.`;
  }
  return null;
}

export function validateGap(minutes: number): string | null {
  if (!Number.isInteger(minutes) || minutes < 0) {
    return 'The different-venue gap is a whole number of minutes.';
  }
  if (minutes > 24 * 60) return 'A different-venue gap longer than a day would gate every shift.';
  return null;
}

/**
 * ADR-0164: how long one Back Office sign-in lasts. The database refuses
 * anything else (settings_office_security_guard), so the screen says why
 * first.
 */
export const SESSION_HOURS_MIN = 1;
export const SESSION_HOURS_MAX = 24;

export function validateSessionHours(hours: number): string | null {
  if (!Number.isInteger(hours) || hours < SESSION_HOURS_MIN || hours > SESSION_HOURS_MAX) {
    return `A sign-in lasts a whole number of hours, from ${SESSION_HOURS_MIN} to ${SESSION_HOURS_MAX}.`;
  }
  return null;
}

export function validateEscalationRadius(miles: number): string | null {
  if (!Number.isFinite(miles) || miles <= 0) return 'The escalation radius must be more than zero.';
  if (miles > 100) return 'An escalation radius over 100 miles is not a local escalation.';
  return null;
}

/**
 * THC's on-the-day phone number for the Client Portal (ADR-0134 N1). Blank
 * is allowed and hides the line on the portal; otherwise a number as people
 * write it (digits, spaces, +, brackets, dashes, dots), 10–15 digits once a
 * UK "(0)" is dropped — the portal's tap-to-call link rings only that.
 */
export const CLIENT_PORTAL_PHONE_MAX = 30;

export function validateClientPortalPhone(value: string): string | null {
  const phone = value.trim();
  if (phone === '') return null;
  if (phone.length > CLIENT_PORTAL_PHONE_MAX || !/^\+?[\d\s().-]+$/.test(phone)) {
    return 'Enter a phone number, e.g. 020 7946 0000 or +44 20 7946 0000.';
  }
  const digits = phone.replace(/\(0\)/g, '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    return 'A phone number has 10 to 15 digits.';
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * ADR-0175: invoicing. Every value here is printed on, or decides the
 * timing of, an invoice emailed to a client — a wrong sort code is money
 * paid into the wrong account, and the database casts these values
 * (`invoicing_config()`), so a malformed one stops the job outright.
 * ------------------------------------------------------------------ */

/** What `invoicing_config()` falls back to (20261022100000_invoices_sent.sql §2). */
export const INVOICING_DEFAULT_TIME = '10:00';
export const INVOICING_DEFAULT_FIRST_EVENT_DATE = '2026-10-26';
export const INVOICING_DEFAULT_PO_WINDOW_DAYS = 7;
export const INVOICING_DEFAULT_VAT_RATE = 20;
export const INVOICING_DEFAULT_TERMS_DAYS = 7;

export const VAT_RATE_MAX = 100;
export const PAYMENT_TERMS_MAX_DAYS = 120;
export const PO_WINDOW_MIN_DAYS = 1;
export const PO_WINDOW_MAX_DAYS = 31;
/** Longest company/bank line printed on the invoice. */
export const INVOICING_TEXT_MAX = 200;
export const LATE_PAYMENT_NOTE_MAX = 1000;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The send time: "HH:MM" on the 24-hour clock, UK time. */
export function validateInvoiceTime(value: string): string | null {
  return HHMM.test(text(value)) ? null : 'Enter the send time as HH:MM on the 24-hour clock.';
}

/** A real calendar day written YYYY-MM-DD (what UkDateField reports). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(text(value));
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const day = new Date(Date.UTC(y, m - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d;
}

/**
 * Never before go-live: events up to 25.10.2026 were invoiced by hand from
 * the ADR-0172 CSV, so an earlier date would email them a second invoice.
 * `invoicing_config()` holds the same floor in the database.
 */
export function validateFirstEventDate(value: string): string | null {
  if (!isIsoDate(value)) return 'Enter the first invoiced event date as dd/mm/yyyy.';
  return value < INVOICING_DEFAULT_FIRST_EVENT_DATE
    ? 'Invoices start with events on or after 26/10/2026 (go-live); earlier events were invoiced by hand.'
    : null;
}

/** 0–100 %, at most two decimal places (invoices.vat_rate is numeric(5,2)). */
export function validateVatRate(rate: number): string | null {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return 'The VAT rate must be a number.';
  if (rate < 0 || rate > VAT_RATE_MAX)
    return `The VAT rate must be between 0 and ${VAT_RATE_MAX}%.`;
  if (Math.abs(Math.round(rate * 100) - rate * 100) > 1e-6) {
    return 'The VAT rate has at most two decimal places.';
  }
  return null;
}

export function validatePaymentTerms(days: number): string | null {
  if (!Number.isInteger(days) || days < 0 || days > PAYMENT_TERMS_MAX_DAYS) {
    return `Payment terms are a whole number of days, from 0 to ${PAYMENT_TERMS_MAX_DAYS}.`;
  }
  return null;
}

export function validatePoWindow(days: number): string | null {
  if (!Number.isInteger(days) || days < PO_WINDOW_MIN_DAYS || days > PO_WINDOW_MAX_DAYS) {
    return `The PO window is a whole number of days, from ${PO_WINDOW_MIN_DAYS} to ${PO_WINDOW_MAX_DAYS}.`;
  }
  return null;
}

/** UK sort code, written as on THC's invoice: NN-NN-NN. */
export function validateSortCode(value: string): string | null {
  return /^\d{2}-\d{2}-\d{2}$/.test(text(value))
    ? null
    : 'Enter the sort code as NN-NN-NN, e.g. 30-15-99.';
}

/** UK account number: exactly 8 digits. */
export function validateAccountNumber(value: string): string | null {
  return /^\d{8}$/.test(text(value)) ? null : 'The account number is exactly 8 digits.';
}

/** The keys an invoicing problem is reported under — one per field on the screen. */
export type InvoicingField =
  | 'time'
  | 'first_event_date'
  | 'po_window_days'
  | 'vat_rate'
  | 'payment_terms_days'
  | `company.${keyof InvoicingCompany}`
  | `bank.${keyof InvoicingBank}`
  | 'late_payment_note';

/**
 * Every problem with an invoicing draft, by field, in screen order — so the
 * screen can mark each field and the action can refuse with the first.
 */
export function invoicingProblems(
  settings: InvoicingSettings,
): Partial<Record<InvoicingField, string>> {
  const problems: Partial<Record<InvoicingField, string>> = {};
  const add = (field: InvoicingField, problem: string | null) => {
    if (problem && !problems[field]) problems[field] = problem;
  };
  const company = settings.company ?? ({} as InvoicingCompany);
  const bank = settings.bank ?? ({} as InvoicingBank);

  add('time', validateInvoiceTime(settings.time));
  add('first_event_date', validateFirstEventDate(settings.first_event_date));
  add('vat_rate', validateVatRate(settings.vat_rate));
  add('payment_terms_days', validatePaymentTerms(settings.payment_terms_days));
  add('po_window_days', validatePoWindow(settings.po_window_days));

  const required: [InvoicingField, string, unknown][] = [
    ['company.name', 'Company name', company.name],
    ['bank.account_name', 'Account name', bank.account_name],
    ['bank.bank', 'Bank', bank.bank],
  ];
  for (const [field, label, value] of required) {
    if (text(value) === '') add(field, `${label} is required — it is printed on every invoice.`);
  }
  // A VAT invoice must carry the VAT registration number.
  if (validateVatRate(settings.vat_rate) === null && settings.vat_rate > 0) {
    if (text(company.vat_reg) === '') {
      add('company.vat_reg', 'A VAT invoice must show the VAT registration number.');
    }
  }
  const email = text(company.email);
  if (!EMAIL.test(email)) add('company.email', 'The company email is not a valid email address.');
  add('bank.account_number', validateAccountNumber(bank.account_number));
  add('bank.sort_code', validateSortCode(bank.sort_code));

  const lengths: [InvoicingField, string, unknown][] = [
    ['company.name', 'Company name', company.name],
    ['company.company_reg', 'Company registration', company.company_reg],
    ['company.vat_reg', 'VAT registration', company.vat_reg],
    ['company.email', 'Company email', company.email],
    ['company.website', 'Website', company.website],
    ['bank.account_name', 'Account name', bank.account_name],
    ['bank.bank', 'Bank', bank.bank],
  ];
  for (const [field, label, value] of lengths) {
    if (text(value).length > INVOICING_TEXT_MAX) {
      add(field, `${label} is longer than ${INVOICING_TEXT_MAX} characters.`);
    }
  }
  if (typeof settings.late_payment_note !== 'string') {
    add('late_payment_note', 'The late-payment wording must be text.');
  } else if (settings.late_payment_note.trim().length > LATE_PAYMENT_NOTE_MAX) {
    add(
      'late_payment_note',
      `The late-payment wording is longer than ${LATE_PAYMENT_NOTE_MAX} characters.`,
    );
  }
  return problems;
}

export function validateInvoicing(settings: InvoicingSettings): string | null {
  if (typeof settings.enabled !== 'boolean') return 'Choose whether invoices are sent.';
  return Object.values(invoicingProblems(settings))[0] ?? null;
}

/**
 * The stored row as the screen shows it, by the same reading as
 * `invoicing_config()`: off when the row (or `enabled`) is missing, every
 * other value its default, and company/bank details blank rather than
 * invented — the job prints what is stored, so the screen shows that too.
 */
export function readInvoicing(row: unknown): InvoicingSettings {
  const raw = plainObject(row);
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  const num = (value: unknown): number | null => {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };
  const int = (value: unknown): number | null => {
    const n = num(value);
    return n !== null && Number.isInteger(n) ? n : null;
  };
  const company = plainObject(raw['company']);
  const bank = plainObject(raw['bank']);
  const time = str(raw['time']);
  const first = str(raw['first_event_date']);

  return {
    enabled: raw['enabled'] === true || raw['enabled'] === 'true',
    time: HHMM.test(time) ? time : INVOICING_DEFAULT_TIME,
    first_event_date: isIsoDate(first) ? first : INVOICING_DEFAULT_FIRST_EVENT_DATE,
    po_window_days: Math.max(1, int(raw['po_window_days']) ?? INVOICING_DEFAULT_PO_WINDOW_DAYS),
    vat_rate: num(raw['vat_rate']) ?? INVOICING_DEFAULT_VAT_RATE,
    payment_terms_days: int(raw['payment_terms_days']) ?? INVOICING_DEFAULT_TERMS_DAYS,
    company: {
      name: str(company['name']),
      company_reg: str(company['company_reg']),
      vat_reg: str(company['vat_reg']),
      email: str(company['email']),
      website: str(company['website']),
    },
    bank: {
      account_name: str(bank['account_name']),
      bank: str(bank['bank']),
      account_number: str(bank['account_number']),
      sort_code: str(bank['sort_code']),
    },
    late_payment_note: str(raw['late_payment_note']),
  };
}

/**
 * The row to write: the validated draft, trimmed, laid over what is stored
 * so a key this screen does not know (top level, or inside company/bank)
 * survives the save.
 */
export function mergeInvoicing(stored: unknown, draft: InvoicingSettings): Record<string, unknown> {
  const current = plainObject(stored);
  return {
    ...current,
    enabled: draft.enabled,
    time: text(draft.time),
    first_event_date: text(draft.first_event_date),
    po_window_days: draft.po_window_days,
    vat_rate: draft.vat_rate,
    payment_terms_days: draft.payment_terms_days,
    company: {
      ...plainObject(current['company']),
      name: text(draft.company.name),
      company_reg: text(draft.company.company_reg),
      vat_reg: text(draft.company.vat_reg),
      email: text(draft.company.email),
      website: text(draft.company.website),
    },
    bank: {
      ...plainObject(current['bank']),
      account_name: text(draft.bank.account_name),
      bank: text(draft.bank.bank),
      account_number: text(draft.bank.account_number),
      sort_code: text(draft.bank.sort_code),
    },
    late_payment_note: text(draft.late_payment_note),
  };
}
