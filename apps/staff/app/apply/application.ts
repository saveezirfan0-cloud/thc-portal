/**
 * The /apply form's rules, with no React and no database in them (§2.1).
 *
 * The same module runs twice: in the browser, so the form can reject an
 * under-18 "on the spot" the way the wireframe shows, and in the server
 * action before it reaches the database. The database repeats the age and
 * consent checks a third time in `submit_application` (the public application migration),
 * because §1.7 asks for the age gate "on the form and on the backend" and
 * a form is not a security boundary.
 *
 * Wireframe: `wireframes/public/apply.html`.
 */

import { country, DEFAULT_ISO } from './countries';

// ---------------------------------------------------------------------
// Date of birth (§2.1 as amended, §2.12) — see docs/adr/0006
//
// §2.1 asks for an age band. §2.12 matches returning applicants on mobile
// + date of birth, which a band cannot satisfy. THC settled it: the form
// collects the date, and the band is derived from it rather than asked
// separately, so the two can never disagree.
// ---------------------------------------------------------------------

/** The §2.1 band, kept on the application row, computed never typed. */
export function ageBandFor(age: number): string {
  if (age <= 30) return String(age);
  if (age <= 40) return '31_40';
  if (age <= 50) return '41_50';
  if (age <= 60) return '51_60';
  return '60_plus';
}

/**
 * Completed years on `on`, which defaults to today.
 *
 * Every rule in this system is evaluated in UK time (§1.8). A date of
 * birth carries no zone, so this is plain calendar arithmetic: the
 * birthday has happened this year only if the month and day have passed.
 */
export function ageOn(dob: Date, on: Date = new Date()): number {
  let age = on.getFullYear() - dob.getFullYear();
  const monthDelta = on.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getDate() < dob.getDate())) age -= 1;
  return age;
}

/**
 * Parses the `yyyy-mm-dd` an <input type="date"> produces.
 *
 * Built from the parts rather than `new Date(string)`, which parses a
 * bare date as UTC and would shift it a day for anyone west of Greenwich,
 * and which happily accepts 2007-02-31 by rolling into March. The
 * round-trip check below is what rejects a day that does not exist.
 */
export function parseDob(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** The oldest date the form will treat as a real applicant rather than a typo. */
export const MAX_AGE = 100;

// ---------------------------------------------------------------------
// Mobile (§2.1 "Mobile (international picker)", stored in E.164)
// ---------------------------------------------------------------------

/** E.164: '+', a non-zero country digit, then 7–15 digits in total. */
const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Builds the E.164 number the record stores from the picker and whatever
 * the applicant typed.
 *
 * Two things people actually do are handled: typing the national number
 * with its trunk prefix ("07700 900123" in the UK), and pasting a full
 * international number into the number field. Anything else that does not
 * come out as E.164 is rejected rather than guessed at.
 */
export function toE164(iso: string, typed: string): string | null {
  const raw = typed.trim();
  if (raw === '') return null;

  // A pasted international number wins over the picker: it is more
  // specific, and the two disagreeing is the applicant's own correction.
  if (raw.startsWith('+') || raw.startsWith('00')) {
    const digits = raw.replace(/\D/g, '').replace(/^00/, '');
    const e164 = `+${digits}`;
    return E164.test(e164) ? e164 : null;
  }

  const dial = country(iso)?.dial;
  if (!dial) return null;

  // Drop the trunk prefix: 07700 900123 dials as +44 7700 900123.
  const national = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (national === '') return null;

  const e164 = `+${dial}${national}`;
  return E164.test(e164) ? e164 : null;
}

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

export interface ApplicationDraft {
  firstName: string;
  lastName: string;
  email: string;
  /** ISO 3166-1 alpha-2 from the picker. */
  country: string;
  /** The mobile number as typed, national or international. */
  mobile: string;
  /** `yyyy-mm-dd`, straight from <input type="date">. */
  dob: string;
  consent: boolean;
}

export type ApplicationField = 'firstName' | 'lastName' | 'email' | 'mobile' | 'dob' | 'consent';

export type ApplicationErrors = Partial<Record<ApplicationField, string>>;

/**
 * What the server action hands back to the form.
 *
 * It lives here rather than next to the action because a `'use server'`
 * module may only export async functions — a constant in one is a build
 * that boots and then throws on the first render.
 */
export interface ApplyState {
  errors: ApplicationErrors;
  summary: string | null;
}

export const EMPTY_APPLY_STATE: ApplyState = { errors: {}, summary: null };

/**
 * Where the confirmation screen reads the address it echoes back. The
 * action sets it; see the note there for why it is not a query parameter.
 */
export const APPLY_EMAIL_COOKIE = 'thc_apply_email';

/**
 * The privacy notice the GDPR consent statement points at (§1.7).
 *
 * The wireframe leaves it as `href="#"`. The domain is THC's own (it is
 * the one in the wireframe's phone URL bar); the path is this repo's
 * assumption and needs confirming with THC alongside the other Appendix B
 * content. When `/settings` lands (§9.12) this belongs in the `settings`
 * table with the sender addresses, not in the bundle.
 */
export const PRIVACY_NOTICE_URL = 'https://thehospitalitycompany.co.uk/privacy';

/** What the server sends to the database once every rule above passes. */
export interface ValidApplication {
  firstName: string;
  lastName: string;
  email: string;
  /** E.164. */
  phone: string;
  /** `yyyy-mm-dd`, what the RPC matches on (§2.12). */
  dob: string;
  /** Derived from `dob`, stored on the application row (§2.1). */
  ageBand: string;
  /** Always true — carried so the server passes what it checked, not a literal. */
  consent: true;
}

/**
 * Copy. The two the wireframe writes out are verbatim from it; the rest
 * follow the same voice.
 */
export const MESSAGES = {
  firstName: 'Enter your first name',
  lastName: 'Enter your surname',
  emailMissing: 'Enter your email address',
  emailInvalid: 'Enter a valid email address — this is where your interview link goes',
  mobileMissing: 'Enter your mobile number',
  mobileInvalid: 'Enter a valid mobile number, including the area code',
  dobMissing: 'Enter your date of birth',
  dobInvalid: 'Enter a real date, as day, month and year',
  dobUnder18: 'You must be 18 or over to apply',
  consent:
    "Please tick the box to continue — we can't process your application without your consent",
  unavailable:
    'We could not send your application just now. Please try again in a moment, or write to admin@thehospitalitycompany.co.uk.',
} as const;

/** Deliberately loose: the address is proved by the interview email landing, not by a regex. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function emptyDraft(): ApplicationDraft {
  return {
    firstName: '',
    lastName: '',
    email: '',
    country: DEFAULT_ISO,
    mobile: '',
    dob: '',
    consent: false,
  };
}

export function validateApplication(
  draft: ApplicationDraft,
): { ok: true; value: ValidApplication } | { ok: false; errors: ApplicationErrors } {
  const errors: ApplicationErrors = {};

  const firstName = draft.firstName.trim();
  const lastName = draft.lastName.trim();
  const email = draft.email.trim();

  if (firstName === '') errors.firstName = MESSAGES.firstName;
  if (lastName === '') errors.lastName = MESSAGES.lastName;
  if (email === '') errors.email = MESSAGES.emailMissing;
  else if (!EMAIL.test(email)) errors.email = MESSAGES.emailInvalid;

  const phone = toE164(draft.country, draft.mobile);
  if (draft.mobile.trim() === '') errors.mobile = MESSAGES.mobileMissing;
  else if (phone === null) errors.mobile = MESSAGES.mobileInvalid;

  const dob = draft.dob.trim() === '' ? null : parseDob(draft.dob);
  let age = -1;
  if (draft.dob.trim() === '') {
    errors.dob = MESSAGES.dobMissing;
  } else if (dob === null) {
    errors.dob = MESSAGES.dobInvalid;
  } else {
    age = ageOn(dob);
    if (age > MAX_AGE || dob.getTime() > Date.now()) errors.dob = MESSAGES.dobInvalid;
    else if (age < 18) errors.dob = MESSAGES.dobUnder18;
  }

  if (!draft.consent) errors.consent = MESSAGES.consent;

  // `phone === null` always sets errors.mobile above; naming it here is
  // what lets the compiler see that the returned number is a string.
  if (phone === null || dob === null || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      firstName,
      lastName,
      email,
      phone,
      dob: draft.dob.trim(),
      ageBand: ageBandFor(age),
      consent: true,
    },
  };
}

/** The coral banner above the fields, e.g. "Please fix the 2 fields highlighted below." */
export function summaryMessage(errors: ApplicationErrors): string | null {
  const count = Object.keys(errors).length;
  if (count === 0) return null;
  return count === 1
    ? 'Please fix the field highlighted below.'
    : `Please fix the ${count} fields highlighted below.`;
}

/**
 * `submit_application` raises a stable code rather than prose so the copy
 * stays here. These are the belt-and-braces path: a tampered form, or a
 * direct POST, lands on exactly the same messages as the form's own.
 */
export function errorForDatabaseCode(message: string): ApplicationErrors {
  if (message.includes('apply_under_18')) return { dob: MESSAGES.dobUnder18 };
  if (message.includes('apply_dob_required')) return { dob: MESSAGES.dobMissing };
  if (message.includes('apply_dob_invalid')) return { dob: MESSAGES.dobInvalid };
  if (message.includes('apply_consent_required')) return { consent: MESSAGES.consent };
  if (message.includes('apply_email_invalid')) return { email: MESSAGES.emailInvalid };
  if (message.includes('apply_phone_invalid')) return { mobile: MESSAGES.mobileInvalid };
  if (message.includes('apply_name_required')) return { firstName: MESSAGES.firstName };
  return {};
}
