/**
 * Passport country — ADR-0159 (THC request 19.10.2026: "For the New Starter
 * HMRC report, can Passport Country be added in").
 *
 * The country that ISSUED the worker's passport, written the way payroll
 * reads it ("Poland", not "POL"). It lands on `staff.passport_country`
 * from two places:
 *
 *   * the AI read of an uploaded passport's photo page (§2.6, ADR-0033),
 *     which returns the ISSUING STATE code printed in the machine-readable
 *     zone — the most reliably readable field on the page — and is mapped
 *     here by `passportCountryFromCode()`. It only ever fills a blank:
 *     `record_passport_country()` never overwrites what is on file;
 *   * the office, on /staff/:id (`set_staff_passport_country()`), which sets
 *     or corrects it for anyone — and is the only way a worker onboarded
 *     before the read existed, or whose passport could not be read, gets one.
 *
 * A fixed list, not free text, so a misread page (or a page written to
 * talk the model into something) can only ever name a real country.
 *
 * SQL twin: `known_countries()` in migration 20261019120000;
 * `countries.test.ts` holds the two lists to each other.
 */

/** [ICAO / ISO 3166-1 alpha-3 code, name], A → Z by name (the St ones filed as Saint). */
export const PASSPORT_COUNTRIES: readonly (readonly [code: string, name: string])[] = [
  ['AFG', 'Afghanistan'],
  ['ALB', 'Albania'],
  ['DZA', 'Algeria'],
  ['AND', 'Andorra'],
  ['AGO', 'Angola'],
  ['ATG', 'Antigua and Barbuda'],
  ['ARG', 'Argentina'],
  ['ARM', 'Armenia'],
  ['AUS', 'Australia'],
  ['AUT', 'Austria'],
  ['AZE', 'Azerbaijan'],
  ['BHS', 'Bahamas'],
  ['BHR', 'Bahrain'],
  ['BGD', 'Bangladesh'],
  ['BRB', 'Barbados'],
  ['BLR', 'Belarus'],
  ['BEL', 'Belgium'],
  ['BLZ', 'Belize'],
  ['BEN', 'Benin'],
  ['BTN', 'Bhutan'],
  ['BOL', 'Bolivia'],
  ['BIH', 'Bosnia and Herzegovina'],
  ['BWA', 'Botswana'],
  ['BRA', 'Brazil'],
  ['BRN', 'Brunei'],
  ['BGR', 'Bulgaria'],
  ['BFA', 'Burkina Faso'],
  ['BDI', 'Burundi'],
  ['KHM', 'Cambodia'],
  ['CMR', 'Cameroon'],
  ['CAN', 'Canada'],
  ['CPV', 'Cape Verde'],
  ['CAF', 'Central African Republic'],
  ['TCD', 'Chad'],
  ['CHL', 'Chile'],
  ['CHN', 'China'],
  ['COL', 'Colombia'],
  ['COM', 'Comoros'],
  ['COG', 'Congo'],
  ['COD', 'Congo (Democratic Republic)'],
  ['CRI', 'Costa Rica'],
  ['HRV', 'Croatia'],
  ['CUB', 'Cuba'],
  ['CYP', 'Cyprus'],
  ['CZE', 'Czechia'],
  ['DNK', 'Denmark'],
  ['DJI', 'Djibouti'],
  ['DMA', 'Dominica'],
  ['DOM', 'Dominican Republic'],
  ['TLS', 'East Timor'],
  ['ECU', 'Ecuador'],
  ['EGY', 'Egypt'],
  ['SLV', 'El Salvador'],
  ['GNQ', 'Equatorial Guinea'],
  ['ERI', 'Eritrea'],
  ['EST', 'Estonia'],
  ['SWZ', 'Eswatini'],
  ['ETH', 'Ethiopia'],
  ['FJI', 'Fiji'],
  ['FIN', 'Finland'],
  ['FRA', 'France'],
  ['GAB', 'Gabon'],
  ['GMB', 'Gambia'],
  ['GEO', 'Georgia'],
  ['DEU', 'Germany'],
  ['GHA', 'Ghana'],
  ['GRC', 'Greece'],
  ['GRD', 'Grenada'],
  ['GTM', 'Guatemala'],
  ['GIN', 'Guinea'],
  ['GNB', 'Guinea-Bissau'],
  ['GUY', 'Guyana'],
  ['HTI', 'Haiti'],
  ['HND', 'Honduras'],
  ['HKG', 'Hong Kong'],
  ['HUN', 'Hungary'],
  ['ISL', 'Iceland'],
  ['IND', 'India'],
  ['IDN', 'Indonesia'],
  ['IRN', 'Iran'],
  ['IRQ', 'Iraq'],
  ['IRL', 'Ireland'],
  ['ISR', 'Israel'],
  ['ITA', 'Italy'],
  ['CIV', 'Ivory Coast'],
  ['JAM', 'Jamaica'],
  ['JPN', 'Japan'],
  ['JOR', 'Jordan'],
  ['KAZ', 'Kazakhstan'],
  ['KEN', 'Kenya'],
  ['KIR', 'Kiribati'],
  ['RKS', 'Kosovo'],
  ['KWT', 'Kuwait'],
  ['KGZ', 'Kyrgyzstan'],
  ['LAO', 'Laos'],
  ['LVA', 'Latvia'],
  ['LBN', 'Lebanon'],
  ['LSO', 'Lesotho'],
  ['LBR', 'Liberia'],
  ['LBY', 'Libya'],
  ['LIE', 'Liechtenstein'],
  ['LTU', 'Lithuania'],
  ['LUX', 'Luxembourg'],
  ['MAC', 'Macao'],
  ['MDG', 'Madagascar'],
  ['MWI', 'Malawi'],
  ['MYS', 'Malaysia'],
  ['MDV', 'Maldives'],
  ['MLI', 'Mali'],
  ['MLT', 'Malta'],
  ['MHL', 'Marshall Islands'],
  ['MRT', 'Mauritania'],
  ['MUS', 'Mauritius'],
  ['MEX', 'Mexico'],
  ['FSM', 'Micronesia'],
  ['MDA', 'Moldova'],
  ['MCO', 'Monaco'],
  ['MNG', 'Mongolia'],
  ['MNE', 'Montenegro'],
  ['MAR', 'Morocco'],
  ['MOZ', 'Mozambique'],
  ['MMR', 'Myanmar (Burma)'],
  ['NAM', 'Namibia'],
  ['NRU', 'Nauru'],
  ['NPL', 'Nepal'],
  ['NLD', 'Netherlands'],
  ['NZL', 'New Zealand'],
  ['NIC', 'Nicaragua'],
  ['NER', 'Niger'],
  ['NGA', 'Nigeria'],
  ['PRK', 'North Korea'],
  ['MKD', 'North Macedonia'],
  ['NOR', 'Norway'],
  ['OMN', 'Oman'],
  ['PAK', 'Pakistan'],
  ['PLW', 'Palau'],
  ['PSE', 'Palestine'],
  ['PAN', 'Panama'],
  ['PNG', 'Papua New Guinea'],
  ['PRY', 'Paraguay'],
  ['PER', 'Peru'],
  ['PHL', 'Philippines'],
  ['POL', 'Poland'],
  ['PRT', 'Portugal'],
  ['QAT', 'Qatar'],
  ['ROU', 'Romania'],
  ['RUS', 'Russia'],
  ['RWA', 'Rwanda'],
  ['KNA', 'St Kitts and Nevis'],
  ['LCA', 'St Lucia'],
  ['VCT', 'St Vincent'],
  ['WSM', 'Samoa'],
  ['SMR', 'San Marino'],
  ['STP', 'Sao Tome and Principe'],
  ['SAU', 'Saudi Arabia'],
  ['SEN', 'Senegal'],
  ['SRB', 'Serbia'],
  ['SYC', 'Seychelles'],
  ['SLE', 'Sierra Leone'],
  ['SGP', 'Singapore'],
  ['SVK', 'Slovakia'],
  ['SVN', 'Slovenia'],
  ['SLB', 'Solomon Islands'],
  ['SOM', 'Somalia'],
  ['ZAF', 'South Africa'],
  ['KOR', 'South Korea'],
  ['SSD', 'South Sudan'],
  ['ESP', 'Spain'],
  ['LKA', 'Sri Lanka'],
  ['SDN', 'Sudan'],
  ['SUR', 'Suriname'],
  ['SWE', 'Sweden'],
  ['CHE', 'Switzerland'],
  ['SYR', 'Syria'],
  ['TWN', 'Taiwan'],
  ['TJK', 'Tajikistan'],
  ['TZA', 'Tanzania'],
  ['THA', 'Thailand'],
  ['TGO', 'Togo'],
  ['TON', 'Tonga'],
  ['TTO', 'Trinidad and Tobago'],
  ['TUN', 'Tunisia'],
  ['TUR', 'Turkey'],
  ['TKM', 'Turkmenistan'],
  ['TUV', 'Tuvalu'],
  ['UGA', 'Uganda'],
  ['UKR', 'Ukraine'],
  ['ARE', 'United Arab Emirates'],
  ['GBR', 'United Kingdom'],
  ['USA', 'United States'],
  ['URY', 'Uruguay'],
  ['UZB', 'Uzbekistan'],
  ['VUT', 'Vanuatu'],
  ['VAT', 'Vatican City'],
  ['VEN', 'Venezuela'],
  ['VNM', 'Vietnam'],
  ['YEM', 'Yemen'],
  ['ZMB', 'Zambia'],
  ['ZWE', 'Zimbabwe'],
];

/** Every name the database accepts, in the list's order. */
export const PASSPORT_COUNTRY_NAMES: readonly string[] = PASSPORT_COUNTRIES.map(([, name]) => name);

/**
 * Issuing-state codes a real passport carries that are not the country's
 * own alpha-3 code: Germany's MRZ prints a bare "D", Kosovo is also coded
 * XKX, and the UK's other nationality statuses (British overseas territories
 * citizen, British National (Overseas), British overseas citizen, British
 * protected person, British subject) are UK-issued passports.
 */
const ALIASES: Readonly<Record<string, string>> = {
  D: 'DEU',
  XKX: 'RKS',
  GBD: 'GBR',
  GBN: 'GBR',
  GBO: 'GBR',
  GBP: 'GBR',
  GBS: 'GBR',
};

const BY_CODE = new Map(PASSPORT_COUNTRIES.map(([code, name]) => [code, name]));
const BY_NAME = new Map(PASSPORT_COUNTRY_NAMES.map((name) => [name.toLowerCase(), name]));

/**
 * The passport's issuing-state code (as printed in the MRZ — "GBR", "POL",
 * "D<<") → the country's name, or null for anything that is not a code on
 * the list. Filler `<` and spaces are ignored; case is not significant.
 */
export function passportCountryFromCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const clean = code.replace(/[<\s]/g, '').toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(clean)) return null;
  return BY_CODE.get(ALIASES[clean] ?? clean) ?? null;
}

/** A name on the list, as the list spells it (any case), or null. */
export function knownPassportCountry(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  return BY_NAME.get(name.trim().replace(/\s+/g, ' ').toLowerCase()) ?? null;
}
