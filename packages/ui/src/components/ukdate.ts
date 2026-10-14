import { formatDobTyping, isRealIsoDate } from '@thc/domain';

/**
 * A calendar date as a UK reader types it: dd/mm/yyyy (§1.8), whatever the
 * device's own locale is.
 *
 * A native `<input type="date">` draws its value in the browser's locale,
 * so on a US-English device a "(UK date)" box read mm/dd/yyyy — the same
 * trap CLAUDE.md names for `<input type="time">`. The field is text instead
 * (`UkDateField`), and these pure functions turn what it shows into the
 * `yyyy-mm-dd` an address bar, a form and the database read, and back.
 *
 * The typing itself — digits in, slashes drawn, "5/6" padded to "05/06",
 * a pasted `2026-10-16` turned round — is `formatDobTyping` from
 * `@thc/domain`, the same as the Staff App's date of birth (ADR-0068), so a
 * date is typed the same way in all three apps.
 *
 * Moved here from the Client Portal (ADR-0133's list filters) so the Back
 * Office's date filters and dated fields use the same box (ADR-0138).
 */

export const UK_DATE_PLACEHOLDER = 'dd/mm/yyyy';

const SHOWN = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** What the box shows for a `yyyy-mm-dd` value: "16/10/2026", or '' for none. */
export function ukDateText(iso: string): string {
  const m = ISO.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** What the box shows after a keystroke or a paste (`formatDobTyping`). */
export function typeUkDate(raw: string): string {
  return formatDobTyping(raw);
}

export type UkDateReading =
  /** A real day (`yyyy-mm-dd`), or '' when the box is empty. */
  | { value: string }
  /** Still being typed: nothing to apply yet, nothing to complain about. */
  | { partial: true }
  /** Complete but not a date: the sentence the field shows. */
  | { error: string };

export const UK_DATE_FORMAT_ERROR = 'Enter the date as dd/mm/yyyy, for example 16/10/2026.';

/**
 * What the box holds. `final` is true once the reader has left the field
 * (blur): an entry still short of dd/mm/yyyy is then an error rather than
 * work in progress.
 */
export function readUkDate(text: string, final = false): UkDateReading {
  const shown = typeUkDate(text.trim());
  if (shown === '') return { value: '' };
  const m = SHOWN.exec(shown);
  if (!m) return final ? { error: UK_DATE_FORMAT_ERROR } : { partial: true };
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm}-${dd}`;
  if (Number(mm) < 1 || Number(mm) > 12) {
    return { error: `There is no month ${mm} — enter the date as dd/mm/yyyy.` };
  }
  if (!isRealIsoDate(iso)) return { error: `${shown} is not a date — check the day and month.` };
  return { value: iso };
}
