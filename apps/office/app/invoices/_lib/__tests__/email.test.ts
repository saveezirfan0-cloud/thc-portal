import { describe, expect, it } from 'vitest';
import { defaultInvoiceEmail } from '../compose';
import {
  bccKey,
  emailProblem,
  fileSize,
  htmlText,
  isAddress,
  parseAddresses,
  signatureKey,
} from '../email';
import type { InvoiceDetail } from '../types';

describe('addresses', () => {
  it('splits on commas, semicolons and spaces; lower-cases; de-duplicates', () => {
    expect(parseAddresses('A@x.co.uk, b@x.co.uk;  a@x.co.uk\nc@x.co.uk')).toEqual([
      'a@x.co.uk',
      'b@x.co.uk',
      'c@x.co.uk',
    ]);
    expect(parseAddresses('  ')).toEqual([]);
  });

  it('knows an address from a name', () => {
    expect(isAddress('ap@x.co.uk')).toBe(true);
    expect(isAddress('Ajit Singh <ap@x.co.uk>')).toBe(false);
    expect(isAddress('ap@x')).toBe(false);
  });
});

describe('emailProblem', () => {
  const ok = { to: ['a@x.co.uk'], cc: [], bcc: [], subject: 'Inv 1', bodyHtml: '<p>Hi</p>' };
  it('passes a complete email', () => expect(emailProblem(ok)).toBeNull());
  it('needs a To, a subject and words', () => {
    expect(emailProblem({ ...ok, to: [] })).toMatch(/To/);
    expect(emailProblem({ ...ok, subject: ' ' })).toMatch(/subject/);
    expect(emailProblem({ ...ok, bodyHtml: '<p><br></p>' })).toMatch(/message/);
  });
  it('names the field and the address that is wrong', () => {
    expect(emailProblem({ ...ok, cc: ['nope'] })).toMatch(/“nope” in Cc/);
    expect(emailProblem({ ...ok, bcc: ['x@y'] })).toMatch(/Bcc/);
  });
  it('allows ten addresses a field, not eleven', () => {
    const eleven = Array.from({ length: 11 }, (_, n) => `a${n}@x.co.uk`);
    expect(emailProblem({ ...ok, to: eleven })).toMatch(/Up to 10/);
    expect(emailProblem({ ...ok, to: eleven.slice(0, 10) })).toBeNull();
  });
});

describe('small things', () => {
  it('reads the visible text of a body', () => {
    expect(htmlText('<p>Hi&nbsp;<b>there</b><br></p>')).toBe('Hi there');
  });
  it('keys the remembered Bcc and signature per user', () => {
    expect(bccKey('u1')).not.toBe(bccKey('u2'));
    expect(signatureKey('u1')).not.toBe(bccKey('u1'));
  });
  it('writes a size as the old tool did', () => {
    expect(fileSize(1_900_544)).toBe('1.8 MB');
    expect(fileSize(10 * 1024)).toBe('10 KB');
    expect(fileSize(null)).toBe('');
  });
});

describe('the default email (ADR-0210, audit §5)', () => {
  const invoice = {
    number: 3255,
    clientName: "Leonardo Hotel St Paul's M&E",
    billTo: { name: "Jurys Inn & Leonardo Hotels UK & Ire St Paul's M & E", contact: 'Ajit Singh' },
    periodFrom: '2026-10-15',
    poNumber: '52453465',
    omitEventDates: false,
    lines: [
      { lineDate: '2026-10-17' },
      { lineDate: '2026-10-15' },
      { lineDate: '2026-10-15' },
      { lineDate: null },
    ],
  } as unknown as InvoiceDetail;

  it('builds the old subject, with the week commencing and the event days', () => {
    const email = defaultInvoiceEmail(invoice);
    expect(email.subject).toBe(
      "Jurys Inn & Leonardo Hotels UK & Ire St Paul's M & E - Inv 3255 - w/c 12/10/26 - (15th, 17th October) - 52453465",
    );
    expect(email.bodyHtml).toContain('Hi Ajit,');
    expect(email.bodyHtml).toContain('<strong>');
  });

  it('drops the event days when the client asks (Taster, All Taster)', () => {
    const email = defaultInvoiceEmail({ ...invoice, omitEventDates: true } as InvoiceDetail);
    expect(email.subject).toBe(
      "Jurys Inn & Leonardo Hotels UK & Ire St Paul's M & E - Inv 3255 - w/c 12/10/26 - 52453465",
    );
  });
});
