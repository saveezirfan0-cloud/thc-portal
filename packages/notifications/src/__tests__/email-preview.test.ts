/**
 * Writes every email, rendered with sample values, to a directory for
 * screenshots (ADR-0073). Skipped unless THC_EMAIL_PREVIEW_DIR is set:
 *
 *   THC_EMAIL_PREVIEW_DIR=/abs/path pnpm --filter @thc/notifications preview:emails
 *
 * Each email is written as <code>.html (the logo's `cid:` swapped for the
 * PNG beside it, so a browser shows it) and <code>.txt, with an index.html
 * linking them. A relative directory is taken from packages/notifications.
 * Nothing here is committed.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentMessageFor } from '../documents';
import { LOGO_CONTENT_ID, escapeHtml } from '../email-html';
import type { OutboxRow } from '../outbox';
import { messageFor } from '../outbox';
import type { TemplateCode } from '../templates';
import { TEMPLATES } from '../templates';

const DIR = process.env.THC_EMAIL_PREVIEW_DIR;

const VALUES: Record<string, string> = {
  name: 'Amara Kovač',
  employeeId: '10482',
  changedAt: '29/09/2026 14:05',
  changed: 'Home address',
  niNumber: 'QQ 12 34 56 C',
  requestedAt: '29/09/2026 09:12',
  reason: 'Moving abroad',
  lastShiftDate: '27/09/2026',
  releasedShifts:
    'Gala Dinner · Leonardo Hotel St Pauls · St Pauls · Waiting Staff · 03/10/2026\nAwards Night · Leonardo Hotel St Pauls · St Pauls · Bar · 10/10/2026',
  declaredAt: '29/09/2026 10:40',
  link: 'https://staff.thehospitalitycompany.co.uk/auth/confirm?token_hash=pkce_8f2a1c&type=invite&next=/onboarding',
  installLink: 'https://staff.thehospitalitycompany.co.uk/install',
  app: 'Back Office',
  event: 'Gala Dinner',
  client: 'Leonardo Hotel St Pauls',
  venue: 'St Pauls',
  role: 'Waiting Staff',
  date: 'Friday 3 October 2026',
  dateTime: 'Fri 3 Oct 17:00–23:30',
  cancelledAt: '29/09/2026 11:02',
  confirmed: '5',
  headcount: '6',
  buffer: '1',
  autoAssign: 'On',
  uploadedAt: '29/09/2026 08:30',
  form: 'Completion letter',
  completionDate: '30/06/2026',
  days: '30',
  route: 'Student visa',
  visaExpiry: '29/10/2026',
  signedAt: '29/09/2026 12:00',
  signedCopy: 'signed in the app',
  noticeDays: '7',
  effectiveFrom: '06/10/2026',
  overCapWeeks: 'none',
  field: 'name',
  current: 'Amara Kovac',
  proposed: 'Amara Kovač',
  note: 'Spelling',
  previousName: 'Amara Kovac',
  approvedAt: '29/09/2026 15:00',
};

const DOCUMENT_ROWS: OutboxRow[] = [
  {
    id: 1,
    key: 'D1:preview',
    channel: 'email',
    template: 'D1',
    recipient_staff_id: null,
    recipient_emails: ['events@leonardo-stpauls.co.uk'],
    payload: {
      event: 'Gala Dinner',
      client: 'Leonardo Hotel St Pauls',
      date: 'Friday 19 September 2026',
      poNumber: '4471-A',
      poSuffix: ' (PO 4471-A)',
      staffCount: '17',
      schedule: 'Chef 07:00 – 15:00 · Waiting Staff 17:00 – 23:30',
      attachments: JSON.stringify([
        {
          bucket: 'timesheets',
          path: 'p/a.pdf',
          filename: 'Leonardo Hotel St Pauls – Gala Dinner – Allocation Timesheet.pdf',
        },
      ]),
    },
    attempts: 0,
  },
  {
    id: 2,
    key: 'D2:preview',
    channel: 'email',
    template: 'D2',
    recipient_staff_id: null,
    recipient_emails: ['events@leonardo-stpauls.co.uk'],
    payload: {
      event: 'Gala Dinner',
      client: 'Leonardo Hotel St Pauls',
      date: 'Friday 19 September 2026',
      poNumber: '4471-A',
      poSuffix: ' (PO 4471-A)',
      staffCount: '17',
      schedule: 'Chef 07:00 – 15:00 · Waiting Staff 17:00 – 23:30',
      totalHours: '22h 20m',
      attachments: JSON.stringify([
        {
          bucket: 'timesheets',
          path: 'p/b.pdf',
          filename: 'Leonardo Hotel St Pauls – Gala Dinner – Completed Allocation Timesheet.pdf',
        },
      ]),
    },
    attempts: 0,
  },
  {
    id: 3,
    key: 'BG08:preview',
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
          path: 'p/c.csv',
          filename: 'THC payroll 2026-09-08 to 2026-09-14.csv',
        },
        {
          bucket: 'reports',
          path: 'p/d.csv',
          filename: 'THC new starters (HMRC) 2026-09-08 to 2026-09-14.csv',
        },
      ]),
    },
    attempts: 0,
  },
];

describe.skipIf(!DIR)('email previews (THC_EMAIL_PREVIEW_DIR)', () => {
  it('writes every email as HTML and text', () => {
    const dir = resolve(DIR!);
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(__dirname, '..', 'assets', 'thc-mark-email.png'), join(dir, 'thc-mark.png'));

    const written: { code: string; subject: string }[] = [];
    const write = (code: string, subject: string, html: string, text: string) => {
      writeFileSync(
        join(dir, `${code}.html`),
        html.split(`cid:${LOGO_CONTENT_ID}`).join('thc-mark.png'),
      );
      writeFileSync(join(dir, `${code}.txt`), `Subject: ${subject}\n\n${text}\n`);
      written.push({ code, subject });
    };

    for (const row of DOCUMENT_ROWS) {
      const m = documentMessageFor(row);
      write(row.template, m.subject, m.html, m.body);
    }
    for (const code of Object.keys(TEMPLATES) as TemplateCode[]) {
      const entry = TEMPLATES[code];
      if (entry.channel !== 'email' || entry.sender === 'willo') continue;
      // A code with variants (the OC chasers) is one email per variant.
      const variants: (string | undefined)[] =
        'variants' in entry && entry.variants ? Object.keys(entry.variants) : [undefined];
      for (const variant of variants) {
        const m = messageFor({
          id: 0,
          key: `${code}:preview`,
          channel: 'email',
          template: code,
          recipient_staff_id: null,
          recipient_emails: ['someone@example.com'],
          payload: variant !== undefined ? { ...VALUES, variant } : VALUES,
          attempts: 0,
        });
        if (m.kind === 'email') {
          write(variant !== undefined ? `${code}-${variant}` : code, m.subject, m.html, m.body);
        }
      }
    }

    writeFileSync(
      join(dir, 'index.html'),
      `<!DOCTYPE html><meta charset="utf-8"><title>THC email previews</title><body style="font-family:Arial,sans-serif;padding:24px"><h1>THC email previews</h1><ul>${written
        .map(
          (w) =>
            `<li><a href="${w.code}.html">${w.code}</a> · <a href="${w.code}.txt">text</a> — ${escapeHtml(w.subject)}</li>`,
        )
        .join('')}</ul></body>`,
    );
    console.warn(`wrote ${written.length} email previews to ${dir}`);
    expect(written.length).toBe(27);
  });
});
