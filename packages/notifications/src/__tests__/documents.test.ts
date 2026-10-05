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

  it('names it the Allocation Timesheet in the subject, with the PO number (ADR-0073)', () => {
    expect(documentMessageFor(d1()).subject).toBe(
      'Allocation Timesheet — Gala Dinner, Friday 19 September 2026 (PO 4471-A)',
    );
    expect(documentMessageFor(d1()).body).toContain('Your PO number 4471-A is on the sheet.');
  });

  it('drops the PO sentence when the event has none', () => {
    const payload = { ...d1().payload, poNumber: '', poSuffix: '' };
    const message = documentMessageFor(d1({ payload }));
    expect(message.subject).toBe('Allocation Timesheet — Gala Dinner, Friday 19 September 2026');
    expect(message.body).not.toContain('PO number');
  });

  it('says an automatic resend replaces the earlier sheet (ADR-0085), in subject, text and HTML', () => {
    const payload = { ...d1().payload, updateTag: ' (updated)' };
    const message = documentMessageFor(d1({ payload }));
    expect(message.subject).toBe(
      'Allocation Timesheet — Gala Dinner, Friday 19 September 2026 (PO 4471-A) (updated)',
    );
    expect(message.body).toContain('This replaces the Allocation Timesheet we sent earlier');
    expect(message.html).toContain('This replaces the Allocation Timesheet we sent earlier');
    // A first sheet, and a row older than the key, say nothing of the kind.
    expect(documentMessageFor(d1()).body).not.toContain('replaces');
    expect(documentMessageFor(d1({ payload: { ...d1().payload, updateTag: '' } })).subject).toBe(
      'Allocation Timesheet — Gala Dinner, Friday 19 September 2026 (PO 4471-A)',
    );
  });

  it('says when buffer staff are on the sheet, in the sentence and beside the count (ADR-0087)', () => {
    const payload = { ...d1().payload, staffCount: '19', bufferStaff: '2' };
    const message = documentMessageFor(d1({ payload }));
    const sentence =
      'It includes 2 buffer people, booked in addition to the number required to cover late arrivals and drop-outs on the day.';
    expect(message.body).toContain(sentence);
    expect(message.html).toContain(sentence);
    expect(message.html).toContain('19 (incl. 2 buffer)');
    expect(documentMessageFor(d1({ payload: { ...payload, bufferStaff: '1' } })).body).toContain(
      'It includes 1 buffer person, booked',
    );
    // None, and rows older than the key, say nothing about a buffer.
    expect(documentMessageFor(d1()).body).not.toContain('buffer');
    expect(
      documentMessageFor(d1({ payload: { ...d1().payload, bufferStaff: '' } })).html,
    ).not.toContain('buffer');
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

/** ADR-0081: the D1 row for a client with name badges on, as 769 pgTAP writes it. */
describe('D1 with name badges (ADR-0081)', () => {
  const withBadges = (count: number) =>
    d1({
      payload: {
        ...(d1().payload as Record<string, unknown>),
        nameBadges: String(count),
        attachments: JSON.stringify([
          {
            bucket: 'timesheets',
            path: 'ev-1/allocation/x.pdf',
            filename: "Leonardo Hotel St Paul's M and E – Gala Dinner.pdf",
          },
          {
            bucket: 'timesheets',
            path: 'ev-1/badges/x.pdf',
            filename: "Leonardo Hotel St Paul's M and E – Gala Dinner – Name Badges.pdf",
            role: 'badges',
          },
        ]),
      },
    });

  it('attaches the Allocation Timesheet and the badges, in that order', () => {
    const message = documentMessageFor(withBadges(17));
    expect(message.attachments.map((a) => a.path)).toEqual([
      'ev-1/allocation/x.pdf',
      'ev-1/badges/x.pdf',
    ]);
    expect(message.attachments[1]!.role).toBe('badges');
    expect(message.attachments[0]!.role).toBeUndefined();
  });

  it('says so in the text and the HTML, with the count', () => {
    const message = documentMessageFor(withBadges(17));
    const line =
      'Their THC name badges are attached too, as a second PDF: print them, cut along the dashed lines and slide each one into a badge holder.';
    expect(message.body).toContain(line);
    expect(message.html).toContain(line);
    expect(message.html).toContain('Name badges · 17 to print');
    // The count is in the facts box.
    expect(message.html).toMatch(/Name badges<\/td>[\s\S]*?>17</);
    // The sheet's own card keeps the template's note.
    expect(message.html).toContain('Allocation Timesheet · attached');
    expect(message.subject).toBe(
      'Allocation Timesheet — Gala Dinner, Friday 19 September 2026 (PO 4471-A)',
    );
  });

  it('says it in the singular for one badge', () => {
    expect(documentMessageFor(withBadges(1)).body).toContain(
      'Their THC name badge is attached too, as a second PDF: print it, cut along the dashed lines and slide it into a badge holder.',
    );
  });

  it('says nothing about badges for a client without them, or a row from before them', () => {
    for (const row of [d1(), d1({ payload: { ...(d1().payload as object), nameBadges: '' } })]) {
      const message = documentMessageFor(row);
      expect(message.body).not.toContain('badge');
      expect(message.html).not.toContain('badge');
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0]!.role).toBeUndefined();
    }
  });
});
