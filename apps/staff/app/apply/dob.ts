/**
 * Typing a date of birth as digits (ADR-0063).
 *
 * The field shows `DD/MM/YYYY` (UK order, §1.8) and inserts the slashes
 * itself, so "05061998" reads back as "05/06/1998". A slash typed after a
 * single digit pads it ("5/6/1998" → "05/06/1998"). Browser autofill for
 * `bday` may hand over `1998-06-05`, which is turned round the same way.
 *
 * The form's value stays what it always was — `yyyy-mm-dd`, the shape
 * `parseDob()` and `submit_application()` read (ADR-0008). A complete entry
 * becomes that shape even when the day does not exist (31/02 → `…-02-31`),
 * so `validate()` still says "Enter a real date"; a half-typed one is
 * passed through as typed, which `validate()` refuses the same way.
 */

/** What the text box shows, re-formatted from whatever was typed or pasted. */
export function formatDobTyping(raw: string): string {
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(raw);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  const parts: string[] = [];
  let current = '';
  let trailingSlash = false;
  for (const ch of raw) {
    if (parts.length === 3) break;
    if (/\d/.test(ch)) {
      trailingSlash = false;
      current += ch;
      const full = parts.length < 2 ? current.length === 2 : current.length === 4;
      if (full) {
        parts.push(current);
        current = '';
      }
    } else if (/[/.\-\s]/.test(ch)) {
      if (current.length === 1 && parts.length < 2) {
        parts.push(`0${current}`);
        current = '';
      }
      // Only a slash typed straight after a complete day or month is kept,
      // so it can be seen; the next digit would have added it anyway.
      trailingSlash = current === '' && parts.length > 0 && parts.length < 3;
    }
  }
  const shown = [...parts, current].filter(Boolean).join('/');
  return trailingSlash ? `${shown}/` : shown;
}

/** The form's value for what the box shows: `yyyy-mm-dd` once complete. */
export function dobValueFrom(shown: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(shown);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : shown;
}

/** What the box shows for a stored value (`yyyy-mm-dd`, or a half-typed one). */
export function dobShownFrom(value: string): string {
  return formatDobTyping(value);
}
