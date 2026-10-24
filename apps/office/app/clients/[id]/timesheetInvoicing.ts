import { type DbError, explainDbError } from '../../_lib/dbError';
import type { TimesheetInvoicingSettings } from './types';

/**
 * The Timesheet invoicing panel's rules (ADR-0210). Pure, so the server
 * actions and the panel share them and a test can drive them directly.
 *
 * The database is the gate — `set_client_timesheet_invoicing()` trims,
 * de-duplicates and refuses a bad mode, format or terms, and `timesheet_rates`
 * carries its own checks (a role name, a non-negative rate, one row per role
 * per client) — and these say the same thing before the round trip.
 */

export const TERMS_MIN = 0;
export const TERMS_MAX = 120;
export const MAX_EXCLUDED_STAFF = 200;
export const MAX_ALIASES = 20;
export const NAME_MAX = 200;
export const ADDRESS_MAX = 1000;
export const LABEL_MAX = 40;
export const ROLE_MAX = 120;
/** `numeric(8,2)`: six digits before the point. */
export const RATE_MAX = 999_999.99;

export type InvoicingMode = 'events' | 'timesheet';
export type InvoiceFormat = 'named' | 'aggregated';

export const MODE_LABEL: Readonly<Record<InvoicingMode, string>> = {
  events: 'Events — invoiced from the sign-in log',
  timesheet: 'Timesheet — invoiced from an uploaded timesheet',
};
export const FORMAT_LABEL: Readonly<Record<InvoiceFormat, string>> = {
  named: 'Named staff — one line per person',
  aggregated: 'Role aggregated — the same lines without names',
};

/** Trim, drop blanks, de-duplicate ignoring case (first spelling wins). */
export function normaliseList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const key = text.toLowerCase();
    if (text && !seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

/** "Waiting Staff, KP ; Team Lead" → ["Waiting Staff", "KP", "Team Lead"]. */
export function splitList(text: string): string[] {
  return normaliseList(String(text ?? '').split(/[,;\n]/));
}

/** Blank → null (the default terms); otherwise a whole number of days. */
export function parseTerms(text: string): number | null | 'invalid' {
  const value = String(text ?? '').trim();
  if (value === '') return null;
  if (!/^\d{1,3}$/.test(value)) return 'invalid';
  const days = Number(value);
  return days >= TERMS_MIN && days <= TERMS_MAX ? days : 'invalid';
}

export interface TimesheetSettingsInput {
  mode: InvoicingMode;
  format: InvoiceFormat;
  displayName: string;
  venue: string;
  venueAddress: string;
  dateLabel: string;
  omitEventDates: boolean;
  defaultRole: string;
  excludedStaff: string[];
  poRequired: boolean;
  /** Null = the platform default. */
  paymentTermsDays: number | null;
}

/** Why these settings cannot be saved, or null when they can. */
export function settingsProblem(input: TimesheetSettingsInput): string | null {
  if (input.mode !== 'events' && input.mode !== 'timesheet')
    return 'Choose how this client is invoiced.';
  if (input.format !== 'named' && input.format !== 'aggregated') return 'Choose an invoice format.';
  if (input.displayName.length > NAME_MAX)
    return `The display name is at most ${NAME_MAX} characters.`;
  if (input.venue.length > NAME_MAX) return `The venue is at most ${NAME_MAX} characters.`;
  if (input.venueAddress.length > ADDRESS_MAX)
    return `The venue address is at most ${ADDRESS_MAX} characters.`;
  if (input.dateLabel.length > LABEL_MAX)
    return `The date column header is at most ${LABEL_MAX} characters.`;
  if (input.defaultRole.length > ROLE_MAX)
    return `The default role is at most ${ROLE_MAX} characters.`;
  if (normaliseList(input.excludedStaff).length > MAX_EXCLUDED_STAFF) {
    return `At most ${MAX_EXCLUDED_STAFF} excluded names.`;
  }
  const tooLong = input.excludedStaff.find((name) => name.length > NAME_MAX);
  if (tooLong) return `“${tooLong.slice(0, 30)}…” is too long for a name.`;
  const days = input.paymentTermsDays;
  if (days !== null && (!Number.isInteger(days) || days < TERMS_MIN || days > TERMS_MAX)) {
    return `Payment terms are a whole number of days from ${TERMS_MIN} to ${TERMS_MAX}, or blank for the default.`;
  }
  return null;
}

/**
 * The default role has to name a role on the rate card (or one of its
 * aliases), or a timesheet without a role column would get no rate. Warned
 * about, not refused: the rate card is edited beside it.
 */
export function defaultRoleOnCard(
  defaultRole: string,
  rates: readonly { role_name: string; aliases: string[] }[],
): boolean {
  const want = defaultRole.trim().toLowerCase();
  if (!want) return true;
  return rates.some(
    (rate) =>
      rate.role_name.trim().toLowerCase() === want ||
      rate.aliases.some((alias) => alias.trim().toLowerCase() === want),
  );
}

export interface RateInput {
  roleName: string;
  aliases: string[];
  chargeRate: number;
}

/** "18.98", "£18.98" → 18.98; anything else → null. */
export function parseRate(text: string): number | null {
  const value = String(text ?? '')
    .replace(/^£/, '')
    .trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(value)) return null;
  return Number(value);
}

export function rateProblem(input: RateInput): string | null {
  const role = input.roleName.trim();
  if (role === '') return 'Name the role as it appears on the timesheet.';
  if (role.length > ROLE_MAX) return `The role name is at most ${ROLE_MAX} characters.`;
  if (!Number.isFinite(input.chargeRate) || input.chargeRate < 0)
    return 'The charge rate cannot be negative.';
  if (input.chargeRate > RATE_MAX) return 'That charge rate is too large.';
  if (Math.round(input.chargeRate * 100) / 100 !== input.chargeRate) {
    return 'The charge rate is in pounds and pence, e.g. 18.98.';
  }
  const aliases = normaliseList(input.aliases);
  if (aliases.length > MAX_ALIASES) return `At most ${MAX_ALIASES} aliases for one role.`;
  if (aliases.some((alias) => alias.length > ROLE_MAX))
    return `An alias is at most ${ROLE_MAX} characters.`;
  return null;
}

/** An alias that repeats the role's own name adds nothing and is dropped. */
export function cleanAliases(roleName: string, aliases: readonly string[]): string[] {
  const own = roleName.trim().toLowerCase();
  return normaliseList(aliases).filter((alias) => alias.toLowerCase() !== own);
}

const WORDING = {
  unique: 'That role is already on this client’s timesheet rate card. Edit its row instead.',
  foreignKey: 'That client no longer exists. Refresh the page.',
  codes: {
    not_permitted: 'Only an owner or a manager with finance can change invoicing. Ask an owner.',
    invalid_invoicing_mode: 'Choose how this client is invoiced.',
    invalid_invoice_format: 'Choose an invoice format.',
    invalid_payment_terms: `Payment terms are a whole number of days from ${TERMS_MIN} to ${TERMS_MAX}, or blank for the default.`,
    unknown_client: 'That client no longer exists. Refresh the page.',
  },
  log: '[client card · timesheet invoicing]',
};

/** The database's refusal, in words a manager can act on. */
export function timesheetInvoicingProblem(error: DbError | string): string {
  return explainDbError(error, WORDING);
}

/** What the panel shows for a client that has never been set up. */
export const DEFAULT_SETTINGS: TimesheetInvoicingSettings = {
  mode: 'events',
  format: 'named',
  displayName: null,
  venue: null,
  venueAddress: null,
  dateLabel: null,
  omitEventDates: false,
  defaultRole: null,
  excludedStaff: [],
  poRequired: false,
  paymentTermsDays: null,
  xeroContactId: null,
};
