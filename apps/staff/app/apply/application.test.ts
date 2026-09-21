import { describe, expect, it } from 'vitest';
import {
  AGE_BANDS,
  errorForDatabaseCode,
  emptyDraft,
  isAdultBand,
  MESSAGES,
  summaryMessage,
  toE164,
  UNDER_18,
  validateApplication,
  type ApplicationDraft,
} from './application';
import {
  COMMON_COUNTRIES,
  COUNTRIES,
  country,
  flag,
  optionLabel,
  OTHER_COUNTRIES,
} from './countries';

function draft(over: Partial<ApplicationDraft> = {}): ApplicationDraft {
  return {
    ...emptyDraft(),
    firstName: 'Amara',
    lastName: 'Kalu',
    email: 'amara.kalu@example.com',
    country: 'GB',
    mobile: '7700 900123',
    ageBand: '22',
    consent: true,
    ...over,
  };
}

// ---------------------------------------------------------------------
// §2.1 / §1.7 — age >= 18, on the form. The server half of the same gate
// lives in submit_application (0005_public_application.sql) and is
// covered by supabase/tests/070_applications.sql.
// ---------------------------------------------------------------------
describe('the age gate (§2.1, §1.7)', () => {
  it('rejects Under 18 with the wireframe copy and creates nothing', () => {
    const result = validateApplication(draft({ ageBand: UNDER_18 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.ageBand).toBe('You must be 18 or over to apply');
  });

  it('rejects a band the select never offered, the same as Under 18', () => {
    // A tampered <select> is the only way to get here; it must not slip
    // through just because it is not the literal string 'under_18'.
    const result = validateApplication(draft({ ageBand: '16' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.ageBand).toBe(MESSAGES.ageUnder18);
  });

  it('asks for an age when none was chosen', () => {
    const result = validateApplication(draft({ ageBand: '' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.ageBand).toBe(MESSAGES.ageMissing);
  });

  it('accepts every band the select offers from 18 upwards', () => {
    for (const band of AGE_BANDS) {
      const expected = band.value !== UNDER_18;
      expect(isAdultBand(band.value), band.value).toBe(expected);
      expect(validateApplication(draft({ ageBand: band.value })).ok, band.value).toBe(expected);
    }
  });

  it('offers Under 18 exactly once, and only so the form can refuse it', () => {
    expect(AGE_BANDS.filter((b) => b.value === UNDER_18)).toHaveLength(1);
    expect(AGE_BANDS[0]?.value).toBe(UNDER_18);
    expect(AGE_BANDS[1]?.label).toBe('18');
  });

  it('repeats the same message when the database refuses a tampered form', () => {
    expect(errorForDatabaseCode('apply_under_18').ageBand).toBe(MESSAGES.ageUnder18);
    expect(errorForDatabaseCode('apply_age_required').ageBand).toBe(MESSAGES.ageMissing);
  });
});

// ---------------------------------------------------------------------
// §1.7 — GDPR consent is mandatory
// ---------------------------------------------------------------------
describe('GDPR consent (§1.7)', () => {
  it('is required, with the wireframe copy', () => {
    const result = validateApplication(draft({ consent: false }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.consent).toBe(
      "Please tick the box to continue — we can't process your application without your consent",
    );
  });

  it('is refused by the database too', () => {
    expect(errorForDatabaseCode('apply_consent_required').consent).toBe(MESSAGES.consent);
  });
});

// ---------------------------------------------------------------------
// §2.1 — Mobile, international picker, stored in E.164
// ---------------------------------------------------------------------
describe('the mobile number (§2.1)', () => {
  it('builds E.164 from the picker and the national number', () => {
    expect(toE164('GB', '7700 900123')).toBe('+447700900123');
    expect(toE164('IE', '85 123 4567')).toBe('+353851234567');
    expect(toE164('NG', '802 123 4567')).toBe('+2348021234567');
  });

  it('drops the trunk prefix people actually type', () => {
    expect(toE164('GB', '07700 900123')).toBe('+447700900123');
    expect(toE164('GB', '(07700) 900-123')).toBe('+447700900123');
  });

  it('lets a pasted international number override the picker', () => {
    expect(toE164('GB', '+48 512 345 678')).toBe('+48512345678');
    expect(toE164('GB', '0048512345678')).toBe('+48512345678');
  });

  it('refuses anything that is not a plausible E.164 number', () => {
    expect(toE164('GB', '')).toBeNull();
    expect(toE164('GB', '1234')).toBeNull(); // too short to be E.164 at all
    expect(toE164('GB', 'not a number')).toBeNull();
    expect(toE164('GB', '0')).toBeNull();
    expect(toE164('ZZ', '7700900123')).toBeNull(); // no such country in the picker
    expect(toE164('GB', '+0700900123')).toBeNull(); // no country dials from 0
    expect(toE164('GB', '7700 900 123 456 789')).toBeNull(); // past E.164's 15 digits
  });

  it('checks the shape, not the country-by-country length', () => {
    // E.164 itself allows 7 digits, and some territories really do have
    // short national numbers, so a length rule per country would need
    // libphonenumber's data. It is not worth a dependency here: the number
    // is proved by the applicant answering on it, the same way the email
    // is proved by the interview link landing.
    expect(toE164('GB', '12345')).toBe('+4412345');
  });

  it('reports a missing number differently from an unusable one', () => {
    const missing = validateApplication(draft({ mobile: '' }));
    const unusable = validateApplication(draft({ mobile: '123' }));
    expect(missing.ok || unusable.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.mobile).toBe(MESSAGES.mobileMissing);
    if (!unusable.ok) expect(unusable.errors.mobile).toBe(MESSAGES.mobileInvalid);
  });
});

// ---------------------------------------------------------------------
// §2.1 — the international picker itself
// ---------------------------------------------------------------------
describe('the country picker (§2.1)', () => {
  it('is genuinely international, not a shortlist', () => {
    expect(COUNTRIES.length).toBeGreaterThan(190);
  });

  it('has one entry per ISO code, each with a dialling code', () => {
    expect(new Set(COUNTRIES.map((c) => c.iso)).size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) {
      expect(c.iso, c.name).toMatch(/^[A-Z]{2}$/);
      expect(c.dial, c.name).toMatch(/^[1-9]\d{0,3}$/);
    }
  });

  it('pins the nine the wireframe names, UK first', () => {
    expect(COMMON_COUNTRIES[0]?.iso).toBe('GB');
    expect(COMMON_COUNTRIES.map((c) => c.iso)).toEqual([
      'GB',
      'IE',
      'PL',
      'IT',
      'ES',
      'RO',
      'IN',
      'NG',
      'BR',
    ]);
  });

  it('derives the flag from the ISO code', () => {
    expect(flag('GB')).toBe('🇬🇧');
    expect(flag('NG')).toBe('🇳🇬');
  });

  it('keeps the territories that share +44 separate', () => {
    expect(country('GB')?.dial).toBe('44');
    expect(country('JE')?.dial).toBe('44');
    expect(country('GB')?.name).not.toBe(country('JE')?.name);
  });

  it('never offers the same country twice', () => {
    // A <select> with a repeated value shows the LAST match when
    // collapsed, so the two option groups have to be disjoint.
    const all = [...COMMON_COUNTRIES, ...OTHER_COUNTRIES].map((c) => c.iso);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(COUNTRIES.length);
  });

  it('puts the dialling code first, so a clipped picker still reads', () => {
    expect(optionLabel(COMMON_COUNTRIES[0]!)).toBe('+44 🇬🇧 United Kingdom');
  });

  it('lists the rest alphabetically by country name', () => {
    const names = OTHER_COUNTRIES.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });
});

// ---------------------------------------------------------------------
// The rest of the form
// ---------------------------------------------------------------------
describe('the form as a whole', () => {
  it('accepts a complete application and normalises what it returns', () => {
    const result = validateApplication(
      draft({ firstName: '  Amara ', lastName: ' Kalu ', email: ' amara.kalu@example.com ' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      firstName: 'Amara',
      lastName: 'Kalu',
      email: 'amara.kalu@example.com',
      phone: '+447700900123',
      ageBand: '22',
    });
  });

  it('requires both names and an email that could exist', () => {
    const result = validateApplication(
      draft({ firstName: '   ', lastName: '', email: 'amara.kalu@' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.firstName).toBe(MESSAGES.firstName);
    expect(result.errors.lastName).toBe(MESSAGES.lastName);
    expect(result.errors.email).toBe(MESSAGES.emailInvalid);
  });

  it('counts the highlighted fields in the banner, as the wireframe does', () => {
    const result = validateApplication(draft({ ageBand: UNDER_18, consent: false }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(summaryMessage(result.errors)).toBe('Please fix the 2 fields highlighted below.');
    expect(summaryMessage({ consent: MESSAGES.consent })).toBe(
      'Please fix the field highlighted below.',
    );
    expect(summaryMessage({})).toBeNull();
  });

  it('starts empty, with the UK picked and consent untaken', () => {
    const blank = emptyDraft();
    expect(blank.country).toBe('GB');
    expect(blank.consent).toBe(false);
    expect(blank.ageBand).toBe('');
    expect(validateApplication(blank).ok).toBe(false);
  });

  it('falls back to no field error for a database failure it does not know', () => {
    expect(errorForDatabaseCode('could not connect to server')).toEqual({});
  });
});
