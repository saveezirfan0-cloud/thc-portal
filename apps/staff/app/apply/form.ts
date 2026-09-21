/**
 * The application form's data and its rules (§2.1).
 *
 * One module, imported by the form and by the server action, so the copy a
 * candidate reads and the copy the server enforces cannot drift apart. The
 * database repeats the same rules a third time in `submit_application()`,
 * because §2.1 says the age gate is "checked both on the form and on the
 * server" and a form can be edited by whoever is sitting in front of it.
 */

/** The age select, exactly as `wireframes/public/apply.html` lists it. */
export const AGE_OPTIONS = [
  { value: 'under_18', label: 'Under 18' },
  ...Array.from({ length: 13 }, (_, i) => ({ value: String(18 + i), label: String(18 + i) })),
  { value: '31_40', label: '31 – 40' },
  { value: '41_50', label: '41 – 50' },
  { value: '51_60', label: '51 – 60' },
  { value: '60_plus', label: '60+' },
] as const;

/** Every value the database will accept. "under_18" is deliberately absent. */
const ADULT_BANDS = new Set(AGE_OPTIONS.map((o) => o.value).filter((v) => v !== 'under_18'));

/**
 * International dialling codes for the mobile picker (§2.1).
 * The nine the wireframe shows come first, in its order, then the rest
 * alphabetically — the list a hospitality workforce in London actually needs.
 */
export const DIAL_CODES = [
  { code: '+44', label: '🇬🇧 +44' },
  { code: '+353', label: '🇮🇪 +353' },
  { code: '+48', label: '🇵🇱 +48' },
  { code: '+39', label: '🇮🇹 +39' },
  { code: '+34', label: '🇪🇸 +34' },
  { code: '+40', label: '🇷🇴 +40' },
  { code: '+91', label: '🇮🇳 +91' },
  { code: '+234', label: '🇳🇬 +234' },
  { code: '+55', label: '🇧🇷 +55' },
  { code: '+355', label: '🇦🇱 +355' },
  { code: '+61', label: '🇦🇺 +61' },
  { code: '+43', label: '🇦🇹 +43' },
  { code: '+32', label: '🇧🇪 +32' },
  { code: '+359', label: '🇧🇬 +359' },
  { code: '+1', label: '🇨🇦 +1' },
  { code: '+86', label: '🇨🇳 +86' },
  { code: '+385', label: '🇭🇷 +385' },
  { code: '+357', label: '🇨🇾 +357' },
  { code: '+420', label: '🇨🇿 +420' },
  { code: '+45', label: '🇩🇰 +45' },
  { code: '+20', label: '🇪🇬 +20' },
  { code: '+372', label: '🇪🇪 +372' },
  { code: '+33', label: '🇫🇷 +33' },
  { code: '+995', label: '🇬🇪 +995' },
  { code: '+49', label: '🇩🇪 +49' },
  { code: '+233', label: '🇬🇭 +233' },
  { code: '+30', label: '🇬🇷 +30' },
  { code: '+36', label: '🇭🇺 +36' },
  { code: '+62', label: '🇮🇩 +62' },
  { code: '+98', label: '🇮🇷 +98' },
  { code: '+972', label: '🇮🇱 +972' },
  { code: '+254', label: '🇰🇪 +254' },
  { code: '+371', label: '🇱🇻 +371' },
  { code: '+370', label: '🇱🇹 +370' },
  { code: '+60', label: '🇲🇾 +60' },
  { code: '+356', label: '🇲🇹 +356' },
  { code: '+212', label: '🇲🇦 +212' },
  { code: '+31', label: '🇳🇱 +31' },
  { code: '+64', label: '🇳🇿 +64' },
  { code: '+47', label: '🇳🇴 +47' },
  { code: '+92', label: '🇵🇰 +92' },
  { code: '+63', label: '🇵🇭 +63' },
  { code: '+351', label: '🇵🇹 +351' },
  { code: '+974', label: '🇶🇦 +974' },
  { code: '+7', label: '🇷🇺 +7' },
  { code: '+966', label: '🇸🇦 +966' },
  { code: '+381', label: '🇷🇸 +381' },
  { code: '+65', label: '🇸🇬 +65' },
  { code: '+421', label: '🇸🇰 +421' },
  { code: '+386', label: '🇸🇮 +386' },
  { code: '+27', label: '🇿🇦 +27' },
  { code: '+82', label: '🇰🇷 +82' },
  { code: '+94', label: '🇱🇰 +94' },
  { code: '+46', label: '🇸🇪 +46' },
  { code: '+41', label: '🇨🇭 +41' },
  { code: '+66', label: '🇹🇭 +66' },
  { code: '+216', label: '🇹🇳 +216' },
  { code: '+90', label: '🇹🇷 +90' },
  { code: '+256', label: '🇺🇬 +256' },
  { code: '+380', label: '🇺🇦 +380' },
  { code: '+971', label: '🇦🇪 +971' },
  { code: '+1', label: '🇺🇸 +1' },
  { code: '+84', label: '🇻🇳 +84' },
] as const;

export interface ApplicationValues {
  firstName: string;
  lastName: string;
  email: string;
  dialCode: string;
  mobile: string;
  ageBand: string;
  consent: boolean;
}

export type ApplicationField = keyof ApplicationValues;
export type FieldErrors = Partial<Record<ApplicationField, string>>;

export const EMPTY_VALUES: ApplicationValues = {
  firstName: '',
  lastName: '',
  email: '',
  dialCode: '+44',
  mobile: '',
  ageBand: '',
  consent: false,
};

/**
 * Assemble the E.164 number the database stores.
 *
 * People type their number the way they say it — "07700 900123" in the UK,
 * "(0)151 …" across much of Europe — so the national trunk zero is dropped
 * after the country code rather than sent as part of the number.
 */
export function toE164(dialCode: string, mobile: string): string {
  const national = mobile.replace(/\D/g, '').replace(/^0+/, '');
  return `${dialCode}${national}`;
}

/** Everything the form and the server both check. Empty object = valid. */
export function validate(values: ApplicationValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.firstName.trim()) errors.firstName = 'Enter your first name';
  if (!values.lastName.trim()) errors.lastName = 'Enter your surname';

  const email = values.email.trim();
  if (!email) errors.email = 'Enter your email address';
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Check your email address';

  // 7 digits is Norway's shortest national number; 15 is the E.164 ceiling.
  const e164 = toE164(values.dialCode, values.mobile);
  if (!values.mobile.trim()) errors.mobile = 'Enter your mobile number';
  else if (!/^\+[1-9]\d{6,14}$/.test(e164)) errors.mobile = 'Check your mobile number';

  // §2.1: under 18 is rejected on the spot, and again on the server.
  if (!values.ageBand) errors.ageBand = 'Select your age';
  else if (!ADULT_BANDS.has(values.ageBand)) errors.ageBand = 'You must be 18 or over to apply';

  // §1.7: consent is mandatory and nothing is created without it.
  if (!values.consent) {
    errors.consent =
      "Please tick the box to continue — we can't process your application without your consent";
  }

  return errors;
}

/** The banner above the fields, worded as the wireframe words it. */
export function errorBanner(errors: FieldErrors): string | null {
  const n = Object.keys(errors).length;
  if (n === 0) return null;
  return n === 1
    ? 'Please fix the field highlighted below.'
    : `Please fix the ${n} fields highlighted below.`;
}

/** What the server action hands back to the form. */
export interface ApplyState {
  errors: FieldErrors;
  /** Something went wrong that is not about a field. */
  failure?: string;
  values: ApplicationValues;
}

export const INITIAL_STATE: ApplyState = { errors: {}, values: EMPTY_VALUES };

/**
 * Where "Check your inbox" reads the address back from.
 *
 * A cookie rather than a query string, so the applicant's email stays out of
 * browser history, server logs and the referrer sent to the privacy notice.
 * It lives here rather than beside the action because a "use server" module
 * may only export async functions.
 */
export const SENT_TO_COOKIE = 'thc_apply_sent_to';
