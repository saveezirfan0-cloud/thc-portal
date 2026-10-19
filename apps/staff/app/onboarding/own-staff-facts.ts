import type { HmrcGender } from '@thc/domain';

/**
 * What the onboarding steps read from the caller's own `staff` row: the
 * gender (step 7), the languages (step 2) and the SpudBros Express pair
 * (the banner on every step, and step 11). Read in one select by
 * `loadOwnStaffFacts` (./data.ts); this is the mapping, and each field's
 * fallback when the row cannot be read.
 */
export interface OwnStaffFacts {
  /**
   * Null when unanswered or unreadable. The form then asks, and the
   * database refuses a checklist without it.
   */
  gender: HmrcGender | null;
  /** Null when never answered or unreadable. Step 2 then starts from English alone (ADR-0080). */
  languages: string[] | null;
  /**
   * SpudBros Express staff whose THC shifts are not switched on (ADR-0106).
   * False when unreadable. The ordinary last step then shows, which is the
   * wording that is wrong for them but never one that withholds anything.
   */
  onboardingOnly: boolean;
}

export const NO_OWN_STAFF_FACTS: OwnStaffFacts = {
  gender: null,
  languages: null,
  onboardingOnly: false,
};

export function toOwnStaffFacts(row: Record<string, unknown> | null | undefined): OwnStaffFacts {
  if (!row) return NO_OWN_STAFF_FACTS;
  const gender = row['gender'];
  const languages = row['languages'];
  return {
    gender: gender === 'M' || gender === 'F' ? gender : null,
    languages: Array.isArray(languages)
      ? languages.filter((l): l is string => typeof l === 'string')
      : null,
    onboardingOnly: row['spudbros_express'] === true && row['thc_shifts_enabled'] !== true,
  };
}
