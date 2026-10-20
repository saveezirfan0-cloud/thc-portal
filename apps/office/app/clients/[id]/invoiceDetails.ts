import { type DbError, explainDbError } from '../../_lib/dbError';
import { isEmail } from '../validate';

/**
 * The Invoicing panel's rules (ADR-0175). Pure, so the server action and
 * the panel share them and a test can drive them directly.
 *
 * The database is the gate — `set_client_invoice_details()` trims,
 * lower-cases, de-duplicates and drops blanks, refuses a sixth address and
 * anything that is not an address — and these say the same thing before
 * the round trip, and turn its refusals into sentences.
 */

/** `clients_invoice_emails_max`: at most five invoice addresses. */
export const MAX_INVOICE_EMAILS = 5;

/** Shown under the invoice emails, and in their place when there are none. */
export const INVOICE_EMAILS_HINT = 'Empty: invoices go to the contact emails above';

/** What the database stores: trimmed, lower-cased, de-duplicated, no blanks. */
export function normaliseInvoiceEmails(emails: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const email of emails) {
    const value = String(email ?? '')
      .trim()
      .toLowerCase();
    if (value) seen.add(value);
  }
  return [...seen];
}

/** Why these addresses cannot be saved, or null when they can. */
export function invoiceEmailsProblem(emails: readonly string[]): string | null {
  const list = normaliseInvoiceEmails(emails);
  if (list.length > MAX_INVOICE_EMAILS) return tooMany();
  const bad = list.find((email) => !isEmail(email));
  return bad ? notAnEmail(bad) : null;
}

const tooMany = () =>
  `Up to ${MAX_INVOICE_EMAILS} invoice emails. Remove one before adding another.`;
const notAnEmail = (email: string) =>
  `“${email}” is not an email address. Check it and save again.`;

const WORDING = {
  codes: {
    not_permitted:
      'Your login cannot change invoicing details. Ask an owner, a manager or a scheduler.',
    too_many_invoice_emails: tooMany(),
    unknown_client: 'That client no longer exists. Refresh the page.',
  },
  log: '[client card · invoicing]',
};

/**
 * `set_client_invoice_details()`'s refusals, in words a manager can act
 * on. `invalid_invoice_email` carries the address in its detail, so the
 * sentence names it; `admins_only` is the shared "not allowed" sentence.
 */
export function invoiceDetailsProblem(error: DbError | string): string {
  const err: DbError = typeof error === 'string' ? { message: error } : error;
  const token = (err.message ?? '').trim().split(/[:\s]/)[0] ?? '';
  if (token === 'invalid_invoice_email') {
    const address = (err.details ?? '').trim();
    return address
      ? notAnEmail(address)
      : 'One of the invoice emails is not an email address. Check them and save again.';
  }
  return explainDbError(err, WORDING);
}
