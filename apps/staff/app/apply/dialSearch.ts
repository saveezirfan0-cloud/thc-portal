/**
 * Search over `DIAL_CODES` for the country-code picker (ADR-0064).
 *
 * An applicant finds their code by typing any of: the country's name or the
 * start of it ("fra", "united k"), a word in it ("kingdom"), its initials
 * ("uae"), its two-letter ISO code ("de", "gb"), a common other name ("uk",
 * "holland", "ivory coast"), or the digits of the code itself ("44", "+44",
 * "0044"). Accents, case and apostrophes do not matter ("cote d ivoire").
 *
 * Pure, so the ranking is unit-tested without a DOM.
 */

import { DIAL_CODES } from './form';

export type DialCode = (typeof DIAL_CODES)[number];

/**
 * The wireframe's nine, which lead the unfiltered list under "Common"
 * (form.ts keeps them first, in the wireframe's order).
 */
export const COMMON_COUNT = 9;

/** Names people type that the list does not carry, keyed by dialling code. */
const ALIASES: Record<string, readonly string[]> = {
  '+44': ['uk', 'britain', 'great britain', 'england', 'scotland', 'wales', 'northern ireland'],
  '+1': ['usa', 'america', 'united states of america'],
  '+31': ['holland'],
  '+420': ['czech republic'],
  '+225': ['ivory coast'],
  '+95': ['burma'],
  '+268': ['swaziland'],
  '+82': ['korea'],
  '+971': ['emirates', 'dubai', 'abu dhabi'],
  '+7': ['russian federation'],
  '+90': ['turkiye'],
  '+389': ['macedonia'],
  '+243': ['drc', 'democratic republic of the congo'],
};

/** Lowercase, accents and apostrophes gone, runs of anything else → one space. */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** `🇬🇧` → `gb`; a row shared by two territories (`🇺🇸🇨🇦`) yields both. */
export function isoCodesOf(label: string): string[] {
  const letters = [...label]
    .map((ch) => ch.codePointAt(0)!)
    .filter((cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff)
    .map((cp) => String.fromCharCode(cp - 0x1f1e6 + 97));
  const codes: string[] = [];
  for (let i = 0; i + 1 < letters.length; i += 2) codes.push(letters[i]! + letters[i + 1]!);
  return codes;
}

/** "United Arab Emirates" → `uae`; small joining words are skipped. */
function initialsOf(name: string): string {
  return normalise(name)
    .split(' ')
    .filter((w) => w && !['and', 'of', 'the', 'da', 'd'].includes(w))
    .map((w) => w[0])
    .join('');
}

/** The flag alone: the label is `🇬🇧 +44`. */
export function flagOf(entry: DialCode): string {
  return entry.label.slice(0, entry.label.lastIndexOf(' +')).trim();
}

interface Indexed {
  entry: DialCode;
  name: string;
  /** The name without spaces, so "cote d ivoire" finds "Côte d’Ivoire". */
  compact: string;
  words: string[];
  exact: Set<string>;
  digits: string;
}

const INDEX: Indexed[] = DIAL_CODES.map((entry) => {
  const name = normalise(entry.name);
  const aliases = (ALIASES[entry.code] ?? []).map(normalise);
  return {
    entry,
    name,
    compact: name.replace(/ /g, ''),
    words: [name, ...aliases].flatMap((n) => n.split(' ')),
    exact: new Set([...isoCodesOf(entry.label), initialsOf(entry.name), ...aliases]),
    digits: entry.code.slice(1),
  };
});

/**
 * The rows matching `query`, best first. An empty query returns the list as
 * it is (common nine, then A → Z). Within a rank, rows keep that order, so
 * the common countries surface first among equals.
 *
 * Ranks: 0 the whole name, an ISO code, the initials or an alias typed
 * exactly, or the exact dialling code; 1 the name starts with it, or the
 * code starts with the digits; 2 any word starts with it; 3 it appears
 * anywhere in the name.
 */
export function searchDialCodes(query: string): DialCode[] {
  const raw = query.trim();
  if (!raw) return [...DIAL_CODES];

  // "+44", "0044", "44", "+1 " — a code, not a name.
  const digits = /^\+?[\d\s]+$/.test(raw) ? raw.replace(/\D/g, '').replace(/^00/, '') : null;
  if (digits !== null) {
    if (!digits) return [];
    return rank(INDEX, (row) =>
      row.digits === digits ? 0 : row.digits.startsWith(digits) ? 1 : null,
    );
  }

  const q = normalise(raw);
  if (!q) return [];
  const qc = q.replace(/ /g, '');
  return rank(INDEX, (row) => {
    if (row.name === q || row.compact === qc || row.exact.has(q)) return 0;
    if (row.name.startsWith(q) || row.compact.startsWith(qc)) return 1;
    if (row.words.some((w) => w.startsWith(q))) return 2;
    if (row.compact.includes(qc)) return 3;
    return null;
  });
}

function rank(rows: Indexed[], score: (row: Indexed) => number | null): DialCode[] {
  return rows
    .map((row, i) => ({ row, i, s: score(row) }))
    .filter((r): r is { row: Indexed; i: number; s: number } => r.s !== null)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((r) => r.row.entry);
}
