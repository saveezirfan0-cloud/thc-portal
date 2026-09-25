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
 * Today as the UK calendar has it (§1.8: "rules evaluated in Europe/London"),
 * as a local-constructed Date so it compares with `parseDob()`'s field by
 * field. `submit_application()` judges the age on
 * `(now() at time zone 'Europe/London')::date`; this is the same day, so the
 * form, the action and the database never disagree about whether someone's
 * eighteenth birthday has arrived. Before this the action used the process
 * calendar — UTC on Vercel — which between 00:00 and 01:00 BST on the
 * birthday itself still said 17 while the database said 18.
 */
export function ukTodayDate(now: Date = new Date()): Date {
  const [y, m, d] = ukToday(now).split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/**
 * Completed years on `on`, which defaults to today in the UK. Plain calendar
 * arithmetic: the birthday has happened this year only once the month and
 * day have passed. Negative when `dob` is after `on`.
 */
export function ageOn(dob: Date, on: Date = ukTodayDate()): number {
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
 * The international picker (§2.1) — ADR-0009.
 *
 * One entry per ISO 3166-1 territory that has a public telephone numbering
 * plan, so the list is "… all countries" as the wireframe's last option
 * says, not the sixty the first cut shipped (an applicant from Finland,
 * Bangladesh or Mexico could only submit a wrong number, which then fed
 * the §2.12 mobile+dob match and every later SMS).
 *
 * The option's VALUE is the ISO code, never the dialling code: +44 belongs
 * to four territories and +1 to more than twenty, and a `<select>` holding
 * the same value twice renders the last match when collapsed. The flag is
 * derived from the ISO code rather than typed. Territories inside the North
 * American plan carry their area code (`+1876` for Jamaica), which is how
 * every picker spells them and what an islander expects to see.
 */
export interface Country {
  /** ISO 3166-1 alpha-2, upper case. The `<option>` value. */
  iso: string;
  name: string;
  /** E.164 country code, `+` first. */
  dial: string;
}

/** The "Common" group: the nine the wireframe names, in its order, UK first. */
export const COMMON_COUNTRIES: readonly Country[] = [
  { iso: 'GB', name: 'United Kingdom', dial: '+44' },
  { iso: 'IE', name: 'Ireland', dial: '+353' },
  { iso: 'PL', name: 'Poland', dial: '+48' },
  { iso: 'IT', name: 'Italy', dial: '+39' },
  { iso: 'ES', name: 'Spain', dial: '+34' },
  { iso: 'RO', name: 'Romania', dial: '+40' },
  { iso: 'IN', name: 'India', dial: '+91' },
  { iso: 'NG', name: 'Nigeria', dial: '+234' },
  { iso: 'BR', name: 'Brazil', dial: '+55' },
];

/**
 * The "All countries" group: everything else, alphabetical by the name the
 * person will type to find it. Disjoint from the common nine (ADR-0009).
 */
export const OTHER_COUNTRIES: readonly Country[] = [
  { iso: 'AF', name: 'Afghanistan', dial: '+93' },
  { iso: 'AX', name: 'Åland Islands', dial: '+358' },
  { iso: 'AL', name: 'Albania', dial: '+355' },
  { iso: 'DZ', name: 'Algeria', dial: '+213' },
  { iso: 'AS', name: 'American Samoa', dial: '+1684' },
  { iso: 'AD', name: 'Andorra', dial: '+376' },
  { iso: 'AO', name: 'Angola', dial: '+244' },
  { iso: 'AI', name: 'Anguilla', dial: '+1264' },
  { iso: 'AG', name: 'Antigua and Barbuda', dial: '+1268' },
  { iso: 'AR', name: 'Argentina', dial: '+54' },
  { iso: 'AM', name: 'Armenia', dial: '+374' },
  { iso: 'AW', name: 'Aruba', dial: '+297' },
  { iso: 'AU', name: 'Australia', dial: '+61' },
  { iso: 'AT', name: 'Austria', dial: '+43' },
  { iso: 'AZ', name: 'Azerbaijan', dial: '+994' },
  { iso: 'BS', name: 'Bahamas', dial: '+1242' },
  { iso: 'BH', name: 'Bahrain', dial: '+973' },
  { iso: 'BD', name: 'Bangladesh', dial: '+880' },
  { iso: 'BB', name: 'Barbados', dial: '+1246' },
  { iso: 'BY', name: 'Belarus', dial: '+375' },
  { iso: 'BE', name: 'Belgium', dial: '+32' },
  { iso: 'BZ', name: 'Belize', dial: '+501' },
  { iso: 'BJ', name: 'Benin', dial: '+229' },
  { iso: 'BM', name: 'Bermuda', dial: '+1441' },
  { iso: 'BT', name: 'Bhutan', dial: '+975' },
  { iso: 'BO', name: 'Bolivia', dial: '+591' },
  { iso: 'BQ', name: 'Bonaire, Sint Eustatius and Saba', dial: '+599' },
  { iso: 'BA', name: 'Bosnia and Herzegovina', dial: '+387' },
  { iso: 'BW', name: 'Botswana', dial: '+267' },
  { iso: 'IO', name: 'British Indian Ocean Territory', dial: '+246' },
  { iso: 'VG', name: 'British Virgin Islands', dial: '+1284' },
  { iso: 'BN', name: 'Brunei', dial: '+673' },
  { iso: 'BG', name: 'Bulgaria', dial: '+359' },
  { iso: 'BF', name: 'Burkina Faso', dial: '+226' },
  { iso: 'BI', name: 'Burundi', dial: '+257' },
  { iso: 'KH', name: 'Cambodia', dial: '+855' },
  { iso: 'CM', name: 'Cameroon', dial: '+237' },
  { iso: 'CA', name: 'Canada', dial: '+1' },
  { iso: 'CV', name: 'Cape Verde', dial: '+238' },
  { iso: 'KY', name: 'Cayman Islands', dial: '+1345' },
  { iso: 'CF', name: 'Central African Republic', dial: '+236' },
  { iso: 'TD', name: 'Chad', dial: '+235' },
  { iso: 'CL', name: 'Chile', dial: '+56' },
  { iso: 'CN', name: 'China', dial: '+86' },
  { iso: 'CX', name: 'Christmas Island', dial: '+61' },
  { iso: 'CC', name: 'Cocos (Keeling) Islands', dial: '+61' },
  { iso: 'CO', name: 'Colombia', dial: '+57' },
  { iso: 'KM', name: 'Comoros', dial: '+269' },
  { iso: 'CG', name: 'Congo', dial: '+242' },
  { iso: 'CD', name: 'Congo (Democratic Republic)', dial: '+243' },
  { iso: 'CK', name: 'Cook Islands', dial: '+682' },
  { iso: 'CR', name: 'Costa Rica', dial: '+506' },
  { iso: 'CI', name: "Côte d'Ivoire", dial: '+225' },
  { iso: 'HR', name: 'Croatia', dial: '+385' },
  { iso: 'CU', name: 'Cuba', dial: '+53' },
  { iso: 'CW', name: 'Curaçao', dial: '+599' },
  { iso: 'CY', name: 'Cyprus', dial: '+357' },
  { iso: 'CZ', name: 'Czechia', dial: '+420' },
  { iso: 'DK', name: 'Denmark', dial: '+45' },
  { iso: 'DJ', name: 'Djibouti', dial: '+253' },
  { iso: 'DM', name: 'Dominica', dial: '+1767' },
  { iso: 'DO', name: 'Dominican Republic', dial: '+1809' },
  { iso: 'EC', name: 'Ecuador', dial: '+593' },
  { iso: 'EG', name: 'Egypt', dial: '+20' },
  { iso: 'SV', name: 'El Salvador', dial: '+503' },
  { iso: 'GQ', name: 'Equatorial Guinea', dial: '+240' },
  { iso: 'ER', name: 'Eritrea', dial: '+291' },
  { iso: 'EE', name: 'Estonia', dial: '+372' },
  { iso: 'SZ', name: 'Eswatini', dial: '+268' },
  { iso: 'ET', name: 'Ethiopia', dial: '+251' },
  { iso: 'FK', name: 'Falkland Islands', dial: '+500' },
  { iso: 'FO', name: 'Faroe Islands', dial: '+298' },
  { iso: 'FJ', name: 'Fiji', dial: '+679' },
  { iso: 'FI', name: 'Finland', dial: '+358' },
  { iso: 'FR', name: 'France', dial: '+33' },
  { iso: 'GF', name: 'French Guiana', dial: '+594' },
  { iso: 'PF', name: 'French Polynesia', dial: '+689' },
  { iso: 'GA', name: 'Gabon', dial: '+241' },
  { iso: 'GM', name: 'Gambia', dial: '+220' },
  { iso: 'GE', name: 'Georgia', dial: '+995' },
  { iso: 'DE', name: 'Germany', dial: '+49' },
  { iso: 'GH', name: 'Ghana', dial: '+233' },
  { iso: 'GI', name: 'Gibraltar', dial: '+350' },
  { iso: 'GR', name: 'Greece', dial: '+30' },
  { iso: 'GL', name: 'Greenland', dial: '+299' },
  { iso: 'GD', name: 'Grenada', dial: '+1473' },
  { iso: 'GP', name: 'Guadeloupe', dial: '+590' },
  { iso: 'GU', name: 'Guam', dial: '+1671' },
  { iso: 'GT', name: 'Guatemala', dial: '+502' },
  { iso: 'GG', name: 'Guernsey', dial: '+44' },
  { iso: 'GN', name: 'Guinea', dial: '+224' },
  { iso: 'GW', name: 'Guinea-Bissau', dial: '+245' },
  { iso: 'GY', name: 'Guyana', dial: '+592' },
  { iso: 'HT', name: 'Haiti', dial: '+509' },
  { iso: 'HN', name: 'Honduras', dial: '+504' },
  { iso: 'HK', name: 'Hong Kong', dial: '+852' },
  { iso: 'HU', name: 'Hungary', dial: '+36' },
  { iso: 'IS', name: 'Iceland', dial: '+354' },
  { iso: 'ID', name: 'Indonesia', dial: '+62' },
  { iso: 'IR', name: 'Iran', dial: '+98' },
  { iso: 'IQ', name: 'Iraq', dial: '+964' },
  { iso: 'IM', name: 'Isle of Man', dial: '+44' },
  { iso: 'IL', name: 'Israel', dial: '+972' },
  { iso: 'JM', name: 'Jamaica', dial: '+1876' },
  { iso: 'JP', name: 'Japan', dial: '+81' },
  { iso: 'JE', name: 'Jersey', dial: '+44' },
  { iso: 'JO', name: 'Jordan', dial: '+962' },
  { iso: 'KZ', name: 'Kazakhstan', dial: '+7' },
  { iso: 'KE', name: 'Kenya', dial: '+254' },
  { iso: 'KI', name: 'Kiribati', dial: '+686' },
  { iso: 'XK', name: 'Kosovo', dial: '+383' },
  { iso: 'KW', name: 'Kuwait', dial: '+965' },
  { iso: 'KG', name: 'Kyrgyzstan', dial: '+996' },
  { iso: 'LA', name: 'Laos', dial: '+856' },
  { iso: 'LV', name: 'Latvia', dial: '+371' },
  { iso: 'LB', name: 'Lebanon', dial: '+961' },
  { iso: 'LS', name: 'Lesotho', dial: '+266' },
  { iso: 'LR', name: 'Liberia', dial: '+231' },
  { iso: 'LY', name: 'Libya', dial: '+218' },
  { iso: 'LI', name: 'Liechtenstein', dial: '+423' },
  { iso: 'LT', name: 'Lithuania', dial: '+370' },
  { iso: 'LU', name: 'Luxembourg', dial: '+352' },
  { iso: 'MO', name: 'Macao', dial: '+853' },
  { iso: 'MG', name: 'Madagascar', dial: '+261' },
  { iso: 'MW', name: 'Malawi', dial: '+265' },
  { iso: 'MY', name: 'Malaysia', dial: '+60' },
  { iso: 'MV', name: 'Maldives', dial: '+960' },
  { iso: 'ML', name: 'Mali', dial: '+223' },
  { iso: 'MT', name: 'Malta', dial: '+356' },
  { iso: 'MH', name: 'Marshall Islands', dial: '+692' },
  { iso: 'MQ', name: 'Martinique', dial: '+596' },
  { iso: 'MR', name: 'Mauritania', dial: '+222' },
  { iso: 'MU', name: 'Mauritius', dial: '+230' },
  { iso: 'YT', name: 'Mayotte', dial: '+262' },
  { iso: 'MX', name: 'Mexico', dial: '+52' },
  { iso: 'FM', name: 'Micronesia', dial: '+691' },
  { iso: 'MD', name: 'Moldova', dial: '+373' },
  { iso: 'MC', name: 'Monaco', dial: '+377' },
  { iso: 'MN', name: 'Mongolia', dial: '+976' },
  { iso: 'ME', name: 'Montenegro', dial: '+382' },
  { iso: 'MS', name: 'Montserrat', dial: '+1664' },
  { iso: 'MA', name: 'Morocco', dial: '+212' },
  { iso: 'MZ', name: 'Mozambique', dial: '+258' },
  { iso: 'MM', name: 'Myanmar', dial: '+95' },
  { iso: 'NA', name: 'Namibia', dial: '+264' },
  { iso: 'NR', name: 'Nauru', dial: '+674' },
  { iso: 'NP', name: 'Nepal', dial: '+977' },
  { iso: 'NL', name: 'Netherlands', dial: '+31' },
  { iso: 'NC', name: 'New Caledonia', dial: '+687' },
  { iso: 'NZ', name: 'New Zealand', dial: '+64' },
  { iso: 'NI', name: 'Nicaragua', dial: '+505' },
  { iso: 'NE', name: 'Niger', dial: '+227' },
  { iso: 'NU', name: 'Niue', dial: '+683' },
  { iso: 'NF', name: 'Norfolk Island', dial: '+672' },
  { iso: 'KP', name: 'North Korea', dial: '+850' },
  { iso: 'MK', name: 'North Macedonia', dial: '+389' },
  { iso: 'MP', name: 'Northern Mariana Islands', dial: '+1670' },
  { iso: 'NO', name: 'Norway', dial: '+47' },
  { iso: 'OM', name: 'Oman', dial: '+968' },
  { iso: 'PK', name: 'Pakistan', dial: '+92' },
  { iso: 'PW', name: 'Palau', dial: '+680' },
  { iso: 'PS', name: 'Palestine', dial: '+970' },
  { iso: 'PA', name: 'Panama', dial: '+507' },
  { iso: 'PG', name: 'Papua New Guinea', dial: '+675' },
  { iso: 'PY', name: 'Paraguay', dial: '+595' },
  { iso: 'PE', name: 'Peru', dial: '+51' },
  { iso: 'PH', name: 'Philippines', dial: '+63' },
  { iso: 'PN', name: 'Pitcairn Islands', dial: '+64' },
  { iso: 'PT', name: 'Portugal', dial: '+351' },
  { iso: 'PR', name: 'Puerto Rico', dial: '+1787' },
  { iso: 'QA', name: 'Qatar', dial: '+974' },
  { iso: 'RE', name: 'Réunion', dial: '+262' },
  { iso: 'RU', name: 'Russia', dial: '+7' },
  { iso: 'RW', name: 'Rwanda', dial: '+250' },
  { iso: 'BL', name: 'Saint Barthélemy', dial: '+590' },
  { iso: 'SH', name: 'Saint Helena', dial: '+290' },
  { iso: 'KN', name: 'Saint Kitts and Nevis', dial: '+1869' },
  { iso: 'LC', name: 'Saint Lucia', dial: '+1758' },
  { iso: 'MF', name: 'Saint Martin', dial: '+590' },
  { iso: 'PM', name: 'Saint Pierre and Miquelon', dial: '+508' },
  { iso: 'VC', name: 'Saint Vincent and the Grenadines', dial: '+1784' },
  { iso: 'WS', name: 'Samoa', dial: '+685' },
  { iso: 'SM', name: 'San Marino', dial: '+378' },
  { iso: 'ST', name: 'São Tomé and Príncipe', dial: '+239' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '+966' },
  { iso: 'SN', name: 'Senegal', dial: '+221' },
  { iso: 'RS', name: 'Serbia', dial: '+381' },
  { iso: 'SC', name: 'Seychelles', dial: '+248' },
  { iso: 'SL', name: 'Sierra Leone', dial: '+232' },
  { iso: 'SG', name: 'Singapore', dial: '+65' },
  { iso: 'SX', name: 'Sint Maarten', dial: '+1721' },
  { iso: 'SK', name: 'Slovakia', dial: '+421' },
  { iso: 'SI', name: 'Slovenia', dial: '+386' },
  { iso: 'SB', name: 'Solomon Islands', dial: '+677' },
  { iso: 'SO', name: 'Somalia', dial: '+252' },
  { iso: 'ZA', name: 'South Africa', dial: '+27' },
  { iso: 'KR', name: 'South Korea', dial: '+82' },
  { iso: 'SS', name: 'South Sudan', dial: '+211' },
  { iso: 'LK', name: 'Sri Lanka', dial: '+94' },
  { iso: 'SD', name: 'Sudan', dial: '+249' },
  { iso: 'SR', name: 'Suriname', dial: '+597' },
  { iso: 'SJ', name: 'Svalbard and Jan Mayen', dial: '+47' },
  { iso: 'SE', name: 'Sweden', dial: '+46' },
  { iso: 'CH', name: 'Switzerland', dial: '+41' },
  { iso: 'SY', name: 'Syria', dial: '+963' },
  { iso: 'TW', name: 'Taiwan', dial: '+886' },
  { iso: 'TJ', name: 'Tajikistan', dial: '+992' },
  { iso: 'TZ', name: 'Tanzania', dial: '+255' },
  { iso: 'TH', name: 'Thailand', dial: '+66' },
  { iso: 'TL', name: 'Timor-Leste', dial: '+670' },
  { iso: 'TG', name: 'Togo', dial: '+228' },
  { iso: 'TK', name: 'Tokelau', dial: '+690' },
  { iso: 'TO', name: 'Tonga', dial: '+676' },
  { iso: 'TT', name: 'Trinidad and Tobago', dial: '+1868' },
  { iso: 'TN', name: 'Tunisia', dial: '+216' },
  { iso: 'TR', name: 'Turkey', dial: '+90' },
  { iso: 'TM', name: 'Turkmenistan', dial: '+993' },
  { iso: 'TC', name: 'Turks and Caicos Islands', dial: '+1649' },
  { iso: 'TV', name: 'Tuvalu', dial: '+688' },
  { iso: 'UG', name: 'Uganda', dial: '+256' },
  { iso: 'UA', name: 'Ukraine', dial: '+380' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '+971' },
  { iso: 'US', name: 'United States', dial: '+1' },
  { iso: 'VI', name: 'United States Virgin Islands', dial: '+1340' },
  { iso: 'UY', name: 'Uruguay', dial: '+598' },
  { iso: 'UZ', name: 'Uzbekistan', dial: '+998' },
  { iso: 'VU', name: 'Vanuatu', dial: '+678' },
  { iso: 'VA', name: 'Vatican City', dial: '+39' },
  { iso: 'VE', name: 'Venezuela', dial: '+58' },
  { iso: 'VN', name: 'Vietnam', dial: '+84' },
  { iso: 'WF', name: 'Wallis and Futuna', dial: '+681' },
  { iso: 'EH', name: 'Western Sahara', dial: '+212' },
  { iso: 'YE', name: 'Yemen', dial: '+967' },
  { iso: 'ZM', name: 'Zambia', dial: '+260' },
  { iso: 'ZW', name: 'Zimbabwe', dial: '+263' },
];

/** Both groups, common first: the order the `<select>` lists them in. */
export const COUNTRIES: readonly Country[] = [...COMMON_COUNTRIES, ...OTHER_COUNTRIES];

const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));

/** The entry for an ISO code, or null for anything the picker never offered. */
export function countryFor(iso: string): Country | null {
  return BY_ISO.get(iso.trim().toUpperCase()) ?? null;
}

/**
 * The flag, derived from the ISO code: each letter maps to its regional
 * indicator symbol and the pair renders as the flag on every phone keyboard
 * the form is typed on.
 */
export function flagFor(iso: string): string {
  return [...iso.toUpperCase()]
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join('');
}

/**
 * The option's text — ADR-0009: dialling code first, so the one piece of
 * information the field exists to carry survives being clipped in the
 * collapsed control ("+44 🇬🇧 United…"), then the name the browser's
 * type-ahead matches.
 */
export function countryLabel(country: Country): string {
  return `${country.dial} ${flagFor(country.iso)} ${country.name}`;
}

export interface ApplicationValues {
  firstName: string;
  lastName: string;
  email: string;
  /** ISO 3166-1 alpha-2 of the picker's choice (ADR-0009); `GB` by default. */
  country: string;
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
  country: 'GB',
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
 * The E.164 number for what the form holds, or `''` when the country is
 * not one the picker offers — which `validate()` reports on the mobile
 * field, so the action never sends it.
 */
export function phoneFor(values: Pick<ApplicationValues, 'country' | 'mobile'>): string {
  const country = countryFor(values.country);
  return country ? toE164(country.dial, values.mobile) : '';
}

/**
 * Everything the form and the server both check. Empty object = valid.
 *
 * `now` is the instant the rules are judged at; it is turned into the UK
 * calendar day (§1.8) before any date is compared, and is a parameter only
 * so a test can stand at 00:30 BST on someone's eighteenth birthday.
 */
export function validate(values: ApplicationValues, now: Date = new Date()): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.firstName.trim()) errors.firstName = 'Enter your first name';
  if (!values.lastName.trim()) errors.lastName = 'Enter your surname';

  const email = values.email.trim();
  if (!email) errors.email = 'Enter your email address';
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Check your email address';

  // 7 digits is Norway's shortest national number; 15 is the E.164 ceiling.
  // A country the picker never offered (only possible off the form) fails
  // the same way as a malformed number: the shape is what is wrong.
  const e164 = phoneFor(values);
  if (!values.mobile.trim()) errors.mobile = 'Enter your mobile number';
  else if (!/^\+[1-9]\d{6,14}$/.test(e164)) errors.mobile = 'Check your mobile number';

  // §2.1 / ADR-0008: under 18 is rejected on the spot, and again on the
  // server. A missing date, an impossible one and an under-18 one are three
  // different mistakes and say so. "Today" is the UK's today (§1.8), the
  // same day `submit_application()` judges on, so a birthday that has
  // arrived in London is not still a day away because the process clock
  // runs in UTC.
  const typed = values.dob.trim();
  const dob = typed === '' ? null : parseDob(typed);
  if (typed === '') errors.dob = 'Enter your date of birth';
  else if (dob === null) errors.dob = 'Enter a real date, as day, month and year';
  else {
    const age = ageOn(dob, ukTodayDate(now));
    if (age < 0 || age > MAX_AGE) {
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
 * What the form shows once it has been submitted: the browser's own live
 * check of what is typed now, plus any refusal the server gave to a value
 * the person has not changed since.
 *
 * Before this the form showed only its own check after the first submit,
 * so a refusal only the server could make — a rule it judges on a clock or
 * a list the browser does not have — was discarded on arrival: no banner,
 * no field error, no redirect, a submit that silently did nothing. A
 * server error is pinned to the exact value it refused, so it stays until
 * that field changes and never outlives the fix.
 */
export function visibleErrors(
  checked: FieldErrors,
  server: ApplyState,
  values: ApplicationValues,
): FieldErrors {
  const merged: FieldErrors = { ...checked };
  for (const key of Object.keys(server.errors) as ApplicationField[]) {
    if (!merged[key] && values[key] === server.values[key]) merged[key] = server.errors[key];
  }
  return merged;
}

/**
 * Where "Check your inbox" reads the address back from.
 *
 * A cookie rather than a query string, so the applicant's email stays out of
 * browser history, server logs and the referrer sent to the privacy notice.
 * It lives here rather than beside the action because a "use server" module
 * may only export async functions.
 */
export const SENT_TO_COOKIE = 'thc_apply_sent_to';
