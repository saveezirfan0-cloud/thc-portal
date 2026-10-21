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
