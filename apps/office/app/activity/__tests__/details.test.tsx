import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActivityDetails } from '../ActivityDetails';
import { DETAILS_FOLD } from '../view-model';

/**
 * Release audit 14.10.2026: a long Details entry was cut at 77 characters
 * with no way to read the rest. It now folds and opens in place.
 */
describe('ActivityDetails', () => {
  it('a short entry is plain text', () => {
    const html = renderToStaticMarkup(<ActivityDetails lines={['Reason: Late', 'Count: 2']} />);
    expect(html).toBe('Reason: Late · Count: 2');
  });

  it('no details is a dash', () => {
    expect(renderToStaticMarkup(<ActivityDetails lines={[]} />)).toBe('—');
  });

  it('a long entry folds, and the whole of it is there to open', () => {
    const long = `Notes: ${'word '.repeat(80)}END`;
    expect(long.length).toBeGreaterThan(DETAILS_FOLD);
    const html = renderToStaticMarkup(<ActivityDetails lines={[long]} />);
    expect(html).toContain('<details class="activity-more">');
    expect(html).toContain('Show all');
    expect(html).toContain('END');
  });
});
