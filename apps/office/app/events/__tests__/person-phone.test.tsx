import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Person, PersonPhone } from '../[id]/_components/Person';
import type { BoardBooking } from '../[id]/board-data';

/**
 * The worker's mobile on every event-board row, so a manager can ring a late
 * or unconfirmed worker without opening their profile (§1.7: a removed
 * worker's number is retired).
 */

const BOOKED = {
  staffId: 'w-1',
  name: 'Grace L.',
  roles: ['Waiter'],
  photoUrl: null,
  phone: '+447700900456',
} as BoardBooking;

describe('PersonPhone', () => {
  it('is a tel: link, grouped for reading', () => {
    const html = renderToString(<PersonPhone phone="+447700900456" />);
    expect(html).toContain('href="tel:+447700900456"');
    expect(html).toContain('+44 7700 900456');
  });

  it('shows a dash when no number is on record, and nothing for an unnamed worker', () => {
    const none = renderToString(<PersonPhone phone={null} />);
    expect(none).toContain('—');
    expect(none).not.toContain('tel:');
    expect(renderToString(<PersonPhone phone={undefined} />)).toBe('');
  });
});

describe('Person', () => {
  it('carries the phone beside the name', () => {
    const html = renderToString(<Person person={BOOKED} sub="Waiter" />);
    expect(html).toContain('Grace L.');
    expect(html).toContain('href="tel:+447700900456"');
  });
});
