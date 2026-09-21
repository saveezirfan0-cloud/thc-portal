import { describe, expect, it } from 'vitest';
import { ROWS_PER_PAGE, pageCount, paginate } from '../pagination';

describe('timesheet pagination (§11.3)', () => {
  it('puts twelve rows on a page', () => {
    expect(ROWS_PER_PAGE).toBe(12);
    expect(paginate(Array.from({ length: 13 }, (_, i) => i))).toHaveLength(2);
  });

  it('does not add a trailing empty page on an exact multiple', () => {
    expect(pageCount(24)).toBe(2);
    expect(paginate(Array.from({ length: 24 }, (_, i) => i))).toHaveLength(2);
  });

  it('still renders one page for an empty event', () => {
    expect(pageCount(0)).toBe(1);
    expect(paginate([])).toEqual([[]]);
  });
});
