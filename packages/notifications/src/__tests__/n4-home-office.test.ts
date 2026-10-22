import { describe, expect, it } from 'vitest';
import { messageFor } from '../outbox';
import type { OutboxRow } from '../outbox';
import { body } from '../templates';

/**
 * N4 for the Home Office check result (ADR-0182): the worker cannot update
 * the document — only an employer can ask the Home Office — so the day it
 * runs out they are told the office is renewing it. Every other N4 is §8's
 * copy, word for word, with no variant on the row.
 */
const n4 = (payload: Record<string, string>): OutboxRow => ({
  id: 1,
  key: 'N4:doc:1',
  channel: 'push',
  template: 'N4',
  recipient_staff_id: 'staff-1',
  recipient_emails: null,
  payload,
  attempts: 1,
});

describe('N4 · the Home Office check variant', () => {
  it('a row with no variant reads §8 as before', () => {
    expect(body('N4')).toBe('You have been blocked — please update');
    const message = messageFor(n4({ document: 'Passport', date: '01 Nov 2026' }));
    expect(message.kind === 'push' && message.body).toBe('You have been blocked — please update');
  });

  it('the home_office row says the office is renewing it, never "please update"', () => {
    const message = messageFor(
      n4({
        document: 'Right to work · Home Office check',
        date: '01 Nov 2026',
        variant: 'home_office',
      }),
    );
    expect(message.kind === 'push' && message.body).toBe(
      'Your Home Office check has expired. The office is renewing it; shifts are paused until then.',
    );
    expect(message.kind === 'push' && message.body).not.toMatch(/update/i);
  });

  it('a code with variants and no body still needs one (N9)', () => {
    expect(() => body('N9')).toThrow(/needs a variant/);
  });
});

/**
 * N6 and N6b for a worker who confirmed after the noon deadline (ADR-0196):
 * the hour from confirming, not "12:00". Every other row reads §8 word for
 * word, with no variant.
 */
describe('N6 / N6b · the late confirmer variant', () => {
  const row = (template: string, payload: Record<string, string>): OutboxRow => ({
    ...n4({}),
    key: `${template}:booking:1`,
    template,
    payload,
  });

  it('N6 with no variant is still §8: 12:00 today', () => {
    expect(body('N6')).toBe(
      "Confirm tomorrow's shift by 12:00 today — or you'll be removed from it",
    );
  });

  it('the late N6 names the time the hour ends, never 12:00', () => {
    const message = messageFor(row('N6', { variant: 'late', dueBy: '19:09' }));
    expect(message.kind === 'push' && message.body).toBe(
      "Press I'm ready by 19:09 — or you'll be removed from your shift tomorrow",
    );
    expect(message.kind === 'push' && message.title).toBe("Press I'm ready within the hour");
    expect(message.kind === 'push' && message.url).toBe('/shifts');
  });

  it('N6b with no variant is §8, and the late one says an hour, not the 12:00 deadline', () => {
    expect(body('N6b')).toMatch(/12:00 deadline/);
    const message = messageFor(row('N6b', { variant: 'late' }));
    expect(message.kind === 'push' && message.body).toMatch(/within an hour of your confirmation/);
    expect(message.kind === 'push' && message.body).not.toMatch(/12:00/);
    // The heading is the register's own.
    expect(message.kind === 'push' && message.title).toBe("Removed from tomorrow's shift");
  });
});
