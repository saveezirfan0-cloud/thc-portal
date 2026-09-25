import { describe, expect, it } from 'vitest';
import {
  DIAL_CODES,
  EMPTY_VALUES,
  ageBandFor,
  ageOn,
  errorBanner,
  parseDob,
  toE164,
  todayInUk,
  validate,
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
    dialCode: '+44',
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

describe('the dialling picker (§2.1)', () => {
  it('leads with the nine codes the wireframe shows, in its order', () => {
    expect(DIAL_CODES.slice(0, 9).map((c) => c.code)).toEqual([
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
  });

  it('every entry carries a dialling code in E.164 shape', () => {
    for (const country of DIAL_CODES) expect(country.code).toMatch(/^\+[1-9]\d{0,3}$/);
  });

  // The picker is a controlled <select>: its displayed option is whichever
  // one matches `value`. Two options sharing a code meant choosing the
  // second snapped the display back to the first — Canada and the US both
  // carried '+1' until they were merged into one entry.
  it('never lists one dialling code twice', () => {
    const seen = DIAL_CODES.map((c) => c.code);
    expect(new Set(seen).size).toBe(seen.length);
  });

  // §2.1 "international picker", apply.html "… all countries": every ITU
  // country code, one row each. A missing code is a wrong number stored in
  // E.164 and every later SMS to it (§2.12).
  it('covers every country — the EU/EEA, the Commonwealth and the rest of the ITU list', () => {
    const codes = new Set<string>(DIAL_CODES.map((c) => c.code));
    const euEea = [
      '+43',
      '+32',
      '+359',
      '+385',
      '+357',
      '+420',
      '+45',
      '+372',
      '+358',
      '+33',
      '+49',
      '+30',
      '+36',
      '+353',
      '+39',
      '+371',
      '+370',
      '+352',
      '+356',
      '+31',
      '+48',
      '+351',
      '+40',
      '+421',
      '+386',
      '+34',
      '+46',
      '+354',
      '+423',
      '+47',
    ];
    const commonwealth = [
      '+880',
      '+263',
      '+94',
      '+254',
      '+256',
      '+255',
      '+233',
      '+234',
      '+92',
      '+91',
      '+27',
      '+61',
      '+64',
      '+60',
      '+65',
      '+230',
      '+679',
      '+675',
      '+260',
      '+265',
      '+267',
      '+1',
    ];
    const elsewhere = [
      '+81',
      '+52',
      '+57',
      '+373',
      '+389',
      '+387',
      '+977',
      '+251',
      '+374',
      '+994',
      '+998',
      '+7',
      '+20',
      '+212',
      '+966',
      '+971',
      '+972',
      '+90',
      '+84',
      '+63',
      '+62',
      '+86',
      '+82',
      '+55',
      '+54',
      '+56',
      '+51',
      '+58',
    ];
    for (const code of [...euEea, ...commonwealth, ...elsewhere])
      expect(codes.has(code), code).toBe(true);
    expect(codes.size).toBeGreaterThanOrEqual(200);
  });

  it('names every row, so type-ahead by country finds it', () => {
    for (const country of DIAL_CODES) expect(country.name.length).toBeGreaterThan(1);
  });
});

describe('the age gate runs on the UK calendar day (§1.8, §2.1)', () => {
  // 2026-06-20T23:30Z is 00:30 BST on 21 June — already the 21st in London,
  // still the 20th in UTC (Vercel) and further west.
  const bstMidnight = new Date('2026-06-20T23:30:00Z');

  it('todayInUk is the London civil date, not the process zone’s', () => {
    const today = todayInUk(bstMidnight);
    expect([today.getFullYear(), today.getMonth() + 1, today.getDate()]).toEqual([2026, 6, 21]);
  });

  it('accepts an applicant on the UK morning of their 18th birthday, as submit_application() does', () => {
    const today = todayInUk(bstMidnight);
    expect(validate(values({ dob: '2008-06-21' }), today).dob).toBeUndefined();
    expect(validate(values({ dob: '2008-06-22' }), today).dob).toBe(
      'You must be 18 or over to apply',
    );
  });

  it('judges "in the future" against the same UK day', () => {
    const today = todayInUk(bstMidnight);
    expect(validate(values({ dob: '2026-06-21' }), today).dob).toBe(
      'You must be 18 or over to apply',
    );
    expect(validate(values({ dob: '2026-06-22' }), today).dob).toBe(
      'Enter a real date, as day, month and year',
    );
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
    expect(validate(values({ dialCode: '+47', mobile: '1234567' })).mobile).toBeUndefined();
    expect(validate(values({ dialCode: '+1', mobile: '23456789012345' })).mobile).toBeUndefined();
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
  it('starts on +44 and an unticked box, and is not submittable', () => {
    expect(EMPTY_VALUES.dialCode).toBe('+44');
    expect(EMPTY_VALUES.consent).toBe(false);
    expect(Object.keys(validate(EMPTY_VALUES)).length).toBeGreaterThan(0);
  });
});
