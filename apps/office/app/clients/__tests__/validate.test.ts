import { describe, expect, it } from 'vitest';
import { MAX_CONTACT_EMAILS, isEmail, validateClient } from '../validate';
import type { ClientDraft } from '../types';

/**
 * §9.7: "All fields on this form are mandatory — none can be skipped."
 * `assert_client_input` rejects the same drafts in the database
 * (supabase/tests/240_clients_directory.sql), so these vectors and those
 * assertions are deliberately the same list.
 */
const CLARIDGES: ClientDraft = {
  name: "Claridge's",
  contact_name: 'Helena Ashworth',
  phone: '+44 20 7629 8860',
  staff_contact_point: 'Banqueting office, staff entrance on Brook’s Mews',
  contact_emails: ['h.ashworth@claridges.example', 'banqueting@claridges.example'],
  pays_breaks: false,
  pays_buffer: true,
};

const draft = (overrides: Partial<ClientDraft>): ClientDraft => ({ ...CLARIDGES, ...overrides });

describe('validateClient', () => {
  it('accepts a fully filled form', () => {
    expect(validateClient(CLARIDGES)).toBeNull();
  });

  it.each([
    ['name', { name: '  ' }, /name/i],
    ['contact name', { contact_name: '' }, /contact/i],
    ['phone', { phone: '   ' }, /phone/i],
    ['staff contact point', { staff_contact_point: '' }, /staff contact point/i],
  ])('refuses a blank %s — every field is mandatory (§9.7)', (_label, override, expected) => {
    expect(validateClient(draft(override))).toMatch(expected);
  });

  it('refuses a client with nowhere to send the allocation sheet', () => {
    // §11.4: the allocation sheet and the timesheet go to these addresses.
    expect(validateClient(draft({ contact_emails: [] }))).toMatch(/at least one contact email/i);
  });

  it('refuses an address that is not one', () => {
    expect(validateClient(draft({ contact_emails: ['not-an-address'] }))).toMatch(/not an email/i);
    expect(validateClient(draft({ contact_emails: ['a@b.co', 'broken@'] }))).toMatch(/broken@/);
  });

  it('holds the column’s ceiling of five addresses', () => {
    const many = Array.from({ length: MAX_CONTACT_EMAILS + 1 }, (_, i) => `a${i}@b.co`);
    expect(validateClient(draft({ contact_emails: many }))).toMatch(/Up to 5/);
  });

  it('accepts either setting of both policies, because neither is optional', () => {
    for (const breaks of [true, false]) {
      for (const buffer of [true, false]) {
        expect(validateClient(draft({ pays_breaks: breaks, pays_buffer: buffer }))).toBeNull();
      }
    }
  });
});

describe('isEmail', () => {
  it('takes the addresses a manager would paste in', () => {
    for (const good of ['a@b.co', ' h.ashworth@claridges.example ', "o'brien@a-b.co.uk"]) {
      expect(isEmail(good)).toBe(true);
    }
  });

  it('rejects what would bounce', () => {
    for (const bad of ['', 'a@b', 'a b@c.co', '@b.co', 'a@.co', 'a@b.', 'two@at@b.co']) {
      expect(isEmail(bad)).toBe(false);
    }
  });
});
