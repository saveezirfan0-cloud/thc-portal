import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StaffPhone } from '../StaffPhone';

/**
 * The worker's mobile under their name on the check-in monitor, so a manager
 * can ring someone who has not checked in (§1.7: a removed worker's number
 * is retired).
 */
describe('StaffPhone', () => {
  it('is a tel: link, grouped for reading', () => {
    const html = renderToString(<StaffPhone phone="+447700900456" />);
    expect(html).toContain('href="tel:+447700900456"');
    expect(html).toContain('+44 7700 900456');
  });

  it('shows a dash when none is on record, and nothing when it could not be read', () => {
    const none = renderToString(<StaffPhone phone={null} />);
    expect(none).toContain('—');
    expect(none).not.toContain('tel:');
    expect(renderToString(<StaffPhone phone={undefined} />)).toBe('');
  });
});
