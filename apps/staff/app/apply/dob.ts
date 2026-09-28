/**
 * Typing a date of birth as digits (ADR-0068).
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
 *
 * The three functions live in packages/domain (`dob.ts`) since ADR-0070, so
 * the Back Office's "Correct date of birth" dialog types a date exactly as
 * /apply does; this file keeps the Staff App's imports where they were.
 */
export { dobShownFrom, dobValueFrom, formatDobTyping } from '@thc/domain';
