/**
 * Languages spoken — ADR-0080 (THC request 01.10.2026).
 *
 * A worker says which languages they speak on onboarding step 2
 * (`staff.languages`), and an event can need staff who speak more than
 * English (`events.required_languages`). English is the base: every worker
 * THC books speaks it — the induction, the quiz and the contract are all in
 * English — so it is always on both lists and never gates anyone. Any other
 * language an event names is a hard gate in `auto_assign_candidates()`:
 *
 *   * `languages_not_recorded` — nothing on file (never asked). Shown under
 *     Unavailable, so the office can record it.
 *   * `language_not_spoken` — on file, and one of the event's languages is
 *     not among them. No row on the board, like the other gender
 *     (ADR-0079).
 *
 * A worker must speak EVERY language the event names.
 *
 * SQL twin: `known_languages()` and `normalise_languages()` in migration
 * 20261002108000; pgTAP 768 and `languages.test.ts` hold the two lists to
 * each other.
 */

export const ENGLISH = 'English';

/**
 * Every language either list may name: English first, then A → Z. A
 * fixed list rather than free text, so "Spanish", "spanish" and "Español"
 * can never be three different requirements. Adding one is a migration
 * that restates `known_languages()`.
 */
export const LANGUAGES = [
  'English',
  'Albanian',
  'Arabic',
  'Bengali',
  'British Sign Language',
  'Bulgarian',
  'Cantonese',
  'Croatian',
  'Czech',
  'Danish',
  'Dutch',
  'Farsi',
  'Finnish',
  'French',
  'German',
  'Greek',
  'Gujarati',
  'Hebrew',
  'Hindi',
  'Hungarian',
  'Igbo',
  'Italian',
  'Japanese',
  'Korean',
  'Kurdish',
  'Latvian',
  'Lithuanian',
  'Malay',
  'Mandarin',
  'Nepali',
  'Norwegian',
  'Pashto',
  'Polish',
  'Portuguese',
  'Punjabi',
  'Romanian',
  'Russian',
  'Serbian',
  'Sinhala',
  'Slovak',
  'Somali',
  'Spanish',
  'Swahili',
  'Swedish',
  'Tagalog',
  'Tamil',
  'Thai',
  'Turkish',
  'Twi',
  'Ukrainian',
  'Urdu',
  'Vietnamese',
  'Welsh',
  'Yoruba',
] as const;

export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * A list as it is stored: known languages only, English always in, no
 * duplicates, in `LANGUAGES` order. The database's `normalise_languages()`
 * refuses an unknown one; here it is dropped, because the pickers only
 * ever offer the list.
 */
export function normaliseLanguages(values: readonly string[] | null | undefined): Language[] {
  const picked = new Set((values ?? []).map((v) => v.trim()));
  return LANGUAGES.filter((language) => language === ENGLISH || picked.has(language));
}

/** The languages an event needs besides English — the ones that gate anyone. */
export function extraLanguages(required: readonly string[] | null | undefined): Language[] {
  return normaliseLanguages(required).filter((language) => language !== ENGLISH);
}

/**
 * Which of the event's languages the worker is not shown to speak — the
 * TypeScript twin of the two gates. `null` when the worker was never asked
 * and the event needs more than English (`languages_not_recorded`); an
 * empty list when nothing is missing.
 */
export function missingLanguages(
  required: readonly string[] | null | undefined,
  spoken: readonly string[] | null | undefined,
): Language[] | null {
  const extra = extraLanguages(required);
  if (extra.length === 0) return [];
  if (spoken === null || spoken === undefined) return null;
  return extra.filter((language) => !spoken.includes(language));
}

/** "Spanish", "French & Spanish", "Arabic, French & Spanish". */
export function formatLanguages(languages: readonly string[]): string {
  if (languages.length <= 1) return languages.join('');
  return `${languages.slice(0, -1).join(', ')} & ${languages[languages.length - 1]}`;
}

/**
 * The pill on an event that needs more than English — "Spanish speakers",
 * "French & Spanish speakers" — or null for an English-only event.
 */
export function requiredLanguagesLabel(
  required: readonly string[] | null | undefined,
): string | null {
  const extra = extraLanguages(required);
  return extra.length === 0 ? null : `${formatLanguages(extra)} speakers`;
}
