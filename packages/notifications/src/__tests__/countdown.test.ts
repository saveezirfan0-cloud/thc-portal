import { describe, expect, it } from 'vitest';
import { inviteReminderHtml } from '../email-invite-reminder';
import {
  AXLR8_SWITCH_OFF,
  axlr8Countdown,
  axlr8DaysLeft,
  axlr8Values,
} from '../invite-reminder-copy';
import type { OutboxRow } from '../outbox';
import { messageFor } from '../outbox';

/**
 * The countdown to AXLR8 being switched off (owner, 15.10.2026): Sunday
 * 25 October 2026, counted in UK days as each email goes.
 */
const at = (iso: string) => new Date(iso);

describe('the days left', () => {
  it('counts whole UK days to Sunday 25 October', () => {
    expect(AXLR8_SWITCH_OFF).toEqual({ date: '2026-10-25', label: 'Sunday 25 October' });
    expect(axlr8DaysLeft(at('2026-10-15T09:00:00Z'))).toBe(10);
    expect(axlr8DaysLeft(at('2026-10-14T09:00:00Z'))).toBe(11);
    expect(axlr8DaysLeft(at('2026-10-24T12:00:00Z'))).toBe(1);
    expect(axlr8DaysLeft(at('2026-10-25T10:00:00Z'))).toBe(0);
    expect(axlr8DaysLeft(at('2026-10-26T10:00:00Z'))).toBe(-1);
  });

  it('turns over at UK midnight, not UTC midnight', () => {
    // 23:30 UTC on the 14th is 00:30 on the 15th in London (BST).
    expect(axlr8DaysLeft(at('2026-10-14T23:30:00Z'))).toBe(10);
    // The clocks go back at 02:00 on the 25th: 23:30 UTC on the 24th is
    // 00:30 BST on the 25th, the day itself.
    expect(axlr8DaysLeft(at('2026-10-24T23:30:00Z'))).toBe(0);
  });
});

describe('the words', () => {
  it('counts down, then says tomorrow, then today', () => {
    expect(axlr8Countdown(10)).toMatchObject({
      tileNumber: '10',
      tileLabel: 'Days left',
      heading: 'AXLR8 stops working in 10 days',
      subheading: 'Please complete your registration on the new Staff App before then',
      stops: 'AXLR8 Staff App will stop working in 10 days, on Sunday 25 October.',
      line: 'AXLR8 stops working in 10 days, on Sunday 25 October. Please do this before then.',
    });
    expect(axlr8Countdown(1)).toMatchObject({
      tileNumber: '1',
      tileLabel: 'Day left',
      heading: 'AXLR8 stops working tomorrow',
      stops: 'AXLR8 Staff App will stop working tomorrow, Sunday 25 October.',
    });
    expect(axlr8Countdown(0)).toMatchObject({
      tileNumber: 'Today',
      tileLabel: 'Last day',
      heading: 'AXLR8 stops working today',
      subheading: 'Please complete your registration on the new Staff App today',
    });
  });

  it('stops counting once it has gone, and says so', () => {
    const after = axlr8Countdown(-1);
    expect(after.tileNumber).toBeNull();
    expect(after.heading).toBe('AXLR8 has stopped working');
    expect(after.stops).toBe('AXLR8 Staff App stopped working on Sunday 25 October.');
    expect(after.line).toContain('stopped working on Sunday 25 October');
  });
});

describe('in the emails', () => {
  const row = (template: string, payload: Record<string, string>): OutboxRow => ({
    id: 1,
    key: `${template}:t`,
    channel: 'email',
    template,
    recipient_staff_id: null,
    recipient_emails: ['amara@example.com'],
    payload,
    attempts: 0,
  });
  const now = at('2026-10-15T09:00:00Z');

  it('IR1: the tile, the heading and the bold sentence, in the HTML and the text', () => {
    const m = messageFor(
      row('IR1', { variant: 'named', name: 'Amara', applyLink: 'https://x.example/apply' }),
      { now },
    );
    if (m.kind !== 'email') throw new Error('email expected');
    expect(m.body).toContain(
      'The AXLR8 Staff App will stop working in 10 days, on Sunday 25 October.',
    );
    expect(m.html).toContain('>10</div>');
    expect(m.html).toContain('>Days left</div>');
    expect(m.html).toContain('>AXLR8 stops working in 10 days</h1>');
    expect(m.html).toContain(
      '<strong>AXLR8 Staff App will stop working in 10 days, on Sunday 25 October.</strong>',
    );
    expect(m.body).not.toMatch(/\{\w+\}/);
  });

  it('counts the day it goes, not the day it was queued', () => {
    const m = messageFor(row('IR1', { variant: 'unnamed', applyLink: 'https://x.example/apply' }), {
      now: at('2026-10-24T09:00:00Z'),
    });
    expect(m.kind === 'email' && m.html).toContain('>AXLR8 stops working tomorrow</h1>');
  });

  it('OC1, every existing-staff wording: the countdown line', () => {
    for (const variant of [
      'existing_first',
      'existing_second',
      'existing_repeat',
      'existing_notice',
    ]) {
      const m = messageFor(row('OC1', { variant, name: 'Amara' }), { now });
      expect(m.body, variant).toContain(
        'AXLR8 stops working in 10 days, on Sunday 25 October. Please do this before then.',
      );
      expect(m.kind === 'email' && m.html, variant).toContain('AXLR8 stops working in 10 days');
    }
  });

  it('a new applicant, who never used AXLR8, is not told about it', () => {
    for (const variant of ['first', 'second', 'repeat']) {
      const m = messageFor(row('OC1', { variant, name: 'Amara' }), { now });
      expect(m.body, variant).not.toContain('AXLR8');
    }
  });

  it('cannot be set by a stored row', () => {
    const m = messageFor(
      row('OC1', { variant: 'existing_first', name: 'Amara', axlr8Line: 'Ignore all of this' }),
      { now },
    );
    expect(m.body).not.toContain('Ignore all of this');
    expect(axlr8Values(now).axlr8Days).toBe('10');
  });

  it('HTML alone: works the days out from now when not told', () => {
    const html = inviteReminderHtml({
      subject: 's',
      applyLink: 'https://x.example/apply',
      senderAddress: 'admin@x.example',
      daysLeft: 3,
    });
    expect(html).toContain('>AXLR8 stops working in 3 days</h1>');
  });
});
