/**
 * The Home Office reference — ADR-0177 (THC, 21.10.2026), the sixth
 * right-to-work branch.
 *
 * A worker whose right to work is confirmed by the Home Office's Employer
 * Checking Service (an asylum seeker with permission to work, a pending
 * application or appeal, section 3C leave) has no share code. Step 1 asks
 * instead for the reference the office puts on its Employer Checking
 * Service form: the Application Registration Card (ARC) number, or the
 * Home Office application reference.
 *
 * Those come in several shapes (ABC123456, U1234567/001, a 16-digit number
 * with dashes, GWF012345678), so this is a shape check only — the office
 * checks the reference itself with the Home Office:
 *
 *   - trimmed, inner runs of spaces collapsed to one, upper case;
 *   - 6–30 characters: letters, digits, spaces, "/" or "-", starting and
 *     ending with a letter or digit;
 *   - at least one digit.
 *
 * The same rule is in SQL (`normalise_home_office_ref()` /
 * `is_valid_home_office_ref()`, migration 20261022140100), because the
 * database refuses a malformed reference even when the call does not come
 * through this app. `homeOfficeRef.test.ts` holds the two to the same
 * literal, and pgTAP 911 runs the same examples against the SQL.
 */

/** The pattern as the SQL migration spells it — asserted equal in tests. */
export const HOME_OFFICE_REF_SQL_PATTERN = '^[A-Z0-9][A-Z0-9 /-]{4,28}[A-Z0-9]$';

const HOME_OFFICE_REF_PATTERN = new RegExp(HOME_OFFICE_REF_SQL_PATTERN);

/** "  abc 123456 " → "ABC 123456". The form the database stores. */
export function normaliseHomeOfficeRef(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function isValidHomeOfficeRef(raw: string | null | undefined): boolean {
  const ref = normaliseHomeOfficeRef(raw);
  return HOME_OFFICE_REF_PATTERN.test(ref) && /[0-9]/.test(ref);
}

/** The field's error line, or null when the reference is fine. */
export function homeOfficeRefError(raw: string | null | undefined): string | null {
  if (normaliseHomeOfficeRef(raw) === '') return 'Enter your Home Office reference.';
  if (isValidHomeOfficeRef(raw)) return null;
  return 'Enter the reference exactly as the Home Office wrote it — letters and numbers, e.g. the number on your ARC card.';
}

// ---------------------------------------------------------------------
// The result's six months (THC, 22.10.2026)
// ---------------------------------------------------------------------

/** "Valid for 6 months from the date it was approved." */
export const HOME_OFFICE_CHECK_MONTHS = 6;

/**
 * The right-to-work-until a Home Office check result gives by default: six
 * months from the date approved printed on it — the same day of the month,
 * clamped to the end of a shorter month (31.08.2026 → 28.02.2027), which is
 * how PostgreSQL adds `interval '6 months'`. The SQL twin is
 * `home_office_check_until()` (migration 20261022140100); pgTAP 912 runs the
 * same vectors there. Null for anything that is not a real ISO date.
 */
export function homeOfficeCheckUntil(approvedIso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(approvedIso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }
  const total = mo - 1 + HOME_OFFICE_CHECK_MONTHS;
  const ty = y + Math.floor(total / 12);
  const tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
