import { describe, expect, it } from 'vitest';
import { DOCUMENT_EMAILS, documentMessageFor, isDocumentEmail } from '../documents';
import { UnsendableRow, messageFor } from '../outbox';
import type { OutboxRow } from '../outbox';
import { TEMPLATES } from '../templates';

/** The payloads exactly as the SQL functions write them (410/411 pgTAP). */
const bg08 = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 7,
  key: 'BG08:2026-09-08',
  channel: 'email',
  template: 'BG08',
  recipient_staff_id: null,
  recipient_emails: null,
  payload: {
    periodStart: '08/09/2026',
    periodEnd: '14/09/2026',
    rows: '486',
    held: '1',
    newStarters: '3',
    attachments: JSON.stringify([
      {
        bucket: 'reports',
        path: 'payroll/2026-09-08.csv',
        filename: 'THC payroll 2026-09-08 to 2026-09-14.csv',
      },
      {
        bucket: 'reports',
        path: 'new-starter/2026-09-08.csv',
        filename: 'THC new starters (HMRC) 2026-09-08 to 2026-09-14.csv',
      },
    ]),
  },
  attempts: 1,
  ...over,
});

const d1 = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 8,
  key: 'D1:document:abc',
  channel: 'email',
  template: 'D1',
  recipient_staff_id: null,
  recipient_emails: [
    'hannah.brooks@leonardo-stpauls.co.uk',
    'marco.vitale@leonardo-stpauls.co.uk',
    'events@leonardo-stpauls.co.uk',
  ],
  payload: {
    event: 'Gala Dinner',
    client: 'Leonardo Hotel St Pauls',
    date: 'Friday 19 September 2026',
    poNumber: '4471-A',
    poSuffix: ' (PO 4471-A)',
    staffCount: '17',
    attachments: JSON.stringify([
      {
        bucket: 'timesheets',
        path: 'ev-1/allocation/x.pdf',
        filename: 'Leonardo Hotel St Pauls – Gala Dinner.pdf',
      },
    ]),
  },
  attempts: 1,
  ...over,
});

describe('BG-08 finance email (§9.9)', () => {
  it('goes from admin@ to the same payroll addresses as E5/E6', () => {
    const message = documentMessageFor(bg08());
    expect(message.sender).toBe('admin');
    expect(message.to).toEqual(TEMPLATES.E5.recipients);
    expect(message.to).toContain('thc_payroll@topsourceworldwide.com');
    expect(message.to).toContain('gisela@thehospitalitycompany.co.uk');
  });

  it('carries the payroll CSV always and the HMRC CSV when there are new starters', () => {
    const message = documentMessageFor(bg08());
    expect(message.subject).toBe('THC payroll — 08/09/2026 to 14/09/2026');
    expect(message.attachments.map((a) => a.path)).toEqual([
      'payroll/2026-09-08.csv',
      'new-starter/2026-09-08.csv',
    ]);
    expect(message.body).toContain('3 new starters');
    expect(message.body).toContain('1 shift is held out of this file');
  });

  it('says there were no new starters rather than attaching an empty file', () => {
    const row = bg08();
    const payload = {
      ...row.payload,
      newStarters: '0',
      held: '0',
      attachments: JSON.stringify([JSON.parse(row.payload.attachments!)[0]]),
    };
    const message = documentMessageFor({ ...row, payload });
    expect(message.attachments).toHaveLength(1);
    expect(message.body).toContain('no new starters this week');
    expect(message.body).toContain('No shifts were held back');
  });

  it("refuses an attachment from another bucket — the timesheets bucket is not finance's", () => {
    const payload = {
      ...bg08().payload,
      attachments: JSON.stringify([{ bucket: 'timesheets', path: 'x.pdf', filename: 'x.pdf' }]),
    };
    expect(() => documentMessageFor(bg08({ payload }))).toThrow(UnsendableRow);
  });
});

describe('§11.4 allocation sheet email', () => {
  it('goes from timesheets@ to every contact email on the client card', () => {
    const message = documentMessageFor(d1());
    expect(message.sender).toBe('timesheets');
    expect(message.to).toHaveLength(3);
  });

  it('uses the wireframe subject, with the PO number', () => {
    expect(documentMessageFor(d1()).subject).toBe(
      'Staff allocation — Gala Dinner, Friday 19 September 2026 (PO 4471-A)',
    );
    expect(documentMessageFor(d1()).body).toContain('Your PO number 4471-A is on the sheet.');
  });

  it('drops the PO sentence when the event has none', () => {
    const payload = { ...d1().payload, poNumber: '', poSuffix: '' };
    const message = documentMessageFor(d1({ payload }));
    expect(message.subject).toBe('Staff allocation — Gala Dinner, Friday 19 September 2026');
    expect(message.body).not.toContain('PO number');
  });

  it('attaches the stored PDF by reference', () => {
    expect(documentMessageFor(d1()).attachments).toEqual([
      {
        bucket: 'timesheets',
        path: 'ev-1/allocation/x.pdf',
        filename: 'Leonardo Hotel St Pauls – Gala Dinner.pdf',
      },
    ]);
  });

  it('fails a row with no recipient, no attachment or a path that escapes its folder', () => {
    expect(() => documentMessageFor(d1({ recipient_emails: [] }))).toThrow(UnsendableRow);
    expect(() =>
      documentMessageFor(d1({ payload: { ...d1().payload, attachments: '[]' } })),
    ).toThrow(UnsendableRow);
    const escape = JSON.stringify([
      { bucket: 'timesheets', path: '../documents/passport.pdf', filename: 'x.pdf' },
    ]);
    expect(() =>
      documentMessageFor(d1({ payload: { ...d1().payload, attachments: escape } })),
    ).toThrow(UnsendableRow);
  });
});

describe('the drain can tell the two registers apart', () => {
  it('knows the three document emails and nothing from §8', () => {
    expect(Object.keys(DOCUMENT_EMAILS).sort()).toEqual(['BG08', 'D1', 'D2']);
    expect(isDocumentEmail('D1')).toBe(true);
    expect(isDocumentEmail('E5')).toBe(false);
  });

  it('messageFor still refuses them, so a drain that forgets to route them fails loudly', () => {
    expect(() => messageFor(d1())).toThrow(UnsendableRow);
  });

  it('never reuses a §8 code', () => {
    for (const code of Object.keys(DOCUMENT_EMAILS)) {
      expect(Object.keys(TEMPLATES)).not.toContain(code);
    }
  });
});
