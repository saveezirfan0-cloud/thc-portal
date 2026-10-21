import { describe, expect, it } from 'vitest';
import { MAX_CONTACT_EMAILS, clientFieldErrors, isEmail, validateClient } from '../validate';
import type { ClientDraft } from '../types';

/**
 * §9.7: "All fields on this form are mandatory — none can be skipped."
 * `assert_client_input` rejects the same drafts in the database
 * (supabase/tests/280_clients_directory.sql), so these vectors and those
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

  it('holds the column’s ceiling of ten addresses', () => {
    const many = Array.from({ length: MAX_CONTACT_EMAILS + 1 }, (_, i) => `a${i}@b.co`);
    expect(validateClient(draft({ contact_emails: many }))).toMatch(
      new RegExp(`Up to ${MAX_CONTACT_EMAILS}`),
    );
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

describe('a present value must also be right (release audit D-M2, D-M3)', () => {
  it.each(['020 7946 0000', '+44 20 7946 0000', '07700 900123', '+33 (1) 23-45-67-89'])(
    'accepts the phone %s, UK or international',
    (phone) => {
      expect(validateClient(draft({ phone }))).toBeNull();
    },
  );

  it.each(['not a phone', '12345', '+44 20 7946 0000 ext 12'])('refuses the phone %s', (phone) => {
    expect(clientFieldErrors(draft({ phone })).phone).toMatch(/phone number/);
  });

  it('caps the client name at 120 characters, as the database does', () => {
    expect(validateClient(draft({ name: 'N'.repeat(120) }))).toBeNull();
    expect(clientFieldErrors(draft({ name: 'N'.repeat(121) })).name).toBe(
      'A client name is at most 120 characters.',
    );
  });

  it('names every field that is wrong, not only the first', () => {
    const errors = clientFieldErrors(draft({ name: '', phone: 'nope', contact_emails: [] }));
    expect(Object.keys(errors).sort()).toEqual(['contact_emails', 'name', 'phone']);
  });
});

/**
 * ADR-0176 (THC 21.10.2026): a NEW client must say where its invoices go —
 * `create_client` refuses one with no invoice email
 * (supabase/tests/910_client_invoicing_contact_required.sql). Edit does
 * not ask: the card's Invoicing panel owns these once the client exists.
 */
describe('a new client needs an invoice email', () => {
  const invoicing = (invoice_emails: string[]) => ({
    invoice_emails,
    accounts_contact_name: '',
    billing_address: '',
  });

  it('is refused with none, and an edit is not', () => {
    expect(validateClient(CLARIDGES, true)).toMatch(/at least one invoice email/i);
    expect(validateClient(draft({ invoicing: invoicing(['  ']) }), true)).toMatch(
      /at least one invoice email/i,
    );
    expect(validateClient(CLARIDGES)).toBeNull();
  });

  it('takes several, up to ten, and only addresses', () => {
    const ten = Array.from({ length: 10 }, (_, n) => `ap${n}@claridges.example`);
    expect(validateClient(draft({ invoicing: invoicing(ten) }), true)).toBeNull();
    expect(
      validateClient(draft({ invoicing: invoicing([...ten, 'ap10@claridges.example']) }), true),
    ).toMatch(/up to 10 invoice emails/i);
    expect(
      validateClient(draft({ invoicing: invoicing(['accounts at claridges']) }), true),
    ).toMatch(/is not an email address/);
  });

  it('counts an address once, whatever its case', () => {
    const same = Array.from({ length: 11 }, (_, n) =>
      n % 2 ? 'AP@claridges.example' : 'ap@claridges.example',
    );
    expect(validateClient(draft({ invoicing: invoicing(same) }), true)).toBeNull();
  });
});
