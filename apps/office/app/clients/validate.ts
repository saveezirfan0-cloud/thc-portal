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

/** clients_name_length and assert_client_input (20261014160000). */
export const CLIENT_NAME_MAX = 120;
export const CONTACT_NAME_MAX = 120;
export const CONTACT_POINT_MAX = 200;

export type ClientField =
  'name' | 'contact_name' | 'phone' | 'staff_contact_point' | 'contact_emails';

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/**
 * What is wrong with each field, in the order the form shows them. A
 * field that is right has no entry.
 */
export function clientFieldErrors(draft: ClientDraft): Partial<Record<ClientField, string>> {
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
  return errors;
}

/** The first problem, for the server action's single message. */
export function validateClient(draft: ClientDraft): string | null {
  const errors = clientFieldErrors(draft);
  const first = (
    ['name', 'contact_name', 'phone', 'staff_contact_point', 'contact_emails'] as const
  ).find((field) => errors[field]);
  return first ? errors[first]! : null;
}
