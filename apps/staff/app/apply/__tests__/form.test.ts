import { describe, expect, it } from 'vitest';
import { AGE_OPTIONS, DIAL_CODES, EMPTY_VALUES, errorBanner, toE164, validate } from '../form';
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
    ageBand: '24',
    consent: true,
    ...over,
  };
}

describe('the age select (§2.1)', () => {
  it('offers Under 18 so the form can reject it honestly, rather than hiding the case', () => {
    expect(AGE_OPTIONS[0]).toEqual({ value: 'under_18', label: 'Under 18' });
  });

  it('lists every year from 18 to 30, then the bands the wireframe shows', () => {
    const labels = AGE_OPTIONS.map((o) => o.label);
    expect(labels.slice(1, 14)).toEqual(Array.from({ length: 13 }, (_, i) => String(18 + i)));
    expect(labels.slice(14)).toEqual(['31 – 40', '41 – 50', '51 – 60', '60+']);
  });

  it('has no duplicate values, so a band cannot be submitted ambiguously', () => {
    const seen = AGE_OPTIONS.map((o) => o.value);
    expect(new Set(seen).size).toBe(seen.length);
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

  it('rejects Under 18 with the wireframe’s wording', () => {
    expect(validate(values({ ageBand: 'under_18' })).ageBand).toBe(
      'You must be 18 or over to apply',
    );
  });

  it('rejects an age band the form never offered, rather than letting it through', () => {
    expect(validate(values({ ageBand: '17' })).ageBand).toBe('You must be 18 or over to apply');
  });

  it('asks for an age when none is chosen', () => {
    expect(validate(values({ ageBand: '' })).ageBand).toBe('Select your age');
  });

  it('accepts every 18-plus band the select offers', () => {
    for (const option of AGE_OPTIONS) {
      if (option.value === 'under_18') continue;
      expect(validate(values({ ageBand: option.value })).ageBand).toBeUndefined();
    }
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
    const errors = validate(values({ ageBand: 'under_18', consent: false }));
    expect(Object.keys(errors).sort()).toEqual(['ageBand', 'consent']);
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
    expect(errorBanner({ ageBand: 'x' })).toBe('Please fix the field highlighted below.');
  });

  it('counts the fields, as the wireframe does', () => {
    expect(errorBanner({ ageBand: 'x', consent: 'y' })).toBe(
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
