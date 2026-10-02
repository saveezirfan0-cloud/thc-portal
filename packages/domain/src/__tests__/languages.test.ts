import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ENGLISH,
  LANGUAGES,
  extraLanguages,
  formatLanguages,
  isLanguage,
  missingLanguages,
  normaliseLanguages,
  requiredLanguagesLabel,
} from '../languages.ts';
import { HARD_GATES, showsUnderUnavailable } from '../scoring.ts';

/**
 * ADR-0080. The list exists twice: here, and `known_languages()` in the
 * migration, which the database's CHECKs are held to. This reads the
 * migration and holds the two to each other.
 */
const MIGRATION = join(
  import.meta.dirname,
  '../../../../supabase/migrations/20261002108000_languages_spoken.sql',
);
const sql = readFileSync(MIGRATION, 'utf8');

function sqlLanguages(): string[] {
  const start = sql.indexOf('create or replace function public.known_languages()');
  expect(start, 'known_languages() is still in the migration').toBeGreaterThan(-1);
  const block = sql.slice(start, sql.indexOf('$$;', start));
  return [...block.matchAll(/'([^']+)'/g)].map(([, name]) => name!);
}

describe('the list (ADR-0080)', () => {
  it('is the same list, in the same order, as known_languages()', () => {
    expect(sqlLanguages()).toEqual([...LANGUAGES]);
  });

  it('starts with English, then runs A → Z with no repeats', () => {
    expect(LANGUAGES[0]).toBe(ENGLISH);
    const rest = LANGUAGES.slice(1);
    expect([...rest].sort()).toEqual(rest);
    expect(new Set(LANGUAGES).size).toBe(LANGUAGES.length);
  });

  it('knows its own members only', () => {
    expect(isLanguage('Spanish')).toBe(true);
    expect(isLanguage('spanish')).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });
});

describe('a list as it is stored', () => {
  it('always has English, drops repeats and unknowns, and keeps list order', () => {
    expect(normaliseLanguages(['Spanish', ' Arabic ', 'Spanish', 'Klingon'])).toEqual([
      'English',
      'Arabic',
      'Spanish',
    ]);
    expect(normaliseLanguages(null)).toEqual(['English']);
    expect(normaliseLanguages([])).toEqual(['English']);
  });

  it('counts only the languages besides English as a requirement', () => {
    expect(extraLanguages(['English'])).toEqual([]);
    expect(extraLanguages(['English', 'Spanish', 'French'])).toEqual(['French', 'Spanish']);
  });
});

describe('the two gates, in TypeScript (auto_assign_candidates)', () => {
  it('an English-only event needs nothing of anyone, asked or not', () => {
    expect(missingLanguages(['English'], null)).toEqual([]);
    expect(missingLanguages(['English'], ['English'])).toEqual([]);
  });

  it('never asked reads as not shown to speak it (languages_not_recorded)', () => {
    expect(missingLanguages(['English', 'Spanish'], null)).toBeNull();
  });

  it('every language the event names is needed (language_not_spoken)', () => {
    expect(missingLanguages(['English', 'Spanish'], ['English', 'Spanish'])).toEqual([]);
    expect(missingLanguages(['English', 'French', 'Spanish'], ['English', 'Spanish'])).toEqual([
      'French',
    ]);
  });

  it('hides a worker who does not speak it and lists one never asked', () => {
    expect(HARD_GATES).toContain('language_not_spoken');
    expect(HARD_GATES).toContain('languages_not_recorded');
    expect(showsUnderUnavailable('language_not_spoken')).toBe(false);
    expect(showsUnderUnavailable('languages_not_recorded')).toBe(true);
  });
});

describe('how a requirement reads', () => {
  it('names the languages besides English, or nothing', () => {
    expect(requiredLanguagesLabel(['English'])).toBeNull();
    expect(requiredLanguagesLabel(['English', 'Spanish'])).toBe('Spanish speakers');
    expect(requiredLanguagesLabel(['English', 'Spanish', 'French'])).toBe(
      'French & Spanish speakers',
    );
    expect(formatLanguages(['Arabic', 'French', 'Spanish'])).toBe('Arabic, French & Spanish');
  });
});
