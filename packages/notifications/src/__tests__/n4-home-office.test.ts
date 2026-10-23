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

  it('the late N6 says there is an hour and when it ends, never 12:00', () => {
    const message = messageFor(
      row('N6', { variant: 'late', dueBy: '19:09', event: 'Lift and Shift' }),
    );
    expect(message.kind === 'push' && message.body).toBe(
      "Press I'm ready by 19:09 (UK time), 1 hour after you confirmed — or you'll be removed from Lift and Shift",
    );
    expect(message.kind === 'push' && message.title).toBe("You have 1 hour to press I'm ready");
    expect(message.kind === 'push' && message.url).toBe('/shifts');
  });

  // ADR-0198: every 15 minutes after the first warning, each with the time the
  // hour runs out and what is left of it.
  it.each(['45 minutes', '30 minutes', '15 minutes'])(
    'the late reminder with %s left names the time it runs out',
    (minutes) => {
      const message = messageFor(
        row('N6', {
          variant: 'late-reminder',
          dueBy: '19:09',
          event: 'Lift and Shift',
          minutes,
        }),
      );
      expect(message.kind === 'push' && message.title).toBe(`${minutes} left to press I'm ready`);
      expect(message.kind === 'push' && message.body).toBe(
        `Press I'm ready for Lift and Shift by 19:09 (UK time) — ${minutes} left — or you'll be removed from it`,
      );
      expect(message.kind === 'push' && message.body).not.toMatch(/12:00|[{}]/);
      expect(message.kind === 'push' && message.url).toBe('/shifts');
    },
  );

  it('N6b with no variant is §8, and the late one says the hour, names the shift and says the place is offered on', () => {
    expect(body('N6b')).toMatch(/12:00 deadline/);
    const message = messageFor(
      row('N6b', { variant: 'late', event: 'Lift and Shift', dateTime: 'Fri 23 Oct 17:00–21:00' }),
    );
    expect(message.kind === 'push' && message.body).toBe(
      "You have been removed from Lift and Shift · Fri 23 Oct 17:00–21:00 as we did not receive your 'I'm ready' within 1 hour of your confirmation. Your place is being offered to someone else",
    );
    expect(message.kind === 'push' && message.body).not.toMatch(/12:00|tomorrow/);
    // The hour can end after midnight, so the heading no longer says "tomorrow".
    expect(message.kind === 'push' && message.title).toBe('Removed from your shift');
  });
});
