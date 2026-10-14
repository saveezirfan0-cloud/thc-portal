import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UkDateField } from '../UkDateField';
import { emptyReason, listQuery, listStateFromParams, rangeReversed } from '../rules';
import { pastWindow } from '../window';
import {
  UK_DATE_FORMAT_ERROR,
  readUkDate,
  reversedRangeText,
  typeUkDate,
  ukDateText,
} from '../ukdate';

/**
 * CW-03: the list's date filters are typed dd/mm/yyyy whatever the device's
 * locale — a native `<input type="date">` showed mm/dd/yyyy on a US-English
 * browser under a "(UK date)" label — and the address bar keeps the
 * `yyyy-mm-dd` the window logic reads.
 */
describe('typing a UK date', () => {
  it('reads dd/mm/yyyy, day first, into the address-bar form', () => {
    expect(readUkDate('16/10/2026')).toEqual({ value: '2026-10-16' });
    // 03/04 is the 3rd of April, never March the 4th.
    expect(readUkDate('03/04/2026')).toEqual({ value: '2026-04-03' });
    expect(readUkDate('3/4/2026')).toEqual({ value: '2026-04-03' });
    expect(readUkDate('16.10.2026')).toEqual({ value: '2026-10-16' });
    expect(readUkDate('16102026')).toEqual({ value: '2026-10-16' });
  });

  it('takes a pasted ISO date and turns it round', () => {
    expect(typeUkDate('2026-10-16')).toBe('16/10/2026');
    expect(readUkDate('2026-10-16')).toEqual({ value: '2026-10-16' });
  });

  it('draws the slashes as the digits arrive', () => {
    expect(typeUkDate('1610')).toBe('16/10');
    expect(typeUkDate('16102')).toBe('16/10/2');
  });

  it('is no bound when empty, and work in progress while short', () => {
    expect(readUkDate('')).toEqual({ value: '' });
    expect(readUkDate('   ')).toEqual({ value: '' });
    expect(readUkDate('16/10')).toEqual({ partial: true });
  });

  it('says what is wrong once the customer leaves the box', () => {
    expect(readUkDate('16/10', true)).toEqual({ error: UK_DATE_FORMAT_ERROR });
    expect(readUkDate('16/10/26', true)).toEqual({ error: UK_DATE_FORMAT_ERROR });
    // A US-order entry is not silently read as some other day.
    expect(readUkDate('10/16/2026')).toEqual({
      error: 'There is no month 16 — enter the date as dd/mm/yyyy.',
    });
    expect(readUkDate('31/02/2026')).toEqual({
      error: '31/02/2026 is not a date — check the day and month.',
    });
  });

  it('shows an address-bar day UK-style, and nothing for no bound', () => {
    expect(ukDateText('2026-10-16')).toBe('16/10/2026');
    expect(ukDateText('')).toBe('');
    expect(ukDateText('nonsense')).toBe('');
  });

  it('keeps the address bar and the window logic on yyyy-mm-dd', () => {
    const typed = readUkDate('01/09/2026');
    expect(typed).toEqual({ value: '2026-09-01' });
    const state = {
      tab: 'past' as const,
      filters: { query: '', venue: '', from: '2026-09-01', to: '2026-09-30' },
    };
    const query = listQuery(state);
    expect(query).toBe('tab=past&from=2026-09-01&to=2026-09-30');
    expect(listStateFromParams(new URLSearchParams(query))).toEqual(state);
    expect(pastWindow(new URLSearchParams(query), '2026-10-14')).toEqual({
      since: '2026-09-01',
      until: '2026-09-30',
    });
  });
});

describe('the field', () => {
  it('is a labelled text box typed dd/mm/yyyy, the calendar only a hidden shortcut', () => {
    const markup = renderToStaticMarkup(
      <UkDateField label="From (UK date)" value="2026-10-16" onChange={() => {}} />,
    );
    expect(markup).toMatch(/<label class="label" for="([^"]+)">From \(UK date\)<\/label>/);
    expect(markup).toMatch(
      /<input id="[^"]+" class="input" type="text" inputMode="numeric" autoComplete="off" placeholder="dd\/mm\/yyyy" maxLength="10" value="16\/10\/2026"\/>/,
    );
    // The browser's picker never draws the value; it is out of the Tab
    // order and the accessibility tree.
    expect(markup).toContain(
      '<input class="ukd-native" type="date" tabindex="-1" aria-hidden="true" title="Pick from a calendar" value="2026-10-16"/>',
    );
  });

  it('carries an error from outside, tied to the box', () => {
    const markup = renderToStaticMarkup(
      <UkDateField
        label="To (UK date)"
        value="2026-09-01"
        onChange={() => {}}
        error="Before the “From” date."
      />,
    );
    expect(markup).toMatch(
      /class="input err"[^>]*aria-invalid="true" aria-describedby="([^"]+)-note"/,
    );
    expect(markup).toMatch(
      /<span class="error" role="alert" id="[^"]+-note">Before the “From” date\.<\/span>/,
    );
  });
});

describe('a reversed range says so (CW-03)', () => {
  it('is reversed only when both ends are set and From is later', () => {
    expect(rangeReversed({ from: '2026-10-20', to: '2026-10-10' })).toBe(true);
    expect(rangeReversed({ from: '2026-10-10', to: '2026-10-10' })).toBe(false);
    expect(rangeReversed({ from: '2026-10-20', to: '' })).toBe(false);
  });

  it('is its own empty state, ahead of "No events match your filters"', () => {
    expect(emptyReason(5, 3, 0, true)).toBe('range');
    expect(emptyReason(5, 3, 0, false)).toBe('filters');
    expect(emptyReason(5, 3, 2, true)).toBeNull();
  });

  it('names both dates, UK-style', () => {
    expect(reversedRangeText('2026-10-20', '2026-10-10')).toBe(
      '“From” (20/10/2026) is after “To” (10/10/2026). Swap them, or change one.',
    );
  });
});
