import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOT_ALLOWED } from '../../../_lib/dbError';
import type { InvoiceDetails } from '../types';

/**
 * ADR-0176 (THC 20.10.2026): the client card's Invoicing panel — the
 * accounts contact, up to ten invoice emails and the billing address —
 * saved through `set_client_invoice_details()`, whose refusals reach the
 * manager as sentences.
 */

const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
  error: null as null | { code?: string; message: string; details?: string | null },
}));
const revalidatePath = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));

const { setInvoiceDetails } = await import('../actions');
const { Invoicing } = await import('../Invoicing');
const { invoiceDetailsProblem, normaliseInvoiceEmails } = await import('../invoiceDetails');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  rpc.mockClear();
  revalidatePath.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const refuse = (error: { code?: string; message: string; details?: string | null }) =>
  rpc.mockResolvedValueOnce({ error });

describe('setInvoiceDetails (ADR-0176)', () => {
  it('calls the RPC with the normalised details and revalidates the card', async () => {
    const result = await setInvoiceDetails('c-1', {
      accountsContactName: '  Accounts Payable ',
      invoiceEmails: [' AP@Acme.co.uk', '', 'ap@acme.co.uk', 'finance@acme.co.uk'],
      billingAddress: ' 1 Hotel Row\nLondon W1 1AA ',
    });
    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('set_client_invoice_details', {
      p_client: 'c-1',
      p_contact_name: 'Accounts Payable',
      p_emails: ['ap@acme.co.uk', 'finance@acme.co.uk'],
      p_address: '1 Hotel Row\nLondon W1 1AA',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/clients/c-1');
  });

  it('clears to nulls and an empty list (invoices fall back to the contact emails)', async () => {
    await setInvoiceDetails('c-1', {
      accountsContactName: ' ',
      invoiceEmails: [],
      billingAddress: '',
    });
    expect(rpc).toHaveBeenCalledWith('set_client_invoice_details', {
      p_client: 'c-1',
      p_contact_name: null,
      p_emails: [],
      p_address: null,
    });
  });

  it('refuses an eleventh address and a non-address before the round trip', async () => {
    const eleven = Array.from({ length: 11 }, (_, n) => `a${n}@acme.co.uk`);
    const many = await setInvoiceDetails('c-1', {
      accountsContactName: '',
      invoiceEmails: eleven,
      billingAddress: '',
    });
    expect(many).toEqual({
      ok: false,
      message: expect.stringContaining('Up to 10 invoice emails'),
    });
    const bad = await setInvoiceDetails('c-1', {
      accountsContactName: '',
      invoiceEmails: ['accounts at acme'],
      billingAddress: '',
    });
    expect(bad).toEqual({
      ok: false,
      message: expect.stringContaining('“accounts at acme” is not an email address'),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: '42501', message: 'admins_only' }, NOT_ALLOWED],
    [
      { code: '42501', message: 'not_permitted', details: 'write' },
      'Your login cannot change invoicing details. Ask an owner, a manager or a scheduler.',
    ],
    [
      { code: '22023', message: 'too_many_invoice_emails' },
      'Up to 10 invoice emails. Remove one before adding another.',
    ],
    [
      { code: '22023', message: 'invalid_invoice_email', details: 'ap@acme' },
      '“ap@acme” is not an email address. Check it and save again.',
    ],
    [
      { code: 'P0002', message: 'unknown_client' },
      'That client no longer exists. Refresh the page.',
    ],
  ])('maps the refusal %o to a sentence', async (error, sentence) => {
    refuse(error);
    const result = await setInvoiceDetails('c-1', {
      accountsContactName: 'Accounts',
      invoiceEmails: ['ap@acme.co.uk'],
      billingAddress: '',
    });
    expect(result).toEqual({ ok: false, message: sentence });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('never shows a database code or template', () => {
    expect(invoiceDetailsProblem({ code: '22023', message: 'invalid_invoice_email' })).toBe(
      'One of the invoice emails is not an email address. Check them and save again.',
    );
    expect(
      invoiceDetailsProblem({
        code: '23514',
        message:
          'new row for relation "clients" violates check constraint "clients_invoice_emails_max"',
      }),
    ).not.toMatch(/clients_invoice_emails_max|relation/);
  });

  it('normalises as the database does: trimmed, lower-cased, de-duplicated, no blanks', () => {
    expect(normaliseInvoiceEmails([' A@B.co ', 'a@b.co', '  ', 'c@d.co'])).toEqual([
      'a@b.co',
      'c@d.co',
    ]);
  });
});

const details = (over: Partial<InvoiceDetails> = {}): InvoiceDetails => ({
  accountsContactName: 'Accounts Payable',
  invoiceEmails: ['ap@acme.co.uk', 'finance@acme.co.uk'],
  billingAddress: '1 Hotel Row\nLondon W1 1AA',
  ...over,
});

describe('The Invoicing panel on the client card (ADR-0176)', () => {
  it('shows the contact, the emails, the hint and the address, with Edit for a writer', () => {
    const html = renderToStaticMarkup(<Invoicing clientId="c1" details={details()} canWrite />);
    expect(html).toContain('Invoicing');
    expect(html).toContain('Accounts contact');
    expect(html).toContain('Accounts Payable');
    expect(html).toContain('ap@acme.co.uk');
    expect(html).toContain('finance@acme.co.uk');
    expect(html).toContain('Empty: invoices go to the main contact — the allocation emails above');
    expect(html).toContain('class="inv-address"');
    expect(html).toContain('1 Hotel Row\nLondon W1 1AA');
    expect(html).toMatch(/<button[^>]*>Edit<\/button>/);
  });

  it('shows the values but no Edit to a read-only login (ADR-0060)', () => {
    const html = renderToStaticMarkup(
      <Invoicing clientId="c1" details={details()} canWrite={false} />,
    );
    expect(html).toContain('Accounts Payable');
    expect(html).toContain('ap@acme.co.uk');
    expect(html).not.toMatch(/>Edit</);
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<input');
  });

  it('says what is not set, and where the invoice goes with no invoice emails', () => {
    const html = renderToStaticMarkup(
      <Invoicing
        clientId="c1"
        details={{ accountsContactName: null, invoiceEmails: [], billingAddress: null }}
        canWrite
      />,
    );
    expect(html).toContain('Not set');
    expect(html).toContain('None');
    expect(html).toContain('Empty: invoices go to the main contact — the allocation emails above');
  });
});
