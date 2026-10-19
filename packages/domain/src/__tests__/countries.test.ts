import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PASSPORT_COUNTRIES,
  PASSPORT_COUNTRY_NAMES,
  knownPassportCountry,
  passportCountryFromCode,
} from '../countries.ts';

/**
 * ADR-0159. The list exists twice: here, and `known_countries()` in the
 * migration, which `staff.passport_country`'s CHECK is held to. This reads
 * the migration and holds the two to each other.
 */
const MIGRATION = join(
  import.meta.dirname,
  '../../../../supabase/migrations/20261019120000_new_starter_passport_country_and_address_lines.sql',
);
const sql = readFileSync(MIGRATION, 'utf8');

function sqlCountries(): string[] {
  const start = sql.indexOf('create or replace function public.known_countries()');
  expect(start, 'known_countries() is still in the migration').toBeGreaterThan(-1);
  const block = sql.slice(start, sql.indexOf('$$;', start));
  return [...block.matchAll(/'((?:[^']|'')+)'/g)].map(([, name]) => name!.replace(/''/g, "'"));
}

describe('the list (ADR-0159)', () => {
  it('is the same list, in the same order, as known_countries()', () => {
    expect(sqlCountries()).toEqual([...PASSPORT_COUNTRY_NAMES]);
  });

  it('has no repeated code or name, and every code is three letters', () => {
    const codes = PASSPORT_COUNTRIES.map(([code]) => code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(PASSPORT_COUNTRY_NAMES).size).toBe(PASSPORT_COUNTRY_NAMES.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{3}$/);
  });

  it('names the countries THC most often sees', () => {
    for (const name of [
      'United Kingdom',
      'Ireland',
      'Poland',
      'Italy',
      'Spain',
      'Romania',
      'India',
      'Nigeria',
      'Brazil',
    ]) {
      expect(PASSPORT_COUNTRY_NAMES).toContain(name);
    }
  });
});

describe('passportCountryFromCode', () => {
  it('maps the issuing-state code printed in the MRZ to the country', () => {
    expect(passportCountryFromCode('GBR')).toBe('United Kingdom');
    expect(passportCountryFromCode('pol')).toBe('Poland');
    expect(passportCountryFromCode(' IRL ')).toBe('Ireland');
  });

  it("reads Germany's bare D (with its filler) and the UK's other nationality statuses", () => {
    expect(passportCountryFromCode('D<<')).toBe('Germany');
    expect(passportCountryFromCode('D')).toBe('Germany');
    expect(passportCountryFromCode('GBN')).toBe('United Kingdom');
    expect(passportCountryFromCode('GBD')).toBe('United Kingdom');
    expect(passportCountryFromCode('XKX')).toBe('Kosovo');
  });

  it('returns null for anything that is not a code on the list', () => {
    for (const value of ['', 'ZZZ', 'United Kingdom', 'GBRR', '123', null, undefined, 42]) {
      expect(passportCountryFromCode(value)).toBeNull();
    }
  });
});

describe('knownPassportCountry', () => {
  it('returns the name as the list spells it, whatever the case or spacing', () => {
    expect(knownPassportCountry(' united   kingdom ')).toBe('United Kingdom');
    expect(knownPassportCountry('Poland')).toBe('Poland');
  });

  it('returns null for a name off the list', () => {
    expect(knownPassportCountry('Narnia')).toBeNull();
    expect(knownPassportCountry('')).toBeNull();
    expect(knownPassportCountry(null)).toBeNull();
  });
});
