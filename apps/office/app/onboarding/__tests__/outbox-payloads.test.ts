import { describe, expect, it } from 'vitest';
import { messageFor } from '@thc/notifications';
import type { OutboxRow } from '@thc/notifications';

/**
 * The payloads 20260923110000_onboarding_pipeline.sql writes, rendered
 * through the §8 register exactly as the outbox drain will render them.
 *
 * The SQL writes VALUES, never copy (the drain owns the words). What can
 * go wrong between the two is a key name: a payload that says `url` where
 * the template says `{link}` sends the candidate a literal "{link}". These
 * rows mirror the jsonb_build_object calls key for key.
 */
function row(over: Partial<OutboxRow>): OutboxRow {
  return {
    id: 1,
    key: 'k',
    channel: 'email',
    template: 'E2',
    recipient_staff_id: null,
    recipient_emails: ['hana.k@example.com'],
    payload: {},
    attempts: 0,
    ...over,
  };
}

const UNFILLED = /\{\w+\}/;

describe('onboarding outbox rows render completely', () => {
  it('E3 (onboarding_do_accept): activation link and install link', () => {
    const message = messageFor(
      row({
        template: 'E3',
        payload: {
          link: 'https://staff.example/activate',
          installLink: 'https://staff.example/install',
          name: 'Hana',
        },
      }),
    );
    expect(message.kind).toBe('email');
    if (message.kind !== 'email') return;
    expect(message.to).toEqual(['hana.k@example.com']);
    expect(message.body).toContain('https://staff.example/activate');
    expect(message.body).toContain('https://staff.example/install');
    expect(message.body).not.toMatch(UNFILLED);
  });

  it('E2 (onboarding_do_reject, returning applicant): THC wording, nothing to fill, no reason', () => {
    const message = messageFor(row({ template: 'E2', payload: { name: 'Hana' } }));
    if (message.kind !== 'email') throw new Error('E2 is an email');
    expect(message.body).not.toMatch(UNFILLED);
    expect(message.subject).not.toMatch(UNFILLED);
  });

  it('E2b (rejected after the interview, or a returning applicant): no interview wording, no reason', () => {
    const message = messageFor(row({ template: 'E2b', payload: { name: 'Hana' } }));
    if (message.kind !== 'email') throw new Error('E2b is an email');
    expect(message.body).not.toMatch(UNFILLED);
    expect(message.body).not.toMatch(/interview/i);
  });

  it('N8 (reject_document / reject_declaration): the reason word for word', () => {
    const message = messageFor(
      row({
        channel: 'push',
        template: 'N8',
        recipient_emails: null,
        recipient_staff_id: 'c-1',
        payload: { reason: 'Number obscured — please re-upload', document: 'NI evidence' },
      }),
    );
    if (message.kind !== 'push') throw new Error('N8 is a push');
    expect(message.body).toBe('Document rejected — Number obscured — please re-upload. Re-upload.');
    expect(message.url).toBe('/documents');
  });
});
