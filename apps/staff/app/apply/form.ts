/**
 * The application form's data and its rules (§2.1).
 *
 * One module, imported by the form and by the server action, so the copy a
 * candidate reads and the copy the server enforces cannot drift apart. The
 * database repeats the same rules a third time in `submit_application()`,
 * because §2.1 says the age gate is "checked both on the form and on the
 * server" and a form can be edited by whoever is sitting in front of it.
 */

import { ukToday } from '@thc/domain';

/**
 * Date of birth, not an age band — ADR-0008.
 *
 * §2.1 asks for "Age (select from 18)" and the wireframe draws a select.
 * §2.12 matches returning applicants on mobile + date of birth, which a
 * band cannot satisfy, and THC settled the contradiction in favour of the
 * date. The band §2.1 wanted is still recorded; it is derived from the
 * date rather than asked, so the two can never disagree.
 */

/** The §2.1 band, computed never typed. Mirrors the SQL in the migration. */
export function ageBandFor(age: number): string {
  if (age <= 30) return String(age);
  if (age <= 40) return '31_40';
  if (age <= 50) return '41_50';
  if (age <= 60) return '51_60';
  return '60_plus';
}

/**
 * Today's civil date in Europe/London, as the local-midnight Date the age
 * arithmetic below compares against (§1.8: every rule is evaluated in UK
 * time). The server action runs on Vercel in UTC and the applicant's phone
 * runs wherever it is; between 00:00 and 01:00 BST both would otherwise
 * call a birthday "tomorrow" while `submit_application()` — which uses
 * `now() at time zone 'Europe/London'` — already says it is today.
 */
export function todayInUk(now: Date = new Date()): Date {
  return parseDob(ukToday(now))!;
}

/**
 * Completed years on `on`, which defaults to today in the UK. Plain
 * calendar arithmetic: the birthday has happened this year only once the
 * month and day have passed.
 */
export function ageOn(dob: Date, on: Date = todayInUk()): number {
  let age = on.getFullYear() - dob.getFullYear();
  const months = on.getMonth() - dob.getMonth();
  if (months < 0 || (months === 0 && on.getDate() < dob.getDate())) age -= 1;
  return age;
}

/**
 * Parses the `yyyy-mm-dd` an `<input type="date">` produces.
 *
 * Built from the parts rather than `new Date(string)`, which reads a bare
 * date as UTC — shifting it a day for anyone west of Greenwich — and which
 * accepts 2007-02-31 by rolling it into March. The round-trip check is
 * what rejects a day that does not exist.
 */
export function parseDob(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/** Older than this is a typo, not an applicant. */
const MAX_AGE = 100;

/**
 * International dialling codes for the mobile picker (§2.1, "all countries").
 *
 * One entry per DIALLING CODE, not per country: the <select> is controlled by
 * `code`, and two options sharing '+1' made picking one snap the display
 * back to the other. Territories that share a code share a row, named for
 * all of them, so the row is found by type-ahead on any of the names. The
 * nine the wireframe shows come first, in its order, then every ITU country
 * code alphabetically by country name. ADR-0009 records the picker's shape.
 */
export const DIAL_CODES = [
  { code: '+44', label: '🇬🇧 +44', name: 'United Kingdom' },
  { code: '+353', label: '🇮🇪 +353', name: 'Ireland' },
  { code: '+48', label: '🇵🇱 +48', name: 'Poland' },
  { code: '+39', label: '🇮🇹 +39', name: 'Italy' },
  { code: '+34', label: '🇪🇸 +34', name: 'Spain' },
  { code: '+40', label: '🇷🇴 +40', name: 'Romania' },
  { code: '+91', label: '🇮🇳 +91', name: 'India' },
  { code: '+234', label: '🇳🇬 +234', name: 'Nigeria' },
  { code: '+55', label: '🇧🇷 +55', name: 'Brazil' },
  // — every other country code, A → Z —
  { code: '+93', label: '🇦🇫 +93', name: 'Afghanistan' },
  { code: '+355', label: '🇦🇱 +355', name: 'Albania' },
  { code: '+213', label: '🇩🇿 +213', name: 'Algeria' },
  { code: '+376', label: '🇦🇩 +376', name: 'Andorra' },
  { code: '+244', label: '🇦🇴 +244', name: 'Angola' },
  { code: '+54', label: '🇦🇷 +54', name: 'Argentina' },
  { code: '+374', label: '🇦🇲 +374', name: 'Armenia' },
  { code: '+297', label: '🇦🇼 +297', name: 'Aruba' },
  { code: '+247', label: '🇦🇨 +247', name: 'Ascension Island' },
  { code: '+61', label: '🇦🇺 +61', name: 'Australia' },
  { code: '+43', label: '🇦🇹 +43', name: 'Austria' },
  { code: '+994', label: '🇦🇿 +994', name: 'Azerbaijan' },
  { code: '+973', label: '🇧🇭 +973', name: 'Bahrain' },
  { code: '+880', label: '🇧🇩 +880', name: 'Bangladesh' },
  { code: '+375', label: '🇧🇾 +375', name: 'Belarus' },
  { code: '+32', label: '🇧🇪 +32', name: 'Belgium' },
  { code: '+501', label: '🇧🇿 +501', name: 'Belize' },
  { code: '+229', label: '🇧🇯 +229', name: 'Benin' },
  { code: '+975', label: '🇧🇹 +975', name: 'Bhutan' },
  { code: '+591', label: '🇧🇴 +591', name: 'Bolivia' },
  { code: '+387', label: '🇧🇦 +387', name: 'Bosnia and Herzegovina' },
  { code: '+267', label: '🇧🇼 +267', name: 'Botswana' },
  { code: '+246', label: '🇮🇴 +246', name: 'British Indian Ocean Territory' },
  { code: '+673', label: '🇧🇳 +673', name: 'Brunei' },
  { code: '+359', label: '🇧🇬 +359', name: 'Bulgaria' },
  { code: '+226', label: '🇧🇫 +226', name: 'Burkina Faso' },
  { code: '+257', label: '🇧🇮 +257', name: 'Burundi' },
  { code: '+855', label: '🇰🇭 +855', name: 'Cambodia' },
  { code: '+237', label: '🇨🇲 +237', name: 'Cameroon' },
  { code: '+238', label: '🇨🇻 +238', name: 'Cape Verde' },
  { code: '+236', label: '🇨🇫 +236', name: 'Central African Republic' },
  { code: '+235', label: '🇹🇩 +235', name: 'Chad' },
  { code: '+56', label: '🇨🇱 +56', name: 'Chile' },
  { code: '+86', label: '🇨🇳 +86', name: 'China' },
  { code: '+57', label: '🇨🇴 +57', name: 'Colombia' },
  { code: '+269', label: '🇰🇲 +269', name: 'Comoros' },
  { code: '+242', label: '🇨🇬 +242', name: 'Congo' },
  { code: '+243', label: '🇨🇩 +243', name: 'Congo (DRC)' },
  { code: '+682', label: '🇨🇰 +682', name: 'Cook Islands' },
  { code: '+506', label: '🇨🇷 +506', name: 'Costa Rica' },
  { code: '+225', label: '🇨🇮 +225', name: 'Côte d’Ivoire' },
  { code: '+385', label: '🇭🇷 +385', name: 'Croatia' },
  { code: '+53', label: '🇨🇺 +53', name: 'Cuba' },
  { code: '+599', label: '🇨🇼 +599', name: 'Curaçao and the Caribbean Netherlands' },
  { code: '+357', label: '🇨🇾 +357', name: 'Cyprus' },
  { code: '+420', label: '🇨🇿 +420', name: 'Czechia' },
  { code: '+45', label: '🇩🇰 +45', name: 'Denmark' },
  { code: '+253', label: '🇩🇯 +253', name: 'Djibouti' },
  { code: '+593', label: '🇪🇨 +593', name: 'Ecuador' },
  { code: '+20', label: '🇪🇬 +20', name: 'Egypt' },
  { code: '+503', label: '🇸🇻 +503', name: 'El Salvador' },
  { code: '+240', label: '🇬🇶 +240', name: 'Equatorial Guinea' },
  { code: '+291', label: '🇪🇷 +291', name: 'Eritrea' },
  { code: '+372', label: '🇪🇪 +372', name: 'Estonia' },
  { code: '+268', label: '🇸🇿 +268', name: 'Eswatini' },
  { code: '+251', label: '🇪🇹 +251', name: 'Ethiopia' },
  { code: '+500', label: '🇫🇰 +500', name: 'Falkland Islands' },
  { code: '+298', label: '🇫🇴 +298', name: 'Faroe Islands' },
  { code: '+679', label: '🇫🇯 +679', name: 'Fiji' },
  { code: '+358', label: '🇫🇮 +358', name: 'Finland' },
  { code: '+33', label: '🇫🇷 +33', name: 'France' },
  { code: '+594', label: '🇬🇫 +594', name: 'French Guiana' },
  { code: '+689', label: '🇵🇫 +689', name: 'French Polynesia' },
  { code: '+241', label: '🇬🇦 +241', name: 'Gabon' },
  { code: '+220', label: '🇬🇲 +220', name: 'Gambia' },
  { code: '+995', label: '🇬🇪 +995', name: 'Georgia' },
  { code: '+49', label: '🇩🇪 +49', name: 'Germany' },
  { code: '+233', label: '🇬🇭 +233', name: 'Ghana' },
  { code: '+350', label: '🇬🇮 +350', name: 'Gibraltar' },
  { code: '+30', label: '🇬🇷 +30', name: 'Greece' },
  { code: '+299', label: '🇬🇱 +299', name: 'Greenland' },
  { code: '+590', label: '🇬🇵 +590', name: 'Guadeloupe, Saint Barthélemy and Saint Martin' },
  { code: '+502', label: '🇬🇹 +502', name: 'Guatemala' },
  { code: '+224', label: '🇬🇳 +224', name: 'Guinea' },
  { code: '+245', label: '🇬🇼 +245', name: 'Guinea-Bissau' },
  { code: '+592', label: '🇬🇾 +592', name: 'Guyana' },
  { code: '+509', label: '🇭🇹 +509', name: 'Haiti' },
  { code: '+504', label: '🇭🇳 +504', name: 'Honduras' },
  { code: '+852', label: '🇭🇰 +852', name: 'Hong Kong' },
  { code: '+36', label: '🇭🇺 +36', name: 'Hungary' },
  { code: '+354', label: '🇮🇸 +354', name: 'Iceland' },
  { code: '+62', label: '🇮🇩 +62', name: 'Indonesia' },
  { code: '+98', label: '🇮🇷 +98', name: 'Iran' },
  { code: '+964', label: '🇮🇶 +964', name: 'Iraq' },
  { code: '+972', label: '🇮🇱 +972', name: 'Israel' },
  { code: '+81', label: '🇯🇵 +81', name: 'Japan' },
  { code: '+962', label: '🇯🇴 +962', name: 'Jordan' },
  { code: '+254', label: '🇰🇪 +254', name: 'Kenya' },
  { code: '+686', label: '🇰🇮 +686', name: 'Kiribati' },
  { code: '+383', label: '🇽🇰 +383', name: 'Kosovo' },
  { code: '+965', label: '🇰🇼 +965', name: 'Kuwait' },
  { code: '+996', label: '🇰🇬 +996', name: 'Kyrgyzstan' },
  { code: '+856', label: '🇱🇦 +856', name: 'Laos' },
  { code: '+371', label: '🇱🇻 +371', name: 'Latvia' },
  { code: '+961', label: '🇱🇧 +961', name: 'Lebanon' },
  { code: '+266', label: '🇱🇸 +266', name: 'Lesotho' },
  { code: '+231', label: '🇱🇷 +231', name: 'Liberia' },
  { code: '+218', label: '🇱🇾 +218', name: 'Libya' },
  { code: '+423', label: '🇱🇮 +423', name: 'Liechtenstein' },
  { code: '+370', label: '🇱🇹 +370', name: 'Lithuania' },
  { code: '+352', label: '🇱🇺 +352', name: 'Luxembourg' },
  { code: '+853', label: '🇲🇴 +853', name: 'Macao' },
  { code: '+261', label: '🇲🇬 +261', name: 'Madagascar' },
  { code: '+265', label: '🇲🇼 +265', name: 'Malawi' },
  { code: '+60', label: '🇲🇾 +60', name: 'Malaysia' },
  { code: '+960', label: '🇲🇻 +960', name: 'Maldives' },
  { code: '+223', label: '🇲🇱 +223', name: 'Mali' },
  { code: '+356', label: '🇲🇹 +356', name: 'Malta' },
  { code: '+692', label: '🇲🇭 +692', name: 'Marshall Islands' },
  { code: '+596', label: '🇲🇶 +596', name: 'Martinique' },
  { code: '+222', label: '🇲🇷 +222', name: 'Mauritania' },
  { code: '+230', label: '🇲🇺 +230', name: 'Mauritius' },
  { code: '+52', label: '🇲🇽 +52', name: 'Mexico' },
  { code: '+691', label: '🇫🇲 +691', name: 'Micronesia' },
  { code: '+373', label: '🇲🇩 +373', name: 'Moldova' },
  { code: '+377', label: '🇲🇨 +377', name: 'Monaco' },
  { code: '+976', label: '🇲🇳 +976', name: 'Mongolia' },
  { code: '+382', label: '🇲🇪 +382', name: 'Montenegro' },
  { code: '+212', label: '🇲🇦 +212', name: 'Morocco and Western Sahara' },
  { code: '+258', label: '🇲🇿 +258', name: 'Mozambique' },
  { code: '+95', label: '🇲🇲 +95', name: 'Myanmar' },
  { code: '+264', label: '🇳🇦 +264', name: 'Namibia' },
  { code: '+674', label: '🇳🇷 +674', name: 'Nauru' },
  { code: '+977', label: '🇳🇵 +977', name: 'Nepal' },
  { code: '+31', label: '🇳🇱 +31', name: 'Netherlands' },
  { code: '+687', label: '🇳🇨 +687', name: 'New Caledonia' },
  { code: '+64', label: '🇳🇿 +64', name: 'New Zealand' },
  { code: '+505', label: '🇳🇮 +505', name: 'Nicaragua' },
  { code: '+227', label: '🇳🇪 +227', name: 'Niger' },
  { code: '+683', label: '🇳🇺 +683', name: 'Niue' },
  { code: '+672', label: '🇳🇫 +672', name: 'Norfolk Island and the Australian Antarctic Territory' },
  { code: '+850', label: '🇰🇵 +850', name: 'North Korea' },
  { code: '+389', label: '🇲🇰 +389', name: 'North Macedonia' },
  { code: '+47', label: '🇳🇴 +47', name: 'Norway and Svalbard' },
  { code: '+968', label: '🇴🇲 +968', name: 'Oman' },
  { code: '+92', label: '🇵🇰 +92', name: 'Pakistan' },
  { code: '+680', label: '🇵🇼 +680', name: 'Palau' },
  { code: '+970', label: '🇵🇸 +970', name: 'Palestine' },
  { code: '+507', label: '🇵🇦 +507', name: 'Panama' },
  { code: '+675', label: '🇵🇬 +675', name: 'Papua New Guinea' },
  { code: '+595', label: '🇵🇾 +595', name: 'Paraguay' },
  { code: '+51', label: '🇵🇪 +51', name: 'Peru' },
  { code: '+63', label: '🇵🇭 +63', name: 'Philippines' },
  { code: '+351', label: '🇵🇹 +351', name: 'Portugal' },
  { code: '+974', label: '🇶🇦 +974', name: 'Qatar' },
  { code: '+262', label: '🇷🇪 +262', name: 'Réunion and Mayotte' },
  { code: '+7', label: '🇷🇺🇰🇿 +7', name: 'Russia and Kazakhstan' },
  { code: '+250', label: '🇷🇼 +250', name: 'Rwanda' },
  { code: '+290', label: '🇸🇭 +290', name: 'Saint Helena and Tristan da Cunha' },
  { code: '+508', label: '🇵🇲 +508', name: 'Saint Pierre and Miquelon' },
  { code: '+685', label: '🇼🇸 +685', name: 'Samoa' },
  { code: '+378', label: '🇸🇲 +378', name: 'San Marino' },
  { code: '+239', label: '🇸🇹 +239', name: 'São Tomé and Príncipe' },
  { code: '+966', label: '🇸🇦 +966', name: 'Saudi Arabia' },
  { code: '+221', label: '🇸🇳 +221', name: 'Senegal' },
  { code: '+381', label: '🇷🇸 +381', name: 'Serbia' },
  { code: '+248', label: '🇸🇨 +248', name: 'Seychelles' },
  { code: '+232', label: '🇸🇱 +232', name: 'Sierra Leone' },
  { code: '+65', label: '🇸🇬 +65', name: 'Singapore' },
  { code: '+421', label: '🇸🇰 +421', name: 'Slovakia' },
  { code: '+386', label: '🇸🇮 +386', name: 'Slovenia' },
  { code: '+677', label: '🇸🇧 +677', name: 'Solomon Islands' },
  { code: '+252', label: '🇸🇴 +252', name: 'Somalia' },
  { code: '+27', label: '🇿🇦 +27', name: 'South Africa' },
  { code: '+82', label: '🇰🇷 +82', name: 'South Korea' },
  { code: '+211', label: '🇸🇸 +211', name: 'South Sudan' },
  { code: '+94', label: '🇱🇰 +94', name: 'Sri Lanka' },
  { code: '+249', label: '🇸🇩 +249', name: 'Sudan' },
  { code: '+597', label: '🇸🇷 +597', name: 'Suriname' },
  { code: '+46', label: '🇸🇪 +46', name: 'Sweden' },
  { code: '+41', label: '🇨🇭 +41', name: 'Switzerland' },
  { code: '+963', label: '🇸🇾 +963', name: 'Syria' },
  { code: '+886', label: '🇹🇼 +886', name: 'Taiwan' },
  { code: '+992', label: '🇹🇯 +992', name: 'Tajikistan' },
  { code: '+255', label: '🇹🇿 +255', name: 'Tanzania' },
  { code: '+66', label: '🇹🇭 +66', name: 'Thailand' },
  { code: '+670', label: '🇹🇱 +670', name: 'Timor-Leste' },
  { code: '+228', label: '🇹🇬 +228', name: 'Togo' },
  { code: '+690', label: '🇹🇰 +690', name: 'Tokelau' },
  { code: '+676', label: '🇹🇴 +676', name: 'Tonga' },
  { code: '+216', label: '🇹🇳 +216', name: 'Tunisia' },
  { code: '+90', label: '🇹🇷 +90', name: 'Turkey' },
  { code: '+993', label: '🇹🇲 +993', name: 'Turkmenistan' },
  { code: '+688', label: '🇹🇻 +688', name: 'Tuvalu' },
  { code: '+256', label: '🇺🇬 +256', name: 'Uganda' },
  { code: '+380', label: '🇺🇦 +380', name: 'Ukraine' },
  { code: '+971', label: '🇦🇪 +971', name: 'United Arab Emirates' },
  { code: '+1', label: '🇺🇸🇨🇦 +1', name: 'United States, Canada and the Caribbean (NANP)' },
  { code: '+598', label: '🇺🇾 +598', name: 'Uruguay' },
  { code: '+998', label: '🇺🇿 +998', name: 'Uzbekistan' },
  { code: '+678', label: '🇻🇺 +678', name: 'Vanuatu' },
  { code: '+58', label: '🇻🇪 +58', name: 'Venezuela' },
  { code: '+84', label: '🇻🇳 +84', name: 'Vietnam' },
  { code: '+681', label: '🇼🇫 +681', name: 'Wallis and Futuna' },
  { code: '+967', label: '🇾🇪 +967', name: 'Yemen' },
  { code: '+260', label: '🇿🇲 +260', name: 'Zambia' },
  { code: '+263', label: '🇿🇼 +263', name: 'Zimbabwe' },
] as const;

export interface ApplicationValues {
  firstName: string;
  lastName: string;
  email: string;
  dialCode: string;
  mobile: string;
  /** `yyyy-mm-dd`, straight from the date input. */
  dob: string;
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
  dob: '',
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

/**
 * Everything the form and the server both check. Empty object = valid.
 * `today` is the UK civil date the age gate runs against — a parameter so a
 * test can pin the BST midnight hour.
 */
export function validate(values: ApplicationValues, today: Date = todayInUk()): FieldErrors {
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

  // §2.1 / ADR-0008: under 18 is rejected on the spot, and again on the
  // server. A missing date, an impossible one and an under-18 one are three
  // different mistakes and say so.
  const typed = values.dob.trim();
  const dob = typed === '' ? null : parseDob(typed);
  if (typed === '') errors.dob = 'Enter your date of birth';
  else if (dob === null) errors.dob = 'Enter a real date, as day, month and year';
  else {
    const age = ageOn(dob, today);
    if (dob.getTime() > today.getTime() || age > MAX_AGE) {
      errors.dob = 'Enter a real date, as day, month and year';
    } else if (age < 18) {
      errors.dob = 'You must be 18 or over to apply';
    }
  }

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
