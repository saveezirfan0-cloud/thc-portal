/**
 * THC Light HTML for every email (ADR-0073): the layout, escaping, the
 * inline logo, and — for the file emails — D1/D2's renamed copy.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THC_MARK_EMAIL_PNG_BASE64 } from '../assets/thc-mark-email';
import { DOCUMENT_EMAILS, documentMessageFor } from '../documents';
import {
  LOGO_CONTENT_ID,
  escapeHtml,
  fillTemplate,
  linkify,
  renderEmailHtml,
  templateToBlocks,
} from '../email-html';
import { EMAIL_PRESENTATION } from '../email-layouts';
import { inlineLogoAttachment } from '../email-logo';
import type { EmailMessage, OutboxRow } from '../outbox';
import { messageFor } from '../outbox';
import type { Template, TemplateCode } from '../templates';
import { TEMPLATES } from '../templates';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** What a reader sees: tags dropped, entities decoded, whitespace collapsed. */
function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<title>[\s\S]*?<\/title>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Every piece of every line of the text is on the HTML page (a facts row splits at ": "). */
function expectSameWords(text: string, html: string) {
  const seen = visibleText(html);
  for (const line of text.split('\n')) {
    for (const piece of line.split(/:\s/)) {
      const words = piece.replace(/\s+/g, ' ').trim().replace(/:$/, '');
      if (words) expect(seen, `"${words}"`).toContain(words);
    }
  }
}

/** Placeholder values that look like the real thing (wireframes/CONVENTIONS.md). */
const SAMPLE: Record<string, string> = {
  name: 'Amara Kovač',
  employeeId: '10482',
  changedAt: '29/09/2026 14:05 (UK time)',
  changed: 'Home address',
  niNumber: 'QQ 12 34 56 C',
  requestedAt: '29/09/2026 09:12',
  reason: 'Moving abroad',
  lastShiftDate: '27/09/2026',
  releasedShifts:
    'Gala Dinner · Leonardo Hotel St Pauls · St Pauls · Waiting Staff · 03/10/2026\nAwards Night · Leonardo Hotel St Pauls · St Pauls · Bar · 10/10/2026',
  declaredAt: '29/09/2026 10:40',
  link: 'https://staff.thehospitalitycompany.co.uk/auth/confirm?token_hash=abc123&type=invite',
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

const EMAIL_CODES = (Object.keys(TEMPLATES) as TemplateCode[]).filter(
  (code) => TEMPLATES[code].channel === 'email',
);
/** E1 is Willo's: the system never sends it, so it has no HTML either. */
const SENDABLE = EMAIL_CODES.filter((code) => code !== 'E1');

function emailRow(code: string, payload: Record<string, string> = SAMPLE): OutboxRow {
  return {
    id: 1,
    key: `${code}:sample:1`,
    channel: 'email',
    template: code,
    recipient_staff_id: null,
    recipient_emails: ['someone@example.com'],
    payload,
    attempts: 0,
  };
}

/**
 * One case per email a row can produce: a code with `variants` (the OC
 * chasers) is a separate email per variant, and the row names it.
 */
const SENDABLE_CASES = SENDABLE.flatMap((code) => {
  const variants = (TEMPLATES[code] as Template).variants;
  return variants
    ? Object.keys(variants).map((variant) => ({ code, variant, label: `${code}.${variant}` }))
    : [{ code, variant: undefined as string | undefined, label: code as string }];
});

function templateBody(code: TemplateCode, variant: string | undefined): string {
  const entry = TEMPLATES[code] as Template;
  return (variant !== undefined ? entry.variants?.[variant]?.body : entry.body) ?? '';
}

function email(code: string, payload?: Record<string, string>, variant?: string): EmailMessage {
  const base = payload ?? SAMPLE;
  const m = messageFor(emailRow(code, variant !== undefined ? { ...base, variant } : base));
  if (m.kind !== 'email') throw new Error(`${code} is not an email`);
  return m;
}

const d1 = (payload: Record<string, string> = {}): OutboxRow => ({
  id: 8,
  key: 'D1:document:abc',
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
        path: 'ev-1/allocation/x.pdf',
        filename: 'Leonardo Hotel St Pauls – Gala Dinner.pdf',
      },
    ]),
    ...payload,
  },
  attempts: 1,
});

const d2 = (payload: Record<string, string> = {}): OutboxRow => ({
  ...d1(),
  key: 'D2:document:def',
  template: 'D2',
  payload: {
    ...d1().payload,
    schedule: '',
    totalHours: '22h 20m',
    attachments: JSON.stringify([
      {
        bucket: 'timesheets',
        path: 'ev-1/signout/y.pdf',
        filename: 'Leonardo Hotel St Pauls – Gala Dinner (completed).pdf',
      },
    ]),
    ...payload,
  },
});

const bg08 = (): OutboxRow => ({
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
      { bucket: 'reports', path: 'payroll/a.csv', filename: 'THC payroll 2026-09-08.csv' },
      { bucket: 'reports', path: 'new-starter/a.csv', filename: 'THC new starters.csv' },
    ]),
  },
  attempts: 1,
});

/** The rules every HTML email keeps, whatever it says. */
function expectEmailSafe(html: string) {
  expect(html).toMatch(/^<!DOCTYPE html>/);
  expect(html).toContain('<meta name="color-scheme" content="light only">');
  expect(html).toContain('<meta name="supported-color-schemes" content="light">');
  expect(html).toContain(':root{color-scheme:light only;');
  expect(html).toContain(`<img src="cid:${LOGO_CONTENT_ID}" width="36" height="36"`);
  expect(html).toContain('The Hospitality Company');
  expect(html).toContain('Event staffing · London');
  expect(html).toContain('Registered Company in England and Wales 12411407');
  expect(html).toContain('www.thehospitalitycompany.co.uk');
  expect(html).toContain('max-width:600px');
  // Every gradient has a solid fallback first, for Outlook.
  const gradients = html.match(/background-image:linear-gradient/g) ?? [];
  const fallbacks = html.match(/background-color:#0a6d79;background-image:linear-gradient/g) ?? [];
  expect(gradients.length).toBeGreaterThan(0);
  expect(fallbacks.length).toBe(gradients.length);
  // Nothing a mail client strips or blocks.
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/src="data:/i);
  expect(html).not.toMatch(/<link[^>]+stylesheet/i);
  expect(html).not.toMatch(/javascript:/i);
  // No dark variant.
  expect(html).not.toMatch(/prefers-color-scheme:\s*dark/);
}

// ---------------------------------------------------------------------------
// the logo
// ---------------------------------------------------------------------------

describe('the inline logo', () => {
  const png = readFileSync(join(__dirname, '..', 'assets', 'thc-mark-email.png'));

  it('the base64 module is the checked-in PNG, byte for byte (regenerate with gen:logo)', () => {
    expect(THC_MARK_EMAIL_PNG_BASE64).toBe(png.toString('base64'));
  });

  it('is a small 96×96 PNG', () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(96);
    expect(png.readUInt32BE(20)).toBe(96);
    expect(png.length).toBeLessThan(10 * 1024);
  });

  it('is attached inline under the Content-ID the header points at', () => {
    expect(inlineLogoAttachment()).toEqual({
      filename: 'thc-mark.png',
      content: THC_MARK_EMAIL_PNG_BASE64,
      contentId: 'thc-mark',
      contentType: 'image/png',
    });
  });
});

// ---------------------------------------------------------------------------
// the layout
// ---------------------------------------------------------------------------

describe('renderEmailHtml', () => {
  it('escapes every value it is given', () => {
    const evil = '<script>alert("x")</script>';
    const html = renderEmailHtml({
      eyebrow: evil,
      title: evil,
      blocks: [
        { kind: 'paragraph', text: evil },
        { kind: 'facts', rows: [{ label: evil, value: evil }] },
        { kind: 'steps', lead: evil, items: [evil] },
        { kind: 'attachments', items: [{ filename: evil, note: evil }] },
        { kind: 'button', label: evil, href: 'https://example.com/?q=<x>' },
      ],
      senderAddress: evil,
      preheader: evil,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('draws a button only for an http(s) or mailto link', () => {
    const html = (href: string) =>
      renderEmailHtml({
        eyebrow: 'e',
        title: 't',
        blocks: [{ kind: 'button', label: 'Go', href }],
        senderAddress: 'admin@thehospitalitycompany.co.uk',
      });
    expect(html('javascript:alert(1)')).not.toContain('>Go</a>');
    expect(html('data:text/html,hi')).not.toContain('>Go</a>');
    expect(html('https://example.com/a?b=1&c=2')).toContain(
      'href="https://example.com/a?b=1&amp;c=2"',
    );
    expect(html('mailto:a@b.co?subject=Re%3A%20x')).toContain(
      'href="mailto:a@b.co?subject=Re%3A%20x"',
    );
  });

  it('draws the header without an image when asked (the Auth template cannot use a CID)', () => {
    const html = renderEmailHtml({
      eyebrow: 'e',
      title: 't',
      blocks: [],
      senderAddress: 'admin@thehospitalitycompany.co.uk',
      logoSrc: null,
    });
    expect(html).not.toContain('<img');
  });

  it('draws the logo only from a cid: or an http(s) source', () => {
    const img = (logoSrc: string) =>
      renderEmailHtml({ eyebrow: 'e', title: 't', blocks: [], senderAddress: 'x@y.co', logoSrc });
    expect(img('cid:thc-mark')).toContain('<img src="cid:thc-mark"');
    expect(img('https://cdn.example/m.png')).toContain('<img src="https://cdn.example/m.png"');
    for (const bad of [
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      'cid:x" onerror="1',
      '//evil.example/x.png',
    ]) {
      expect(img(bad), bad).not.toContain('<img');
    }
  });

  it('keeps an empty facts row as "—" when asked (register copy), and says nothing more', () => {
    const html = renderEmailHtml({
      eyebrow: 'e',
      title: 't',
      blocks: [
        {
          kind: 'facts',
          keepEmpty: true,
          rows: [
            { label: 'Name', value: 'A' },
            { label: 'Note', value: '' },
          ],
        },
      ],
      senderAddress: 'x@y.co',
    });
    expect(html).toMatch(/>Note<\/td><td[^>]*><span[^>]*>—<\/span><\/td>/);
  });

  it('omits a facts row whose value is empty, and the whole box when all are', () => {
    const html = renderEmailHtml({
      eyebrow: 'e',
      title: 't',
      blocks: [
        {
          kind: 'facts',
          rows: [
            { label: 'Kept', value: 'yes' },
            { label: 'Dropped', value: '  ' },
          ],
        },
      ],
      senderAddress: 'x@y.co',
    });
    expect(html).toContain('>Kept<');
    expect(html).not.toContain('Dropped');
    const none = renderEmailHtml({
      eyebrow: 'e',
      title: 't',
      blocks: [{ kind: 'facts', rows: [{ label: 'Dropped', value: '' }] }],
      senderAddress: 'x@y.co',
    });
    expect(none).not.toContain('#f5f1eb;border-radius:12px');
  });
});

describe('linkify, fillTemplate and templateToBlocks', () => {
  it('links http(s) URLs only, leaving trailing punctuation outside', () => {
    expect(linkify('See https://a.example/x. Or javascript:alert(1) or ftp://b')).toBe(
      'See <a href="https://a.example/x" target="_blank" style="color:#0a6d79;text-decoration:underline;word-break:break-all;">https://a.example/x</a>. Or javascript:alert(1) or ftp://b',
    );
  });

  it('links a URL in the template’s own words, never one inside a value', () => {
    const html = fillTemplate('Read https://thc.example/faq then {note}', {
      note: 'go to https://evil.example/login\n\n<b>now</b>',
    });
    expect(html).toContain('href="https://thc.example/faq"');
    expect(html).not.toContain('href="https://evil.example');
    expect(html).toContain('go to https://evil.example/login<br><br>&lt;b&gt;now&lt;/b&gt;');
  });

  it('splits paragraphs on the template’s blank lines, keeping single breaks', () => {
    const values = { a: 'x\n\ny' };
    expect(templateToBlocks('One\n{a}\n\nThree', values)).toEqual([
      { kind: 'filled', template: 'One\n{a}', values },
      { kind: 'filled', template: 'Three', values },
    ]);
  });

  it('boxes a template paragraph made only of "Label: {value}" lines, keeping empty rows', () => {
    expect(templateToBlocks('Name: {name}\nNote: {note}', { name: 'A', note: '' })).toEqual([
      {
        kind: 'facts',
        keepEmpty: true,
        rows: [
          { label: 'Name', value: 'A' },
          { label: 'Note', value: '' },
        ],
      },
    ]);
  });

  it('makes a button of a named placeholder only, and only when its value is http(s)', () => {
    const url = 'https://x.example/set';
    const buttons = { link: 'Set it' };
    expect(templateToBlocks('Set your password: {link}', { link: url }, { buttons })).toEqual([
      { kind: 'filled', template: 'Set your password:', values: { link: url } },
      { kind: 'button', label: 'Set it', href: url, showUrl: true },
    ]);
    // Not named as a button: text, even though the value is a URL.
    expect(templateToBlocks('Note: {note}', { note: url }, { buttons })).toEqual([
      { kind: 'filled', template: 'Note: {note}', values: { note: url } },
    ]);
    // Named, but not an http(s) URL: text.
    const bad = { link: 'javascript:alert(1)' };
    expect(templateToBlocks('Set: {link}', bad, { buttons })).toEqual([
      { kind: 'filled', template: 'Set: {link}', values: bad },
    ]);
  });
});

// ---------------------------------------------------------------------------
// every register email
// ---------------------------------------------------------------------------

describe('every register email has HTML (ADR-0073)', () => {
  it('every email template we send has a presentation', () => {
    expect(Object.keys(EMAIL_PRESENTATION).sort()).toEqual([...SENDABLE].sort());
  });

  it.each(SENDABLE_CASES)(
    '$label renders as THC Light HTML with its own words',
    ({ code, variant }) => {
      const m = email(code, undefined, variant);
      expectEmailSafe(m.html);
      expect(m.html).toContain(
        `>${escapeHtml(EMAIL_PRESENTATION[code as keyof typeof EMAIL_PRESENTATION].eyebrow)}</p>`,
      );
      expect(m.html).toContain(`<title>${escapeHtml(m.subject)}</title>`);
      expect(m.html).toContain(`class="thc-title"`);
      // Footer: the sender's monitored address (the default here).
      expect(m.html).toContain('>admin@thehospitalitycompany.co.uk</a> · ');
      // Wording is contract: the text body is the register's, unchanged, and
      // the HTML shows every word of it.
      expectSameWords(m.body, m.html);
    },
  );

  it('escapes a value from the row', () => {
    const m = email('E5', { ...SAMPLE, name: '<script>alert(1)</script>' });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(m.body).toContain('<script>alert(1)</script>');
  });

  it('draws the E3 links as buttons, with the URL printed under each', () => {
    const m = email('E3');
    expect(m.html).toContain('>Set your password</a>');
    expect(m.html).toContain('>Get the THC Staff App</a>');
    expect(m.html).toContain(
      'href="https://staff.thehospitalitycompany.co.uk/auth/confirm?token_hash=abc123&amp;type=invite"',
    );
    expect(m.html).toContain('Set your password to start onboarding:');
  });

  it('never makes a button, or a link, of a URL that is not http(s)', () => {
    const m = email('E3', { ...SAMPLE, link: 'javascript:alert(1)' });
    expect(m.html).not.toMatch(/href="javascript:/i);
    expect(m.html).not.toContain('>Set your password</a>');
  });

  it('lays an office email’s detail lines out as a facts box', () => {
    const html = email('E5').html;
    expect(html).toMatch(/>Employee ID<\/td><td[^>]*>10482<\/td>/);
  });

  it('E9 carries nothing beyond its register copy', () => {
    const m = email('E9');
    expect(m.body).toBe(
      TEMPLATES.E9.body
        .replace('{name}', SAMPLE.name!)
        .replace('{employeeId}', SAMPLE.employeeId!)
        .replace('{declaredAt}', SAMPLE.declaredAt!)
        .replace('{releasedShifts}', SAMPLE.releasedShifts!),
    );
    expect(m.html).toContain('The declaration details are not included in this email');
  });

  it('names the reply-to it is given in the footer', () => {
    const m = messageFor(emailRow('E2'), { replyTo: 'office@thc.example' });
    if (m.kind !== 'email') throw new Error('not an email');
    expect(m.html).toContain('href="mailto:office@thc.example"');
    expect(m.html).not.toContain('admin@thehospitalitycompany.co.uk');
  });
});

describe('a value typed by a person can never change the layout', () => {
  const HOSTILE =
    'Please verify at https://evil.example/login\n\nApproved by office: yes\nEmployee ID: 1';
  const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
  const shape = (html: string) => ({
    links: count(html, /<a /g),
    paragraphs: count(html, /<p /g),
    factRows: count(html, /<td valign="top" width="38%"/g),
    buttons: count(html, /border-radius:999px;background-color:#0a6d79/g),
  });

  /** Every placeholder of every email, except the ones that are links by design. */
  const cases = SENDABLE_CASES.flatMap(({ code, variant, label }) => {
    const buttons = Object.keys(
      (EMAIL_PRESENTATION[code as keyof typeof EMAIL_PRESENTATION] as { buttons?: object })
        .buttons ?? {},
    );
    const names = [...templateBody(code, variant).matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
    return [...new Set(names)]
      .filter((n) => !buttons.includes(n))
      .map((n) => [label, n, code, variant] as const);
  });

  it('covers the free-text fields people type', () => {
    const names = cases.map(([code, name]) => `${code}.${name}`);
    for (const typed of ['RC1.note', 'OF5.note', 'E8.reason', 'RC1.proposed', 'E7.changed']) {
      expect(names).toContain(typed);
    }
  });

  it.each(cases)(
    '%s: a URL, blank lines and "Label: value" lines in {%s} add no link, paragraph or row',
    (_label, name, code, variant) => {
      const benign = email(code, undefined, variant).html;
      const hostile = email(code, { ...SAMPLE, [name]: HOSTILE }, variant).html;
      expect(shape(hostile)).toEqual(shape(benign));
      expect(hostile).not.toContain('href="https://evil.example');
      // The words are still there, as text.
      expect(visibleText(hostile)).toContain('Please verify at https://evil.example/login');
    },
  );

  it('RC1: the QA example stays inside the Note cell', () => {
    const html = email('RC1', { ...SAMPLE, note: HOSTILE }).html;
    expect(html).toMatch(
      /Note<\/td><td[^>]*>Please verify at https:\/\/evil\.example\/login<br><br>Approved by office: yes<br>Employee ID: 1<\/td>/,
    );
  });

  it('keeps a register facts row whose value is empty, as the text keeps "Note: "', () => {
    for (const code of ['OF5', 'RC1'] as const) {
      const m = email(code, { ...SAMPLE, note: '' });
      expect(m.body).toContain('Note: ');
      expect(m.html, code).toMatch(/>Note<\/td><td[^>]*><span[^>]*>—<\/span><\/td>/);
    }
  });
});

// ---------------------------------------------------------------------------
// the file emails
// ---------------------------------------------------------------------------

const BEFORE_THE_EVENT = /check-?\s?in|check-?\s?out|sign-?\s?out/i;

describe('D1 — the Allocation Timesheet, before the event', () => {
  it('has the text THC wrote', () => {
    const m = documentMessageFor(d1());
    expect(m.subject).toBe(
      'Allocation Timesheet — Gala Dinner, Friday 19 September 2026 (PO 4471-A)',
    );
    expect(m.body).toBe(
      [
        'Hello,',
        '',
        "Please find attached the Allocation Timesheet for the Gala Dinner on Friday 19 September 2026. It lists the 17 staff booked to work, with each person's role and scheduled start and finish times. Your PO number 4471-A is on the sheet.",
        '',
        'On the day, please ask your manager on site to:',
        "1. fill in each person's finish time, any comments (breaks, early finishes) and hours worked,",
        '2. print and sign their name at the bottom,',
        '3. email the signed sheet back to us — just reply to this email.',
        '',
        'Any questions, you can reach us the same way.',
        '',
        'Best regards,',
        'The Hospitality Company',
        'timesheets@thehospitalitycompany.co.uk · www.thehospitalitycompany.co.uk',
      ].join('\n'),
    );
  });

  it('never mentions check-in, check-out or a sign-out sheet — the event has not happened', () => {
    const m = documentMessageFor(d1());
    expect(m.subject).not.toMatch(BEFORE_THE_EVENT);
    expect(m.body).not.toMatch(BEFORE_THE_EVENT);
    expect(visibleText(m.html)).not.toMatch(BEFORE_THE_EVENT);
    expect(m.html).not.toMatch(BEFORE_THE_EVENT);
  });

  it('lays out the intro, facts, steps, file card, reply button and sign-off', () => {
    const { html } = documentMessageFor(d1());
    expectEmailSafe(html);
    const seen = visibleText(html);
    expect(html).toContain('>Allocation Timesheet</p>');
    expect(html).toMatch(/<h1[^>]*>Gala Dinner<\/h1>/);
    for (const [label, value] of [
      ['Client', 'Leonardo Hotel St Pauls'],
      ['Date', 'Friday 19 September 2026'],
      ['Staff booked', '17'],
      ['PO number', '4471-A'],
    ]) {
      expect(html).toMatch(new RegExp(`>${label}</td><td[^>]*>${value}</td>`));
    }
    expect(html).toContain('>Scheduled</td>');
    expect(html).toContain('Chef 07:00 – 15:00<br>Waiting Staff 17:00 – 23:30');
    expect(seen).toContain('On the day, please ask your manager on site to:');
    expect(seen).toContain('print and sign their name at the bottom,');
    expect(seen).toContain('Leonardo Hotel St Pauls – Gala Dinner.pdf');
    expect(seen).toContain('Allocation Timesheet · attached');
    expect(html).toContain(
      `href="mailto:timesheets@thehospitalitycompany.co.uk?subject=${encodeURIComponent('Re: Allocation Timesheet — Gala Dinner, Friday 19 September 2026 (PO 4471-A)')}"`,
    );
    expect(html).toContain('>Reply with the signed sheet</a>');
    expect(seen).toContain('Best regards, The Hospitality Company');
    expect(html).toContain('>timesheets@thehospitalitycompany.co.uk</a> · ');
  });

  it('keeps every sentence of the HTML’s own copy (intro, steps, closing) in the text too', () => {
    const m = documentMessageFor(d1());
    const copy = DOCUMENT_EMAILS.D1.html;
    for (const sentence of [copy.stepsLead, ...copy.steps, copy.closing]) {
      expect(m.body).toContain(sentence);
    }
    const d2copy = DOCUMENT_EMAILS.D2.html;
    const d2body = documentMessageFor(d2()).body;
    expect(d2body).toContain(d2copy.closing);
    expect(d2body).toContain(d2copy.intro.split('{event}')[0]);
    expect(m.body).toContain(
      "Please find attached the Allocation Timesheet for the Gala Dinner on Friday 19 September 2026. It lists the 17 staff booked to work, with each person's role and scheduled start and finish times. Your PO number 4471-A is on the sheet.",
    );
    expect(visibleText(m.html)).toContain(
      "Please find attached the Allocation Timesheet for the Gala Dinner on Friday 19 September 2026. It lists the 17 staff booked to work, with each person's role and scheduled start and finish times. Your PO number 4471-A is on the sheet.",
    );
  });

  it('renders an older row without client, schedule or PO, omitting those rows', () => {
    const payload = { ...d1().payload, poNumber: '', poSuffix: '' };
    delete (payload as Record<string, string>).client;
    delete (payload as Record<string, string>).schedule;
    const m = documentMessageFor({ ...d1(), payload });
    expect(m.subject).toBe('Allocation Timesheet — Gala Dinner, Friday 19 September 2026');
    expect(m.html).not.toContain('>Client</td>');
    expect(m.html).not.toContain('>Scheduled</td>');
    expect(m.html).not.toContain('>PO number</td>');
    expect(m.html).toContain('>Staff booked</td>');
    expect(m.body).not.toContain('PO number');
  });

  it('escapes the event name and the file name', () => {
    const m = documentMessageFor(
      d1({
        event: '<script>x</script>',
        attachments: JSON.stringify([
          { bucket: 'timesheets', path: 'a/b.pdf', filename: '<img src=x onerror=1>.pdf' },
        ]),
      }),
    );
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<img src=x');
    expect(m.html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });
});

describe('D2 — the Completed Allocation Timesheet, after the event', () => {
  it('has the text THC wrote, with the check-in/check-out wording', () => {
    const m = documentMessageFor(d2());
    expect(m.subject).toBe(
      'Completed Allocation Timesheet — Gala Dinner, Friday 19 September 2026 (PO 4471-A)',
    );
    expect(m.body).toBe(
      "Hello,\n\nPlease find attached the completed Allocation Timesheet for the Gala Dinner on Friday 19 September 2026 — 17 staff, with finish times, breaks and hours worked taken from each person's check-in and check-out in the THC Staff App. Your PO number 4471-A is on the sheet.\n\nIf anything doesn't match your records, just reply to this email and we'll look into it.\n\nBest regards,\nThe Hospitality Company\ntimesheets@thehospitalitycompany.co.uk · www.thehospitalitycompany.co.uk",
    );
    expect(visibleText(m.html)).toContain(
      "taken from each person's check-in and check-out in the THC Staff App",
    );
  });

  it('never says "sign-out timesheet" to a client', () => {
    const m = documentMessageFor(d2());
    for (const s of [m.subject, m.body, m.html]) expect(s).not.toMatch(/sign-?\s?out/i);
  });

  it('lays out the facts, the file card and a reply button', () => {
    const { html } = documentMessageFor(d2());
    expectEmailSafe(html);
    expect(html).toContain('>Completed Allocation Timesheet</p>');
    expect(html).toMatch(/>Total hours<\/td><td[^>]*>22h 20m<\/td>/);
    expect(html).toMatch(/>Staff<\/td><td[^>]*>17<\/td>/);
    expect(html).toContain('Completed Allocation Timesheet · attached');
    expect(html).toContain('>Reply to this email</a>');
    expect(html).toContain('href="mailto:timesheets@thehospitalitycompany.co.uk?subject=Re%3A%20');
  });

  it('omits Total hours on a row written before the payload carried it', () => {
    const payload = { ...d2().payload };
    delete (payload as Record<string, string>).totalHours;
    const { html } = documentMessageFor({ ...d2(), payload });
    expect(html).not.toContain('Total hours');
  });
});

describe('the Supabase Auth recovery email is THC Light too', () => {
  const html = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'supabase', 'templates', 'recovery.html'),
    'utf8',
  );

  it('keeps its GoTrue link exactly, and draws it as the pill button', () => {
    expect(html).toContain(
      'href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery&next=/reset"',
    );
    expect(html).toContain('Set a new password');
    expect(html).toContain('background-color: #0a6d79;');
    expect(html).toContain('linear-gradient(135deg, #0a6d79 0%, #7758cd 100%)');
  });

  it('is light only, with no image GoTrue could not send', () => {
    expect(html).toContain('<meta name="color-scheme" content="light only" />');
    expect(html).toContain('<meta name="supported-color-schemes" content="light" />');
    expect(html).toMatch(/color-scheme: light only;/);
    // The header comment explains why; the markup itself carries no image.
    const markup = html.replace(/<!--[\s\S]*?-->/g, '');
    expect(markup).not.toMatch(/<img|cid:|data:/);
    expect(html).toContain('Registered Company in England and Wales 12411407');
    expect(html).toMatch(/re-paste[\s\S]*Reset Password/);
  });
});

describe('BG08 — the payroll email', () => {
  it('keeps its wording and adds the facts box and the CSV cards', () => {
    const m = documentMessageFor(bg08());
    expectEmailSafe(m.html);
    expectSameWords(m.body, m.html);
    expect(m.html).toContain('>Weekly payroll</p>');
    expect(m.html).toMatch(/>Shifts<\/td><td[^>]*>486<\/td>/);
    expect(m.html).toMatch(
      />Period<\/td><td[^>]*>Monday 08\/09\/2026 to Sunday 14\/09\/2026<\/td>/,
    );
    expect(m.html).toContain('THC payroll 2026-09-08.csv');
    expect(m.html).toContain('THC new starters.csv');
    expect(m.html).toContain('>CSV</td>');
    expect(m.html).toContain('>admin@thehospitalitycompany.co.uk</a> · ');
  });
});
