import { type DbError, explainDbError } from '../../_lib/dbError';
import { MAX_INVOICE_EMAILS, isEmail, normaliseInvoiceEmails } from '../validate';

export { MAX_INVOICE_EMAILS, normaliseInvoiceEmails };

/**
 * The Invoicing panel's rules (ADR-0176). Pure, so the server action and
 * the panel share them and a test can drive them directly.
 *
 * The database is the gate — `set_client_invoice_details()` trims,
 * lower-cases, de-duplicates and drops blanks, refuses an eleventh address and
 * anything that is not an address — and these say the same thing before
 * the round trip, and turn its refusals into sentences.
 */

/** Shown under the invoice emails, and in their place when there are none. */
export const INVOICE_EMAILS_HINT =
  'Empty: invoices go to the main contact — the allocation emails above';

/** Why these addresses cannot be saved, or null when they can. */
export function invoiceEmailsProblem(
  emails: readonly string[],
  noun = 'invoice emails',
): string | null {
  const list = normaliseInvoiceEmails(emails);
  if (list.length > MAX_INVOICE_EMAILS) return tooMany(noun);
  const bad = list.find((email) => !isEmail(email));
  return bad ? notAnEmail(bad) : null;
}

const tooMany = (noun = 'invoice emails') =>
  `Up to ${MAX_INVOICE_EMAILS} ${noun}. Remove one before adding another.`;
const notAnEmail = (email: string) =>
  `“${email}” is not an email address. Check it and save again.`;

const WORDING = {
  codes: {
    not_permitted: 'Your login cannot change invoicing details. Ask an owner or a manager.',
    too_many_invoice_emails: `Up to ${MAX_INVOICE_EMAILS} invoice emails and ${MAX_INVOICE_EMAILS} CC emails. Remove one before adding another.`,
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
