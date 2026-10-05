import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_EMAILS } from '../documents';
import {
  ALL_EMAIL_LOG_CODES,
  CLIENT_INBOX,
  EMAIL_AUDIENCES,
  OFFICE_ADDRESSES,
  PEOPLE_INBOX,
  WILLO_INVITE_NOTE,
  emailAudienceCodes,
  emailAudienceOf,
  emailLogLabel,
  emailLogSubject,
  OFFICE_INBOX,
  OFFICE_INBOX_CODES,
  isOfficeInboxCode,
  officeInboxLabel,
  officeInboxSubject,
} from '../inbox';
import { TEMPLATES } from '../templates';

/** Every email in the register and beside it, with the recipients it pins. */
const EMAILS: { code: string; recipients?: readonly string[] }[] = [
  ...Object.values(TEMPLATES).filter((t) => t.channel === 'email'),
  ...Object.values(DOCUMENT_EMAILS),
].map((t) => ({ code: t.code, recipients: 'recipients' in t ? t.recipients : undefined }));

describe('office inbox (ADR-0058)', () => {
  it('lists exactly the emails whose recipients the register pins', () => {
    const pinned = EMAILS.filter((e) => e.recipients && e.recipients.length > 0).map((e) => e.code);
    expect([...OFFICE_INBOX_CODES].sort()).toEqual(pinned.sort());
  });

  it('pins only THC’s own mailboxes: every one of them is the office or payroll', () => {
    for (const e of EMAILS) {
      for (const to of e.recipients ?? []) {
        expect(OFFICE_ADDRESSES as readonly string[], `${e.code} → ${to}`).toContain(to);
      }
    }
  });

  it('keeps the emails to a person out — above all the ones carrying a set-up link', () => {
    for (const code of ['E1', 'E2', 'E2b', 'E3', 'E4', 'E11', 'D1', 'D2']) {
      expect(isOfficeInboxCode(code), code).toBe(false);
    }
  });

  it('covers E5–E9, which §8 addresses to the office and payroll', () => {
    for (const code of ['E5', 'E6', 'E7', 'E8', 'E9']) expect(isOfficeInboxCode(code)).toBe(true);
  });

  it('gives every code a label of its own', () => {
    const labels = OFFICE_INBOX.map((e) => e.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(officeInboxLabel('E8')).toBe('P45 requested');
    expect(officeInboxLabel('ZZ')).toBe('ZZ');
  });

  it('renders the subject the email went out with', () => {
    expect(officeInboxSubject('E8', { name: 'Ada Lovelace', employeeId: '1042' })).toBe(
      'P45 requested — Ada Lovelace, Employee ID 1042',
    );
    expect(
      officeInboxSubject('BG08', { periodStart: '21 Sep 2026', periodEnd: '27 Sep 2026' }),
    ).toBe('THC payroll — 21 Sep 2026 to 27 Sep 2026');
  });

  it('shows a value the row lacks as "…", never a raw placeholder', () => {
    expect(officeInboxSubject('E9', { name: 'Ada' })).toBe(
      'Criminal conviction declared — Ada, Employee ID …',
    );
    expect(officeInboxSubject('E9', null)).not.toMatch(/[{}]/);
  });

  it('renders nothing for a code that is not an office email', () => {
    expect(officeInboxSubject('E3', { link: 'https://x' })).toBeNull();
  });
});

describe('the email log: every audience (ADR-0086)', () => {
  const sendable = EMAILS.filter((e) => e.code !== 'E1');

  it('lists every email this system sends in exactly one audience, so a new one cannot be missed', () => {
    expect([...ALL_EMAIL_LOG_CODES].sort()).toEqual(sendable.map((e) => e.code).sort());
    expect(new Set(ALL_EMAIL_LOG_CODES).size).toBe(ALL_EMAIL_LOG_CODES.length);
  });

  it('leaves out only E1, which Willo sends itself, and says so', () => {
    expect(TEMPLATES.E1.sender).toBe('willo');
    expect(ALL_EMAIL_LOG_CODES).not.toContain('E1');
    expect(WILLO_INVITE_NOTE).toMatch(/E1.*sent by Willo, not by this system/);
  });

  it('puts an email with pinned recipients in the office view and the others elsewhere', () => {
    for (const e of EMAILS.filter((x) => x.code !== 'E1')) {
      const pinned = (e.recipients?.length ?? 0) > 0;
      expect(emailAudienceOf(e.code) === 'office', e.code).toBe(pinned);
    }
    for (const entry of [...PEOPLE_INBOX, ...CLIENT_INBOX]) {
      expect(EMAILS.find((e) => e.code === entry.code)?.recipients, entry.code).toBeUndefined();
    }
  });

  it('has the candidates’ and workers’ emails the office asked about', () => {
    expect(emailAudienceCodes('people')).toEqual(
      expect.arrayContaining(['E2', 'E2b', 'E3', 'E4', 'E11', 'E12', 'OC1', 'OC2']),
    );
    expect(emailAudienceCodes('clients')).toEqual(['D1', 'D2']);
  });

  it('only lists email-channel templates', () => {
    for (const code of ALL_EMAIL_LOG_CODES) {
      const t =
        (TEMPLATES as Record<string, { channel: string }>)[code] ?? DOCUMENT_EMAILS[code as 'D1'];
      expect(t.channel, code).toBe('email');
    }
  });

  it('gives each audience unique labels, and each code a label of its own', () => {
    const labels = EMAIL_AUDIENCES.flatMap((a) => a.entries.map((e) => e.label));
    expect(new Set(labels).size).toBe(labels.length);
    expect(emailLogLabel('E3')).toBe('Account activation');
    expect(emailLogLabel('OC1')).toBe('Video interview reminder');
    expect(emailLogLabel('ZZ')).toBe('ZZ');
  });

  it('renders each candidate and worker subject from the register', () => {
    expect(emailLogSubject('E2', { name: 'Sam' })).toBe(
      'Your application to The Hospitality Company',
    );
    expect(emailLogSubject('E3', { name: 'Sam' })).toBe('Activate your account');
    expect(emailLogSubject('E4', {})).toBe('Health & Safety Assessment — Unsuccessful');
    expect(emailLogSubject('E11', { app: 'Client Portal' })).toBe('Your THC Client Portal login');
    expect(emailLogSubject('E12', {})).toBe('Your documents are approved');
    expect(emailLogSubject('OC1', { variant: 'first' })).toBe(
      'Your video interview with The Hospitality Company',
    );
    expect(emailLogSubject('OC1', { variant: 'repeat' })).toBe(
      'Reminder: your video interview is still waiting',
    );
    expect(emailLogSubject('OC2', { variant: 'repeat' })).toBe('Reminder: set up your account');
    expect(emailLogSubject('OC2', { variant: 'second' })).toBe(
      'Set up your account with The Hospitality Company',
    );
  });

  it('renders a client’s timesheet subject, and the office’s as before', () => {
    expect(
      emailLogSubject('D1', { event: 'Gala', date: 'Friday 9 October 2026', poSuffix: ' (PO 7)' }),
    ).toBe('Allocation Timesheet — Gala, Friday 9 October 2026 (PO 7)');
    expect(emailLogSubject('E8', { name: 'Ada', employeeId: '1042' })).toBe(
      officeInboxSubject('E8', { name: 'Ada', employeeId: '1042' }),
    );
  });

  it('never prints a raw placeholder, and renders nothing for a code it does not list', () => {
    for (const code of ALL_EMAIL_LOG_CODES) {
      expect(emailLogSubject(code, null), code).not.toMatch(/[{}]/);
    }
    expect(emailLogSubject('E1', {})).toBeNull();
    expect(emailLogSubject('N5', {})).toBeNull();
  });

  it('never puts a payload link in a subject', () => {
    for (const code of ALL_EMAIL_LOG_CODES) {
      const subject = emailLogSubject(code, {
        link: 'https://x.example/activate/TOKEN',
        installLink: 'https://x.example/install',
        variant: 'first',
      });
      expect(subject, code).not.toMatch(/TOKEN|https?:/);
    }
  });
});

describe('office_email_log() payload whitelist (20261005120500)', () => {
  const sql = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../supabase/migrations/20261005120500_office_email_log.sql',
    ),
    'utf8',
  );
  const list = /e\.key = any \(array\[([^\]]*)\]/.exec(sql)?.[1] ?? '';
  const keys = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]!);

  it('lets through every value a logged subject is filled from', () => {
    const wanted = new Set<string>();
    for (const code of ALL_EMAIL_LOG_CODES) {
      const t = ((TEMPLATES as Record<string, { title: string }>)[code] ??
        DOCUMENT_EMAILS[code as 'D1']) as {
        title: string;
        variants?: Record<string, { title?: string }>;
      };
      for (const title of [t.title, ...Object.values(t.variants ?? {}).map((v) => v.title ?? '')]) {
        for (const m of title.matchAll(/\{(\w+)\}/g)) wanted.add(m[1]!);
      }
    }
    wanted.add('variant');
    for (const key of wanted) expect(keys, key).toContain(key);
  });

  it('never lets a link, an attachment path or a pay rate through', () => {
    expect(keys.length).toBeGreaterThan(5);
    for (const key of ['link', 'installLink', 'attachments', 'rate', 'token', 'password']) {
      expect(keys, key).not.toContain(key);
    }
  });
});
