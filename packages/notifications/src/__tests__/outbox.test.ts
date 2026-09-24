import { describe, expect, it } from 'vitest';
import { UnsendableRow, messageFor, outboxBackoffMs } from '../outbox';
import type { OutboxRow } from '../outbox';

const push = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 1,
  key: 'N12:booking:1',
  channel: 'push',
  template: 'N12',
  recipient_staff_id: 'staff-1',
  recipient_emails: null,
  payload: {},
  attempts: 1,
  ...over,
});

const email = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 2,
  key: 'E8:staff:1',
  channel: 'email',
  template: 'E8',
  recipient_staff_id: null,
  recipient_emails: null,
  payload: {},
  attempts: 1,
  ...over,
});

describe('backoff agrees with outbox_backoff() in SQL', () => {
  // The same numbers are asserted in supabase/tests/110_jobs_and_outbox.sql.
  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 8],
    [5, 16],
    [6, 30],
    [9, 30],
  ])('attempt %i waits %i minutes', (attempt, minutes) => {
    expect(outboxBackoffMs(attempt)).toBe(minutes * 60_000);
  });

  it('treats attempt 0 as the first attempt, as SQL does', () => {
    expect(outboxBackoffMs(0)).toBe(60_000);
  });
});

describe('push rows', () => {
  it('renders title, body and deep link from the register', () => {
    const msg = messageFor(push());
    expect(msg).toEqual({
      kind: 'push',
      staffId: 'staff-1',
      title: 'Event cancelled',
      body: 'This event has been cancelled',
      url: '/shifts',
    });
  });

  it('substitutes the payload into copy and deep link', () => {
    const msg = messageFor(
      push({
        template: 'N9b',
        payload: { event: 'Product Launch', bookingId: '41' },
      }),
    );
    expect(msg.kind).toBe('push');
    if (msg.kind !== 'push') return;
    expect(msg.body).toBe("You haven't checked out of Product Launch yet — tap to check out.");
    expect(msg.url).toBe('/shifts/41');
  });

  it('sends the half of N9 the row names', () => {
    const checkIn = messageFor(push({ template: 'N9', payload: { variant: 'check-in' } }));
    const checkOut = messageFor(push({ template: 'N9', payload: { variant: 'check-out' } }));
    expect(checkIn.kind === 'push' && checkIn.body).toBe('Time to check in');
    expect(checkOut.kind === 'push' && checkOut.body).toBe("Don't forget to check out");
  });

  it('refuses N9 with no variant rather than guessing a half', () => {
    expect(() => messageFor(push({ template: 'N9' }))).toThrow(UnsendableRow);
    expect(() => messageFor(push({ template: 'N9' }))).toThrow(/needs a variant/);
  });

  it('refuses a push with no recipient', () => {
    expect(() => messageFor(push({ recipient_staff_id: null }))).toThrow(/no recipient_staff_id/);
  });
});

describe('email rows', () => {
  it('addresses the office emails as §8 names them, ignoring the row', () => {
    const msg = messageFor(
      email({ recipient_emails: ['someone@example.com'], payload: { name: 'A', employeeId: '7' } }),
    );
    expect(msg.kind).toBe('email');
    if (msg.kind !== 'email') return;
    expect(msg.to).toEqual(['admin@thehospitalitycompany.co.uk']);
    expect(msg.sender).toBe('admin');
    expect(msg.subject).toBe('P45 requested — A, Employee ID 7');
  });

  it('falls back to the row for a code §8 gives no fixed recipients', () => {
    const msg = messageFor(
      email({ template: 'E2', key: 'E2:staff:1', recipient_emails: ['candidate@example.com'] }),
    );
    expect(msg.kind === 'email' && msg.to).toEqual(['candidate@example.com']);
  });

  it('sends E10, the self-cancel email, to admin@ from admin@ (§9.12)', () => {
    const msg = messageFor(
      email({
        template: 'E10',
        key: 'E10:booking:1',
        recipient_emails: ['admin@thehospitalitycompany.co.uk'],
        payload: { event: 'Gala Dinner', role: 'Waiting Staff', date: 'Fri 09 Oct 2026' },
      }),
    );
    expect(msg.kind).toBe('email');
    if (msg.kind !== 'email') return;
    expect(msg.to).toEqual(['admin@thehospitalitycompany.co.uk']);
    expect(msg.sender).toBe('admin');
    expect(msg.subject).toBe(
      'Confirmed worker self-cancelled — Gala Dinner · Waiting Staff · Fri 09 Oct 2026',
    );
  });

  it('refuses to send E1, which is Willo’s', () => {
    expect(() => messageFor(email({ template: 'E1', recipient_emails: ['a@b.c'] }))).toThrow(
      /not ours to send/,
    );
  });

  it('refuses an email with no recipient at all', () => {
    expect(() => messageFor(email({ template: 'E2' }))).toThrow(/no recipient/);
  });
});

describe('rows that can never be sent', () => {
  it('rejects a code the register does not name', () => {
    expect(() => messageFor(push({ template: 'N99' }))).toThrow(/not a code in the §8 register/);
  });

  it('rejects a row whose channel disagrees with the register', () => {
    expect(() => messageFor(push({ template: 'E8' }))).toThrow(/is email in the register/);
  });

  it('throws UnsendableRow, not a bare Error, so a drain can fail it instead of retrying', () => {
    expect(() => messageFor(push({ template: 'N99' }))).toThrow(UnsendableRow);
  });
});

/**
 * The rows the OFFICE queues, run through the real drain — §8, §3.3, §3.5.
 *
 * `payload` is the values map `messageFor` renders the register's copy with.
 * The event board and the Shift Builder originally wrote pre-rendered
 * `title` / `body` / `deepLink` into it instead, which the drain ignores, so
 * every worker on a re-timed event would have been sent the literal
 * "Shift time changed — now {window}".
 *
 * These are the exact shapes `apps/office/app/events/actions.ts` and
 * `apps/office/app/events/[id]/actions.ts` queue. A brace reaching a phone is
 * the failure; asserting no brace survives is the test.
 */
describe('the office\u2019s own rows render, rather than shipping braces (§8)', () => {
  const row = (template: string, payload: Record<string, string>) => ({
    key: `${template}:booking:x`,
    channel: 'push' as const,
    template,
    recipient_staff_id: '20000000-0000-4000-8000-000000000001',
    recipient_emails: null,
    payload,
  });

  it('N11 renders the worker\u2019s own new window and a real deep link (§3.5)', () => {
    const msg = messageFor(
      row('N11', { window: '11:00 – 00:30 (UK)', bookingId: 'b1', reason: 'starts_at' }) as never,
    );
    expect(msg).toMatchObject({ kind: 'push' });
    expect((msg as { body: string }).body).toBe('Shift time changed — now 11:00 – 00:30 (UK)');
    expect((msg as { url?: string }).url).toBe('/shifts/b1');
  });

  it('N10b names the event and when it was (§3.3)', () => {
    const msg = messageFor(
      row('N10b', { event: 'Gala Dinner', dateTime: '25 Sep, 17:00', bookingId: 'b1' }) as never,
    );
    expect((msg as { body: string }).body).toBe(
      "You've been removed from Gala Dinner · 25 Sep, 17:00",
    );
  });

  it('N12 needs no values at all, and must not gain any', () => {
    const msg = messageFor(row('N12', { bookingId: 'b1' }) as never);
    expect((msg as { body: string }).body).toBe('This event has been cancelled');
  });

  it.each(['N10b', 'N11', 'N12'])('%s leaves no unrendered placeholder behind', (code) => {
    const values: Record<string, Record<string, string>> = {
      N10b: { event: 'Gala Dinner', dateTime: '25 Sep, 17:00', bookingId: 'b1' },
      N11: { window: '11:00 – 00:30 (UK)', bookingId: 'b1' },
      N12: { bookingId: 'b1' },
    };
    const msg = messageFor(row(code, values[code]!) as never) as {
      title: string;
      body: string;
      url?: string;
    };
    for (const text of [msg.title, msg.body, msg.url ?? '']) {
      expect(text, `${code}: "${text}"`).not.toMatch(/[{}]/);
    }
  });
});
