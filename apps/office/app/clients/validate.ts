import { isPhone } from '@thc/domain';
import type { ClientDraft } from './types';

/**
 * The form's half of §9.7's rules. `assert_client_input` rejects the same
 * drafts in the database (supabase/tests/280_clients_directory.sql,
 * 822_editing_safety_caps_and_pay_floor.sql).
 *
 * §9.7 is unusually absolute about this screen: "All fields on this form
 * are mandatory — none can be skipped." So every field has a presence
 * check, and the two policies are booleans with no third state. Release
 * audit D-M2 added what a present value must also be: a phone that is a
 * phone (UK or international — `isPhone`, the onboarding form's own
 * test), and names that fit (D-M3).
 */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The `contact_emails` column is `check (array_length between 1 and 10)` (ADR-0087). */
export const MAX_CONTACT_EMAILS = 10;

/** clients_name_length and assert_client_input (20261014180000). */
export const CLIENT_NAME_MAX = 120;
export const CONTACT_NAME_MAX = 120;
export const CONTACT_POINT_MAX = 200;

export type ClientField =
  | 'name'
  | 'contact_name'
  | 'phone'
  | 'staff_contact_point'
  | 'contact_emails'
  | 'invoice_emails'
  | 'invoice_cc_emails';

/** `clients_invoice_emails_max`: at most ten invoice addresses (THC, 21.10.2026). */
export const MAX_INVOICE_EMAILS = 10;

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

/** create_client's own limits on the optional invoicing fields (20261022130000). */
export const ACCOUNTS_CONTACT_MAX = 200;
export const BILLING_ADDRESS_MAX = 1000;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/**
 * What is wrong with each field, in the order the form shows them. A
 * field that is right has no entry. `creating`: a new client must also say
 * where its invoices go (ADR-0176, THC 21.10.2026) — `create_client`
 * refuses one with no invoice email.
 */
export function clientFieldErrors(
  draft: ClientDraft,
  creating = false,
): Partial<Record<ClientField, string>> {
  const errors: Partial<Record<ClientField, string>> = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Give the client a name.';
  else if (name.length > CLIENT_NAME_MAX) {
    errors.name = `A client name is at most ${CLIENT_NAME_MAX} characters.`;
  }

  const contact = draft.contact_name.trim();
  if (!contact) errors.contact_name = 'Enter the contact’s full name.';
  else if (contact.length > CONTACT_NAME_MAX) {
    errors.contact_name = `A contact name is at most ${CONTACT_NAME_MAX} characters.`;
  }

  const phone = draft.phone.trim();
  if (!phone) errors.phone = 'Enter a contact phone number.';
  else if (!isPhone(phone)) {
    errors.phone = 'Enter a phone number, e.g. 020 7946 0000 or +44 20 7946 0000.';
  }

  const point = draft.staff_contact_point.trim();
  if (!point) {
    // It is pre-filled into every event built for this client (§3.2), so a
    // blank one is every future allocation sheet missing who to ask for.
    errors.staff_contact_point =
      'Enter the staff contact point — the on-site contact staff see at the venue.';
  } else if (point.length > CONTACT_POINT_MAX) {
    errors.staff_contact_point = `The staff contact point is at most ${CONTACT_POINT_MAX} characters.`;
  }

  if (draft.contact_emails.length === 0) {
    errors.contact_emails =
      'Add at least one contact email: the Allocation Timesheet and the Completed Allocation Timesheet go to these.';
  } else if (draft.contact_emails.length > MAX_CONTACT_EMAILS) {
    errors.contact_emails = `Up to ${MAX_CONTACT_EMAILS} contact emails.`;
  } else {
    const bad = draft.contact_emails.find((email) => !isEmail(email));
    if (bad) errors.contact_emails = `“${bad}” is not an email address.`;
  }

  if (creating) {
    const invoice = normaliseInvoiceEmails(draft.invoicing?.invoice_emails ?? []);
    if (invoice.length === 0) {
      errors.invoice_emails =
        'Add at least one invoice email: the invoice and the sign-in and sign-out log go to these.';
    } else if (invoice.length > MAX_INVOICE_EMAILS) {
      errors.invoice_emails = `Up to ${MAX_INVOICE_EMAILS} invoice emails.`;
    } else {
      const bad = invoice.find((email) => !isEmail(email));
      if (bad) errors.invoice_emails = `“${bad}” is not an email address.`;
    }
    const cc = normaliseInvoiceEmails(draft.invoicing?.invoice_cc_emails ?? []);
    if (cc.length > MAX_INVOICE_EMAILS) {
      errors.invoice_cc_emails = `Up to ${MAX_INVOICE_EMAILS} CC emails.`;
    } else {
      const bad = cc.find((email) => !isEmail(email));
      if (bad) errors.invoice_cc_emails = `“${bad}” is not an email address.`;
    }
  }
  return errors;
}

/** The first problem, for the server action's single message. */
export function validateClient(draft: ClientDraft, creating = false): string | null {
  const errors = clientFieldErrors(draft, creating);
  const first = (
    [
      'name',
      'contact_name',
      'phone',
      'staff_contact_point',
      'contact_emails',
      'invoice_emails',
      'invoice_cc_emails',
    ] as const
  ).find((field) => errors[field]);
  return first ? errors[first]! : null;
}
