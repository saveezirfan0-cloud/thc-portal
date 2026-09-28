import { describe, expect, it, vi } from 'vitest';
import type { DrainConfig, DrainPorts } from '../drain';
import { drainRow, readDrainConfig } from '../drain';
import { DOCUMENT_EMAILS } from '../documents';
import { EMAIL_LIGHT, emailPresentationFor, escapeHtml, renderEmailHtml } from '../email-html';
import type { OutboxRow } from '../outbox';
import { messageFor } from '../outbox';
import type { Template } from '../templates';
import { TEMPLATES, body, template } from '../templates';

/**
 * The HTML part of every email (email-html.ts): the app's look, the same
 * words as the text part, and nothing a person typed ever reaching the
 * markup unescaped.
 */

const ACTIVATE =
  'https://staff.thc.example/activate/3d33c4a9e57b3b4bd9d0cd69866466a339137cfad81514382362b852';
const INSTALL = 'https://staff.thc.example/install';

const e3 = (payload: Record<string, string> = {}): OutboxRow => ({
  id: 3,
  key: 'E3:staff:x:1',
  channel: 'email',
  template: 'E3',
  recipient_staff_id: null,
  recipient_emails: ['rae@example.com'],
  payload: { name: 'Rae', link: ACTIVATE, installLink: INSTALL, ...payload },
  attempts: 1,
});

function htmlFor(row: OutboxRow, replyTo = 'admin@thc.example'): string {
  const m = messageFor(row);
  if (m.kind !== 'email') throw new Error('not an email');
  return renderEmailHtml({
    subject: m.subject,
    text: m.body,
    ...emailPresentationFor(row.template, row.payload),
    replyTo,
  });
}

/** Visible text of the document, near enough for "does it say X". */
const visible = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#8203;/g, ' ')
    .replace(/\s+/g, ' ');

describe('E3 — the activation email', () => {
  it('still carries everything §8 names in the text part', () => {
    const copy = body('E3');
    expect(copy).toContain('{link}');
    expect(copy).toContain('{installLink}');
    expect(copy.toLowerCase()).toContain('set your password');
    expect(copy.toLowerCase()).toContain('download the app');
  });

  it('asks only for the values the database writes (link, installLink, name)', () => {
    const asked = new Set(
      [...`${template('E3').title} ${body('E3')}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
    );
    expect([...asked].sort()).toEqual(['installLink', 'link', 'name']);
  });

  it('draws a button for each step, pointing at the row’s links', () => {
    const html = htmlFor(e3());
    expect(html).toContain(`href="${ACTIVATE}"`);
    expect(html).toContain(`href="${INSTALL}"`);
    expect(visible(html)).toContain('Set my password');
    expect(visible(html)).toContain('Get the app');
    // Two numbered steps.
    expect(html.match(/class="thc-badge"/g)).toHaveLength(2);
  });

  it('leaves no placeholder anywhere, and says the words of the text part', () => {
    const html = htmlFor(e3());
    expect(html).not.toMatch(/\{\w+\}/);
    expect(visible(html)).toContain('Welcome to the team!');
    expect(visible(html)).toContain('Hello Rae,');
    expect(visible(html)).toContain('upload your documents');
  });

  it('uses the app’s warm palette and gradient primary', () => {
    const html = htmlFor(e3());
    expect(html).toContain(EMAIL_LIGHT.bg);
    expect(html).toContain(
      `linear-gradient(135deg,${EMAIL_LIGHT.gradFrom} 0%,${EMAIL_LIGHT.gradTo} 100%)`,
    );
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('Plus Jakarta Sans');
  });
});

describe('safety', () => {
  it('escapes what people type', () => {
    const html = htmlFor(e3({ name: '<script>alert(1)</script>' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain(escapeHtml('<script>alert(1)</script>'));
  });

  it('never puts a non-http link in a button', () => {
    const html = htmlFor(e3({ link: 'javascript:alert(1)' }));
    expect(html).not.toContain('href="javascript:');
    expect(emailPresentationFor('E3', { link: 'javascript:alert(1)' }).buttons).toEqual([]);
  });

  it('drops an unfilled placeholder from a heading rather than showing it', () => {
    expect(emailPresentationFor('E11', { name: 'Nadia' }).eyebrow).toBe('THC');
  });
});

describe('every email in the register', () => {
  const emails = Object.values(TEMPLATES).filter(
    (t) => t.channel === 'email' && t.sender !== 'willo',
  );

  it.each(emails.map((t) => t.code))('%s renders to a full HTML document', (code) => {
    const entry: Template = TEMPLATES[code as keyof typeof TEMPLATES];
    const payload = Object.fromEntries(
      [...`${entry.title} ${entry.body ?? ''}`.matchAll(/\{(\w+)\}/g)].map((m) => [m[1], 'x']),
    );
    const html = htmlFor({
      ...e3(),
      template: code,
      key: `${code}:t:1`,
      recipient_emails: ['someone@example.com'],
      payload,
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('class="thc-card');
  });

  it('lays an office email’s fields out as a table, with an office footer', () => {
    const html = htmlFor({
      ...e3(),
      template: 'E8',
      key: 'E8:t:1',
      recipient_emails: null,
      payload: {
        name: 'Sam Okafor',
        employeeId: '10442',
        niNumber: 'QQ123456C',
        requestedAt: '28 Sep 2026',
        reason: 'Moving',
        lastShiftDate: '20 Sep 2026',
        releasedShifts: 'none',
      },
    });
    expect(html.match(/class="thc-muted thc-row"/g)).toHaveLength(6);
    expect(visible(html)).toContain('Sent automatically by the THC staffing platform');
    expect(visible(html)).not.toContain('Questions? Just reply');
  });

  it('invites a reply on an email to a worker or a client', () => {
    expect(visible(htmlFor(e3()))).toContain('Questions? Just reply to this email');
  });
});

describe('document emails', () => {
  it('lists the attachments by name', () => {
    const html = renderEmailHtml({
      subject: DOCUMENT_EMAILS.D1.title,
      text: 'Hello,\n\nPlease find attached.',
      attachments: ['Allocation - Gala.pdf'],
      replyTo: 'timesheets@thc.example',
    });
    expect(visible(html)).toContain('Attached');
    expect(visible(html)).toContain('Allocation - Gala.pdf');
  });
});

describe('the drain sends the HTML part beside the text', () => {
  const CONFIGURED: DrainConfig = { resendApiKey: 're_test_key', vapid: null, missing: [] };

  function ports() {
    const sent: { body: string }[] = [];
    const p: DrainPorts = {
      http: vi.fn(async (req) => {
        sent.push({ body: req.body as string });
        return { status: 200, text: async () => '{"id":"x"}' };
      }),
      subscriptionsFor: vi.fn(async () => []),
      deleteSubscription: vi.fn(async () => {}),
      download: vi.fn(async () => null),
      log: () => {},
    };
    return { p, sent };
  }

  it('text is unchanged; html carries the same link as a button', async () => {
    const { p, sent } = ports();
    const s = await drainRow(e3(), CONFIGURED, { admin: 'admin@thc.example' }, p);
    expect(s).toMatchObject({ verdict: 'sent' });
    const payload = JSON.parse(sent[0]!.body);
    const message = messageFor(e3());
    expect(payload.text).toBe(message.kind === 'email' ? message.body : '');
    expect(payload.html).toContain(`href="${ACTIVATE}"`);
    expect(payload.html).toContain('admin@thc.example');
  });

  it('shows the app icon from STAFF_APP_URL when it is set', async () => {
    const config = readDrainConfig(
      (n) => ({ RESEND_API_KEY: 'k', STAFF_APP_URL: 'https://staff.thc.example/' })[n],
    );
    expect(config.logoUrl).toBe('https://staff.thc.example/icon-192.png');
    expect(config.missing).not.toContain('STAFF_APP_URL');
    const { p, sent } = ports();
    await drainRow(e3(), config, null, p);
    expect(JSON.parse(sent[0]!.body).html).toContain(
      'src="https://staff.thc.example/icon-192.png"',
    );
  });

  it('has no image at all when STAFF_APP_URL is not set', () => {
    expect(readDrainConfig(() => undefined).logoUrl).toBeNull();
    expect(htmlFor(e3())).not.toContain('<img');
  });
});
