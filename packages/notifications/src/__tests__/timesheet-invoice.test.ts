import { describe, expect, it } from 'vitest';
import { documentMessageFor } from '../documents';
import { UnsendableRow } from '../outbox';
import type { OutboxRow } from '../outbox';
import { PRIORITY, sendPriority } from '../priority';
import {
  buildTimesheetInvoiceEmail,
  eventDaysLabel,
  mondayOf,
  sanitiseEmailHtml,
} from '../timesheet-invoice';

describe('buildTimesheetInvoiceEmail (the old tool’s saved template, audit §5)', () => {
  it('writes the audit’s real Leonardo subject: w/c is the Monday of the first event day', () => {
    const mail = buildTimesheetInvoiceEmail({
      displayName: "Jurys Inn & Leonardo Hotels UK & Ire St Paul's M & E",
      invoiceNumber: 3255,
      contactName: 'Sam Carter',
      weekCommencing: '2026-10-15',
      eventDays: ['2026-10-15', '2026-10-17'],
      poNumber: '52453465',
      signatureHtml: '<p>Gisela Duncan<br>The Hospitality Company</p>',
    });
    expect(mail.subject).toBe(
      "Jurys Inn & Leonardo Hotels UK & Ire St Paul's M & E - Inv 3255 - w/c 12/10/26 - (15th, 17th October) - 52453465",
    );
    expect(mail.bodyText).toBe(
      [
        'Hi Sam,',
        'I hope you are well.',
        'Please find the staffing invoice attached:',
        mail.subject,
        'The staff timesheets are attached for your reference.',
        'I would be grateful if you can please confirm that this invoice is processed and ready for payment.',
        'Many thanks.',
        'Best wishes,',
        'Gisela Duncan\nThe Hospitality Company',
      ].join('\n\n'),
    );
    expect(mail.bodyHtml).toContain('<p><strong>Jurys Inn &amp; Leonardo');
    expect(mail.bodyHtml.endsWith('<p>Gisela Duncan<br>The Hospitality Company</p>')).toBe(true);
  });

  it('drops the parenthetical when event dates are omitted (a Taster week) and the PO when blank', () => {
    const mail = buildTimesheetInvoiceEmail({
      displayName: 'Taster Liverpool',
      invoiceNumber: '4001',
      contactName: '',
      weekCommencing: '2026-10-19',
      eventDays: ['2026-10-19', '2026-10-24'],
      poNumber: '  ',
      omitEventDates: true,
    });
    expect(mail.subject).toBe('Taster Liverpool - Inv 4001 - w/c 19/10/26');
    expect(mail.bodyText.startsWith('Hi,')).toBe(true);
  });

  it('uses the earliest event day when no week is given, and one rule for a Sunday', () => {
    expect(
      buildTimesheetInvoiceEmail({
        displayName: 'X',
        invoiceNumber: 1,
        eventDays: ['2026-10-18', '2026-10-17'],
      }).subject,
    ).toBe('X - Inv 1 - w/c 12/10/26 - (17th, 18th October)');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
  });

  it('names each month, and writes 1st 2nd 3rd 11th 22nd', () => {
    expect(eventDaysLabel(['2026-09-30', '2026-10-02', '2026-10-01'])).toBe(
      '30th September, 1st, 2nd October',
    );
    expect(eventDaysLabel(['2026-10-11', '2026-10-22', '2026-10-23', '2026-10-22'])).toBe(
      '11th, 22nd, 23rd October',
    );
  });

  it('sanitises the signature it is given', () => {
    const mail = buildTimesheetInvoiceEmail({
      displayName: 'X',
      invoiceNumber: 1,
      signatureHtml: '<p onclick="x()">Hi</p><script>alert(1)</script>',
    });
    expect(mail.bodyHtml).toContain('<p>Hi</p>');
    expect(mail.bodyHtml).not.toMatch(/script|onclick|alert/);
  });
});

describe('sanitiseEmailHtml', () => {
  it('keeps the allowlist and nothing else', () => {
    expect(
      sanitiseEmailHtml(
        '<p>a <b>b</b> <strong>c</strong> <i>d</i> <em>e</em> <u>f</u><br/></p><ul><li>x</li></ul><ol><li>y</li></ol>',
      ),
    ).toBe(
      '<p>a <b>b</b> <strong>c</strong> <i>d</i> <em>e</em> <u>f</u><br></p><ul><li>x</li></ul><ol><li>y</li></ol>',
    );
  });

  it('strips scripts with their content, event attributes, styles and other tags', () => {
    const out = sanitiseEmailHtml(
      '<div style="x"><script>alert(1)</script><img src=x onerror=alert(1)><p onclick="a()" class="c">Hi <span>there</span></p><style>p{}</style><iframe src="x">no</iframe></div><!-- c -->',
    );
    expect(out).toBe('<p>Hi there</p>');
  });

  it('allows only http, https and mailto links, and only href', () => {
    expect(
      sanitiseEmailHtml('<a href="https://x.co/a?b=1&c=2" onclick="z" target="_blank">go</a>'),
    ).toBe('<a href="https://x.co/a?b=1&amp;c=2">go</a>');
    expect(sanitiseEmailHtml('<a href="mailto:a@b.co">m</a>')).toBe(
      '<a href="mailto:a@b.co">m</a>',
    );
    for (const bad of [
      'javascript:alert(1)',
      ' JaVa\tScRiPt:alert(1)',
      '&#106;avascript:alert(1)',
      'java&Tab;script:alert(1)',
      'data:text/html,x',
      '//evil.example',
      '',
    ]) {
      expect(sanitiseEmailHtml(`<a href="${bad}">t</a>`), bad).toBe('t');
    }
    expect(sanitiseEmailHtml('<a href=\'https://x.co" onmouseover="a\'>t</a>')).toBe(
      '<a href="https://x.co&quot;onmouseover=&quot;a">t</a>',
    );
  });

  it('closes what was left open, ignores stray closers, escapes text, and is idempotent', () => {
    const once = sanitiseEmailHtml('</b><p><b>bold <i>both</p> 1 < 2 & "q" </u>');
    expect(once).toBe('<p><b>bold <i>both</i></b></p> 1 &lt; 2 &amp; &quot;q&quot; ');
    expect(sanitiseEmailHtml(once)).toBe(once);
  });
});

describe('INV2 — the office-composed invoice email (ADR-0210)', () => {
  const inv2 = (payload: Record<string, unknown> = {}, over: Partial<OutboxRow> = {}): OutboxRow =>
    ({
      id: 1,
      key: 'INV2:4001:1',
      channel: 'email',
      template: 'INV2',
      recipient_staff_id: null,
      recipient_emails: ['ap@client.example'],
      payload: {
        invoiceNumber: '4001',
        subject: 'Taster Liverpool - Inv 4001 - w/c 19/10/26 - PO9',
        bodyHtml: '<p>Hi Sam,</p><p onclick="x">Please <b>pay</b></p><script>x</script>',
        cc: ['cc@client.example', 'AP@client.example'],
        bcc: ['archive@thehospitalitycompany.co.uk'],
        replyTo: 'gisela@thehospitalitycompany.co.uk',
        attachments: [
          { path: 'invoices/4001/Invoice 4001.pdf', name: 'Invoice 4001.pdf' },
          { path: 'invoices/4001/Invoice 4001.xlsx', name: 'Invoice 4001.xlsx' },
          { path: 'invoices/4001/source/sheet.pdf', name: 'Timesheet.pdf' },
        ],
        ...payload,
      } as never,
      attempts: 0,
      ...over,
    }) as OutboxRow;

  it('sends the subject verbatim, the body sanitised, from timesheets@ with every attachment', () => {
    const m = documentMessageFor(inv2());
    expect(m.sender).toBe('timesheets');
    expect(m.to).toEqual(['ap@client.example']);
    expect(m.subject).toBe('Taster Liverpool - Inv 4001 - w/c 19/10/26 - PO9');
    expect(m.html).toContain('<p>Hi Sam,</p><p>Please <b>pay</b></p>');
    expect(m.html).not.toMatch(/script|onclick/);
    expect(m.body).toBe('Hi Sam,\n\nPlease pay');
    expect(m.cc).toEqual(['cc@client.example']); // AP@ is already in To
    expect(m.bcc).toEqual(['archive@thehospitalitycompany.co.uk']);
    expect(m.replyTo).toBe('gisela@thehospitalitycompany.co.uk');
    expect(m.attachments).toEqual([
      {
        bucket: 'timesheets',
        path: 'invoices/4001/Invoice 4001.pdf',
        filename: 'Invoice 4001.pdf',
      },
      {
        bucket: 'timesheets',
        path: 'invoices/4001/Invoice 4001.xlsx',
        filename: 'Invoice 4001.xlsx',
      },
      { bucket: 'timesheets', path: 'invoices/4001/source/sheet.pdf', filename: 'Timesheet.pdf' },
    ]);
  });

  it('does not treat braces in the office’s subject as placeholders', () => {
    expect(documentMessageFor(inv2({ subject: 'Inv {subject} {total}' })).subject).toBe(
      'Inv {subject} {total}',
    );
  });

  it('leaves Reply-To to the sender when the row has none', () => {
    expect(documentMessageFor(inv2({ replyTo: '' }), { replyTo: 'x@thc.example' }).replyTo).toBe(
      'x@thc.example',
    );
  });

  it('fails the row, not the retry loop, on a fault in it', () => {
    expect(() => documentMessageFor(inv2({ attachments: [] }))).toThrow(UnsendableRow);
    expect(() => documentMessageFor(inv2({ subject: ' ' }))).toThrow(UnsendableRow);
    expect(() => documentMessageFor(inv2({ bodyHtml: '<script>x</script>' }))).toThrow(
      UnsendableRow,
    );
    expect(() => documentMessageFor(inv2({ replyTo: 'nope' }))).toThrow(UnsendableRow);
    expect(() => documentMessageFor(inv2({ cc: 'not json' }))).toThrow(UnsendableRow);
    expect(() => documentMessageFor(inv2({}, { recipient_emails: [] }))).toThrow(UnsendableRow);
    expect(() =>
      documentMessageFor(inv2({ attachments: [{ path: '../other/x.pdf', name: 'x.pdf' }] })),
    ).toThrow(UnsendableRow);
    expect(() => documentMessageFor(inv2({ attachments: [{ path: 'a.pdf' }] }))).toThrow(
      UnsendableRow,
    );
  });

  it('is normal priority', () => {
    expect(sendPriority('INV2')).toBe(PRIORITY.normal);
  });
});
