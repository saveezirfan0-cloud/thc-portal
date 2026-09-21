import type { ClientDraft } from './types';

/**
 * The form's half of §9.7's rules. `assert_client_input` rejects the same
 * drafts in the database (supabase/tests/140_clients_directory.sql).
 *
 * §9.7 is unusually absolute about this screen: "All fields on this form
 * are mandatory — none can be skipped." So every check below is a
 * presence check, and the two policies are booleans with no third state.
 */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The `contact_emails` column is `check (array_length between 1 and 5)`. */
export const MAX_CONTACT_EMAILS = 5;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

export function validateClient(draft: ClientDraft): string | null {
  if (!draft.name.trim()) return 'Give the client a name.';
  if (!draft.contact_name.trim()) return 'Enter the contact’s full name.';
  if (!draft.phone.trim()) return 'Enter a contact phone number.';
  if (!draft.staff_contact_point.trim()) {
    // It is pre-filled into every event built for this client (§3.2), so a
    // blank one is every future allocation sheet missing who to ask for.
    return 'Enter the staff contact point — the on-site contact staff see at the venue.';
  }
  if (draft.contact_emails.length === 0) {
    return 'Add at least one contact email: the allocation sheet and the timesheet go to these.';
  }
  if (draft.contact_emails.length > MAX_CONTACT_EMAILS) {
    return `Up to ${MAX_CONTACT_EMAILS} contact emails.`;
  }
  const bad = draft.contact_emails.find((email) => !isEmail(email));
  if (bad) return `“${bad}” is not an email address.`;
  return null;
}
