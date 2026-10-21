import {
  OFFICE_COPY_MAX,
  OFFICE_COPY_SETTING_KEY,
  isOfficeCopyAddress,
  normaliseAddresses,
  readOfficeCopy,
} from '@thc/notifications';

/**
 * ADR-0179: the "Office copy of timesheets" block — who gets a hidden copy
 * (BCC) of every Allocation Timesheet and Completed Timesheet sent to a
 * client. `settings.document_office_copy` = `{ "emails": [...] }`; the
 * database guard (20261022160000) refuses anything this does not.
 *
 * Kept out of validate.ts and actions.ts so the block is one self-contained
 * slice of the screen.
 */

export { OFFICE_COPY_MAX, OFFICE_COPY_SETTING_KEY, readOfficeCopy };

/** What the box holds: addresses one per line, or separated by commas, semicolons or spaces. */
export function splitAddresses(text: string): string[] {
  return normaliseAddresses(text.split(/[\s,;]+/));
}

/** The box as typed → the list to save, or the one sentence that says why not. */
export function validateOfficeCopy(
  text: string,
): { ok: true; emails: string[] } | { ok: false; message: string } {
  const emails = splitAddresses(text);
  const bad = emails.find((address) => !isOfficeCopyAddress(address));
  if (bad) return { ok: false, message: `“${bad}” is not a valid email address.` };
  if (emails.length > OFFICE_COPY_MAX) {
    return { ok: false, message: `Up to ${OFFICE_COPY_MAX} addresses can get the office copy.` };
  }
  return { ok: true, emails };
}

/** The list as the box shows it: one address per line. */
export function officeCopyText(emails: readonly string[]): string {
  return emails.join('\n');
}
