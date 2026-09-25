import { describe, expect, it } from 'vitest';
import {
  COMMON_COUNTRIES,
  COUNTRIES,
  EMPTY_VALUES,
  INITIAL_STATE,
  OTHER_COUNTRIES,
  ageBandFor,
  ageOn,
  countryFor,
  countryLabel,
  errorBanner,
  flagFor,
  parseDob,
  phoneFor,
  toE164,
  ukTodayDate,
  validate,
  visibleErrors,
} from '../form';

/** `yyyy-mm-dd` for someone who turns `age` today, offset by whole days. */
function dobForAge(age: number, offsetDays = 0): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
import type { ApplicationValues } from '../form';

/**
 * The /apply rules (§2.1, §1.7).
 *
 * `form.ts` is the module the browser and the server action share, so these
 * are the assertions that stop the copy a candidate reads drifting from the
 * copy the server enforces. The database enforces the same rules a third
 * time; `supabase/tests/120_apply.sql` is where that is proved.
 */

function values(over: Partial<ApplicationValues> = {}): ApplicationValues {
  return {
    ...EMPTY_VALUES,
    firstName: 'Amara',
    lastName: 'Kalu',
    email: 'amara.kalu@example.com',
    country: 'GB',
    mobile: '7700 900123',
    dob: '1994-06-15',
    consent: true,
    ...over,
  };
}

describe('the date of birth (§2.1, ADR-0008)', () => {
  it('derives the §2.1 band rather than asking for it', () => {
    expect(ageBandFor(18)).toBe('18');
    expect(ageBandFor(30)).toBe('30');
    expect(ageBandFor(31)).toBe('31_40');
    expect(ageBandFor(40)).toBe('31_40');
    expect(ageBandFor(41)).toBe('41_50');
    expect(ageBandFor(51)).toBe('51_60');
    expect(ageBandFor(61)).toBe('60_plus');
  });

  it('counts completed years, not calendar-year differences', () => {
    const on = new Date(2026, 8, 21); // 21 September 2026
    expect(ageOn(new Date(2008, 8, 21), on)).toBe(18); // birthday today
    expect(ageOn(new Date(2008, 8, 22), on)).toBe(17); // birthday tomorrow
    expect(ageOn(new Date(2008, 11, 31), on)).toBe(17);
  });

  it('parses the date input\u2019s value in local time, not UTC', () => {
    const d = parseDob('1994-06-15');
    expect(d?.getFullYear()).toBe(1994);
    expect(d?.getMonth()).toBe(5);
    expect(d?.getDate()).toBe(15);
  });

  it('refuses a day that does not exist', () => {
    expect(parseDob('1994-02-31')).toBeNull();
    expect(parseDob('1994-13-01')).toBeNull();
    expect(parseDob('94-06-15')).toBeNull();
  });
});

describe('the international picker (§2.1, ADR-0009)', () => {
  it('leads with the nine the wireframe shows, in its order, as the Common group', () => {
    expect(COMMON_COUNTRIES.map((c) => c.dial)).toEqual([
      '+44',
      '+353',
      '+48',
      '+39',
      '+34',
      '+40',
      '+91',
      '+234',
      '+55',
    ]);
    expect(COUNTRIES.slice(0, 9)).toEqual(COMMON_COUNTRIES);
  });

  // The wireframe's last option reads "… all countries". Sixty-two was not
  // that: an applicant from Finland, Mexico or Bangladesh could only submit
  // a wrong number, which then fed the §2.12 mobile+dob match.
  it('is every country, not a shortlist', () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(230);
    const isos = new Set(COUNTRIES.map((c) => c.iso));
    // The thirteen the audit found missing, and every EU/EEA member.
    for (const iso of [
      'FI',
      'LU',
      'IS',
      'BD',
      'NP',
      'ZW',
      'ET',
      'CO',
      'MX',
      'JP',
      'MD',
      'MK',
      'BA',
      'AT',
      'BE',
      'BG',
      'HR',
      'CY',
      'CZ',
      'DK',
      'EE',
      'FR',
      'DE',
      'GR',
      'HU',
      'IE',
      'IT',
      'LV',
      'LI',
      'LT',
      'MT',
      'NL',
      'NO',
      'PL',
      'PT',
      'RO',
      'SK',
      'SI',
      'ES',
      'SE',
      'CH',
      'GB',
      'US',
      'CA',
      'AU',
      'NZ',
      'ZA',
      'IN',
      'PK',
      'NG',
      'GH',
      'KE',
      'JM',
      'PH',
      'BR',
    ]) {
      expect(isos.has(iso), iso).toBe(true);
    }
  });

  it('every entry is an ISO alpha-2 code with a dialling code in E.164 shape', () => {
    for (const country of COUNTRIES) {
      expect(country.iso, country.name).toMatch(/^[A-Z]{2}$/);
      expect(country.dial, country.name).toMatch(/^\+[1-9]\d{0,3}$/);
      expect(country.name.trim().length, country.iso).toBeGreaterThan(0);
    }
  });

  // The picker is a controlled <select> whose value is the ISO code: the
  // displayed option is whichever one matches `value`, and a value listed
  // twice renders the LAST match when collapsed. +44 belongs to four
  // territories and +1 to more than twenty, so the dialling code cannot be
  // the value — but the ISO code must still be unique, and the two groups
  // disjoint (ADR-0009).
  it('never lists one ISO code twice, and the two groups are disjoint', () => {
    const isos = COUNTRIES.map((c) => c.iso);
    expect(new Set(isos).size).toBe(isos.length);
    const common = new Set(COMMON_COUNTRIES.map((c) => c.iso));
    expect(OTHER_COUNTRIES.filter((c) => common.has(c.iso))).toEqual([]);
  });

  it('lists the rest alphabetically by the name a person types to find it', () => {
    const names = OTHER_COUNTRIES.map((c) => c.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    expect(names).toEqual(sorted);
  });

  it('derives the flag from the ISO code and puts the dialling code first in the label', () => {
    expect(flagFor('GB')).toBe('🇬🇧');
    expect(flagFor('ie')).toBe('🇮🇪');
    expect(countryLabel({ iso: 'GB', name: 'United Kingdom', dial: '+44' })).toBe(
      '+44 🇬🇧 United Kingdom',
    );
  });

  it('looks a country up by ISO code, and knows nothing it never offered', () => {
    expect(countryFor('GB')?.dial).toBe('+44');
    expect(countryFor(' ie ')?.name).toBe('Ireland');
    expect(countryFor('ZZ')).toBeNull();
    expect(countryFor('')).toBeNull();
  });

  it('turns the picker’s choice and the typed number into E.164', () => {
    expect(phoneFor({ country: 'GB', mobile: '07700 900123' })).toBe('+447700900123');
    expect(phoneFor({ country: 'IE', mobile: '085 123 4567' })).toBe('+353851234567');
    expect(phoneFor({ country: 'JM', mobile: '555 1234' })).toBe('+18765551234');
    expect(phoneFor({ country: 'ZZ', mobile: '7700 900123' })).toBe('');
  });
});

describe('toE164', () => {
  it('drops the spaces a phone keyboard produces', () => {
    expect(toE164('+44', '7700 900123')).toBe('+447700900123');
  });

  it('drops the national trunk zero, which is how people say their own number', () => {
    expect(toE164('+44', '07700 900123')).toBe('+447700900123');
  });

  it('drops punctuation as well as spaces', () => {
    expect(toE164('+44', '(0)7700-900.123')).toBe('+447700900123');
  });

  it('keeps a non-UK number intact under its own code', () => {
    expect(toE164('+353', '85 123 4567')).toBe('+353851234567');
  });

  it('returns just the code for an empty number, which validate then rejects', () => {
    expect(toE164('+44', '')).toBe('+44');
  });
});

describe('validate (§2.1, §1.7)', () => {
  it('passes a complete, honest application', () => {
    expect(validate(values())).toEqual({});
  });

  it('rejects someone a day short of 18, with the wireframe’s wording', () => {
    expect(validate(values({ dob: dobForAge(18, 1) })).dob).toBe('You must be 18 or over to apply');
  });

  it('accepts someone on their eighteenth birthday', () => {
    expect(validate(values({ dob: dobForAge(18) })).dob).toBeUndefined();
  });

  it('asks for a date when none is given', () => {
    expect(validate(values({ dob: '' })).dob).toBe('Enter your date of birth');
  });

  it('separates an impossible date from an under-18 one', () => {
    const real = 'Enter a real date, as day, month and year';
    expect(validate(values({ dob: '1994-02-31' })).dob).toBe(real);
    expect(validate(values({ dob: dobForAge(-1) })).dob).toBe(real);
    expect(validate(values({ dob: '1890-01-01' })).dob).toBe(real);
  });

  it('requires the GDPR tick, and says why', () => {
    expect(validate(values({ consent: false })).consent).toBe(
      "Please tick the box to continue — we can't process your application without your consent",
    );
  });

  it('requires both names separately', () => {
    expect(validate(values({ firstName: '   ' })).firstName).toBe('Enter your first name');
    expect(validate(values({ lastName: '' })).lastName).toBe('Enter your surname');
  });

  it('distinguishes a missing email from a malformed one', () => {
    expect(validate(values({ email: '' })).email).toBe('Enter your email address');
    expect(validate(values({ email: 'not-an-email' })).email).toBe('Check your email address');
    expect(validate(values({ email: 'no@domain' })).email).toBe('Check your email address');
  });

  it('distinguishes a missing mobile from one that cannot be E.164', () => {
    expect(validate(values({ mobile: '' })).mobile).toBe('Enter your mobile number');
    expect(validate(values({ mobile: '12' })).mobile).toBe('Check your mobile number');
  });

  it('accepts the shortest and longest numbers E.164 allows', () => {
    // 7 digits is Norway's shortest national number; 15 is the E.164 ceiling.
    expect(validate(values({ country: 'NO', mobile: '1234567' })).mobile).toBeUndefined();
    expect(validate(values({ country: 'US', mobile: '23456789012345' })).mobile).toBeUndefined();
  });

  it('refuses a country the picker never offered, on the mobile field', () => {
    // Only reachable off the form: the <select> cannot submit a value it
    // does not list. The shape is what is wrong, so it says so.
    expect(validate(values({ country: 'ZZ' })).mobile).toBe('Check your mobile number');
    expect(validate(values({ country: '' })).mobile).toBe('Check your mobile number');
  });

  it('reports every broken field at once, not just the first', () => {
    const errors = validate(values({ dob: dobForAge(17), consent: false }));
    expect(Object.keys(errors).sort()).toEqual(['consent', 'dob']);
  });

  it('trims before judging, so trailing spaces are not an error', () => {
    expect(validate(values({ email: '  amara.kalu@example.com  ' })).email).toBeUndefined();
  });
});

describe('errorBanner', () => {
  it('says nothing when there is nothing to fix', () => {
    expect(errorBanner({})).toBeNull();
  });

  it('is singular for one field', () => {
    expect(errorBanner({ dob: 'x' })).toBe('Please fix the field highlighted below.');
  });

  it('counts the fields, as the wireframe does', () => {
    expect(errorBanner({ dob: 'x', consent: 'y' })).toBe(
      'Please fix the 2 fields highlighted below.',
    );
  });
});

describe('the empty form', () => {
  it('starts on the UK and an unticked box, and is not submittable', () => {
    expect(EMPTY_VALUES.country).toBe('GB');
    expect(countryFor(EMPTY_VALUES.country)?.dial).toBe('+44');
    expect(EMPTY_VALUES.consent).toBe(false);
    expect(Object.keys(validate(EMPTY_VALUES)).length).toBeGreaterThan(0);
  });
});

/**
 * §1.8: rules are evaluated in Europe/London. `submit_application()` judges
 * the age on `(now() at time zone 'Europe/London')::date` (120_apply.sql);
 * the form and the action must stand on the same calendar day, or between
 * 00:00 and 01:00 BST on someone's eighteenth birthday the action (UTC on
 * Vercel) refuses what the database would accept — and, because the form
 * only showed its own check after a submit, refuses it silently.
 */
describe('the age gate stands on the UK calendar day (§1.8, §2.1)', () => {
  // 15 June 23:30 UTC is 16 June 00:30 in London (BST).
  const halfPastMidnightBst = new Date('2026-06-15T23:30:00Z');
  // 15 June 22:30 UTC is 15 June 23:30 in London.
  const halfPastElevenBst = new Date('2026-06-15T22:30:00Z');
  // In January London is on UTC, so the day does not move.
  const winter = new Date('2026-01-15T23:30:00Z');

  it('turns an instant into the UK’s civil date, across the BST boundary', () => {
    const summer = ukTodayDate(halfPastMidnightBst);
    expect([summer.getFullYear(), summer.getMonth() + 1, summer.getDate()]).toEqual([2026, 6, 16]);
    const still = ukTodayDate(halfPastElevenBst);
    expect([still.getFullYear(), still.getMonth() + 1, still.getDate()]).toEqual([2026, 6, 15]);
    const jan = ukTodayDate(winter);
    expect([jan.getFullYear(), jan.getMonth() + 1, jan.getDate()]).toEqual([2026, 1, 15]);
  });

  it('accepts an eighteenth birthday the moment it arrives in London, not in UTC', () => {
    const born = '2008-06-16';
    expect(validate(values({ dob: born }), halfPastMidnightBst).dob).toBeUndefined();
    expect(validate(values({ dob: born }), halfPastElevenBst).dob).toBe(
      'You must be 18 or over to apply',
    );
  });

  it('judges “in the future” on the same day', () => {
    const real = 'Enter a real date, as day, month and year';
    expect(validate(values({ dob: '2026-06-17' }), halfPastMidnightBst).dob).toBe(real);
    // Born today is not a date in the future; it is an under-18.
    expect(validate(values({ dob: '2026-06-16' }), halfPastMidnightBst).dob).toBe(
      'You must be 18 or over to apply',
    );
  });

  it('ageOn defaults to the UK’s today', () => {
    const today = ukTodayDate();
    expect(ageOn(today)).toBe(0);
    expect(ageOn(new Date(today.getFullYear() - 18, today.getMonth(), today.getDate()))).toBe(18);
  });
});

/**
 * After the first submit the form used to show only its own check, so a
 * refusal only the server could make was discarded on arrival: no banner,
 * no field error, no redirect. The server's errors are now kept for any
 * value the person has not changed since.
 */
describe('visibleErrors', () => {
  const typed = values({ dob: '2008-06-16' });

  it('keeps a server refusal of a value the browser thinks is fine', () => {
    const server = { errors: { dob: 'You must be 18 or over to apply' }, values: typed };
    expect(visibleErrors({}, server, typed)).toEqual({ dob: 'You must be 18 or over to apply' });
  });

  it('drops it as soon as that field changes', () => {
    const server = { errors: { dob: 'You must be 18 or over to apply' }, values: typed };
    expect(visibleErrors({}, server, { ...typed, dob: '1994-06-15' })).toEqual({});
  });

  it('never overrides what the browser sees now', () => {
    const server = { errors: { dob: 'server says no' }, values: typed };
    expect(visibleErrors({ dob: 'browser says no' }, server, typed)).toEqual({
      dob: 'browser says no',
    });
  });

  it('adds nothing when the server had nothing to say', () => {
    expect(visibleErrors({ email: 'x' }, INITIAL_STATE, typed)).toEqual({ email: 'x' });
  });
});
