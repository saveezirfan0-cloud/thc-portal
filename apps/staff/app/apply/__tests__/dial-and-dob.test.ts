import { describe, expect, it } from 'vitest';
import { searchDialCodes, isoCodesOf, normalise, COMMON_COUNT } from '../dialSearch';
import { dobValueFrom, formatDobTyping } from '../dob';
import { DIAL_CODES, parseDob } from '../form';

/**
 * ADR-0064: the searchable dialling-code picker and the typed date of birth.
 * Pure halves only; `pickers.test.tsx` drives the components.
 */

const names = (q: string) => searchDialCodes(q).map((c) => c.name);
const first = (q: string) => searchDialCodes(q)[0]?.code;

describe('dialling-code search', () => {
  it('an empty query is the whole list, common nine first', () => {
    expect(searchDialCodes('')).toEqual([...DIAL_CODES]);
    expect(searchDialCodes('  ')).toHaveLength(DIAL_CODES.length);
    expect(DIAL_CODES[COMMON_COUNT - 1]?.name).toBe('Brazil');
  });

  it('finds a country by its name, the start of it, or a word in it', () => {
    expect(first('France')).toBe('+33');
    expect(first('fra')).toBe('+33');
    expect(first('united k')).toBe('+44');
    expect(names('kingdom')).toContain('United Kingdom');
    expect(first('canada')).toBe('+1');
  });

  it('ignores case, accents and apostrophes', () => {
    expect(first('COTE D IVOIRE')).toBe('+225');
    expect(first('côte d’ivoire')).toBe('+225');
    expect(first('sao tome')).toBe('+239');
    expect(normalise('Côte d’Ivoire')).toBe('cote divoire');
  });

  it('finds a country by initials, ISO code or a common other name', () => {
    expect(first('uk')).toBe('+44');
    expect(first('gb')).toBe('+44');
    expect(first('uae')).toBe('+971');
    expect(first('de')).toBe('+49');
    expect(first('usa')).toBe('+1');
    expect(first('holland')).toBe('+31');
    expect(first('ivory coast')).toBe('+225');
    expect(first('england')).toBe('+44');
  });

  it('finds a code by its digits, with or without + or 00', () => {
    expect(first('44')).toBe('+44');
    expect(first('+44')).toBe('+44');
    expect(first('0044')).toBe('+44');
    expect(first('+353')).toBe('+353');
    // Exact first, then the codes that start with the digits.
    const fours = searchDialCodes('4').map((c) => c.code);
    expect(fours.every((c) => c.startsWith('+4'))).toBe(true);
    expect(fours[0]).toBe('+44'); // common before A → Z among equals
  });

  it('matches nothing rather than everything for nonsense', () => {
    expect(searchDialCodes('zzzz')).toEqual([]);
    expect(searchDialCodes('+')).toEqual([]);
  });

  it('reads ISO codes off the flags, both for a shared row', () => {
    expect(isoCodesOf('🇬🇧 +44')).toEqual(['gb']);
    expect(isoCodesOf('🇺🇸🇨🇦 +1')).toEqual(['us', 'ca']);
  });
});

describe('typed date of birth', () => {
  it('draws the slashes as digits arrive', () => {
    expect(formatDobTyping('0')).toBe('0');
    expect(formatDobTyping('05')).toBe('05');
    expect(formatDobTyping('050')).toBe('05/0');
    expect(formatDobTyping('0506')).toBe('05/06');
    expect(formatDobTyping('05061998')).toBe('05/06/1998');
    expect(formatDobTyping('050619981')).toBe('05/06/1998');
  });

  it('keeps a slash the person typed, and backspace takes it away', () => {
    expect(formatDobTyping('05/')).toBe('05/');
    expect(formatDobTyping('05/06/')).toBe('05/06/');
    expect(formatDobTyping('05')).toBe('05');
  });

  it('pads a single-digit day or month ended with a separator', () => {
    expect(formatDobTyping('5/6/1998')).toBe('05/06/1998');
    expect(formatDobTyping('5.6.1998')).toBe('05/06/1998');
    expect(formatDobTyping('5 6 1998')).toBe('05/06/1998');
  });

  it('turns autofill and the calendar’s yyyy-mm-dd round to DD/MM/YYYY', () => {
    expect(formatDobTyping('1998-06-05')).toBe('05/06/1998');
  });

  it('hands the form yyyy-mm-dd once complete, the text otherwise', () => {
    expect(dobValueFrom('05/06/1998')).toBe('1998-06-05');
    expect(parseDob(dobValueFrom('05/06/1998'))).not.toBeNull();
    // A day that does not exist still reaches validate() as a date it refuses.
    expect(dobValueFrom('31/02/1998')).toBe('1998-02-31');
    expect(parseDob(dobValueFrom('31/02/1998'))).toBeNull();
    expect(dobValueFrom('05/06/19')).toBe('05/06/19');
    expect(parseDob('05/06/19')).toBeNull();
    expect(dobValueFrom('')).toBe('');
  });
});
