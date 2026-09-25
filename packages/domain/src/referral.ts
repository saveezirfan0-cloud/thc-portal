/**
 * Refer a friend — ADR-0040, docs/18 §5 (an addition to Scope v1.6: §2.1
 * `/apply?ref=`, §2.3, §9.6, §10.1, §1.7 privacy notice, §1.5).
 *
 * A compliant worker gets one code (`staff_referral_codes`), minted lazily
 * by `my_referral_code()`. An application that arrives with it is recorded
 * in `application_referrals`. There is no reward and no money: nothing
 * here reaches `packages/pdf`, reports or payroll (Q19). The referrer sees a
 * count only and the applicant never sees who referred them (Q20).
 */

/**
 * Eight characters from an alphabet with no I, O, 0 or 1, so a code read
 * aloud or copied by hand cannot be mistyped into another one. The same
 * pattern is `staff_referral_codes_code` in SQL.
 */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;
export const REFERRAL_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

export function isReferralCode(value: string): boolean {
  return REFERRAL_CODE_PATTERN.test(value);
}

/**
 * What `/apply?ref=` passes on: trimmed and upper-cased, or null when it
 * cannot be a code. A bad code is dropped silently — the application still
 * goes through and the applicant is told nothing (docs/18 §5, 681).
 */
export function normaliseReferralCode(value: string | null | undefined): string | null {
  const code = (value ?? '').trim().toUpperCase();
  return isReferralCode(code) ? code : null;
}

/** The link the worker shares: `{origin}/apply?ref={code}`. */
export function referralLink(origin: string, code: string): string {
  if (!isReferralCode(code)) throw new RangeError(`Not a referral code: ${code}`);
  return `${origin.replace(/\/+$/, '')}/apply?ref=${code}`;
}
