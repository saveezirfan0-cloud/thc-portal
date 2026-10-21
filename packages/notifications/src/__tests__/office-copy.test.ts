import { describe, expect, it, vi } from 'vitest';
import type { DrainConfig, DrainPorts } from '../drain';
import { drainRow } from '../drain';
import { documentMessageFor } from '../documents';
import {
  OFFICE_COPY_MAX,
  OFFICE_COPY_SETTING_KEY,
  OFFICE_COPY_TEMPLATES,
  isOfficeCopyAddress,
  normaliseAddresses,
  officeCopyFor,
  parseBcc,
  readOfficeCopy,
} from '../office-copy';
import type { OutboxRow } from '../outbox';
import { UnsendableRow } from '../outbox';
import { RESEND_ENDPOINT, buildResendRequest } from '../resend';

/**
 * ADR-0179: the office's hidden copy of every Allocation Timesheet (D1) and
 * Completed Allocation Timesheet (D2) — the setting's reading, the outbox
 * row's `payload.bcc`, the Resend payload and the drain between them.
 */

const CONFIGURED: DrainConfig = { resendApiKey: 're_test_key', vapid: null, missing: [] };

const sheet = (template: 'D1' | 'D2', over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 9,
  key: `${template}:auto:ev-1`,
  channel: 'email',
  template,
  recipient_staff_id: null,
  recipient_emails: ['events@client.example', 'Ops@Client.example'],
  payload: {
    event: 'Product Launch',
    date: '26/09/2026',
    staffCount: '12',
    poSuffix: '',
    attachments: JSON.stringify([
      { bucket: 'timesheets', path: 'allocation/abc.pdf', filename: 'Allocation.pdf' },
    ]),
  },
  attempts: 1,
  ...over,
});

const withBcc = (template: 'D1' | 'D2', bcc: unknown): OutboxRow => {
  const row = sheet(template);
  // The database hands the drain jsonb, so a list arrives as a list.
  return { ...row, payload: { ...row.payload, bcc: bcc as string } };
};

function ports() {
  const sent: { url: string; body: string }[] = [];
  const p: DrainPorts = {
    http: vi.fn(async (req) => {
      sent.push({ url: req.url, body: req.body as string });
      return { status: 200, text: async () => '{"id":"x"}' };
    }),
    subscriptionsFor: vi.fn(async () => []),
    deleteSubscription: vi.fn(async () => undefined),
    download: vi.fn(async () => new TextEncoder().encode('%PDF-1.7 fake')),
    log: () => undefined,
  };
  return { p, sent };
}

describe('the setting', () => {
  it('is one row, up to five addresses, for the two timesheets only', () => {
    expect(OFFICE_COPY_SETTING_KEY).toBe('document_office_copy');
    expect(OFFICE_COPY_MAX).toBe(5);
    expect([...OFFICE_COPY_TEMPLATES]).toEqual(['D1', 'D2']);
  });

  it('reads { emails } trimmed, lower-cased and without repeats; anything else is off', () => {
    expect(
      readOfficeCopy({ emails: [' Sam@THC.example ', 'sam@thc.example', '', 'b@x.co'] }),
    ).toEqual(['sam@thc.example', 'b@x.co']);
    expect(readOfficeCopy({ emails: [] })).toEqual([]);
    expect(readOfficeCopy(null)).toEqual([]);
    expect(readOfficeCopy(['sam@thc.example'])).toEqual([]);
    expect(readOfficeCopy({ emails: 'sam@thc.example' })).toEqual([]);
    expect(readOfficeCopy({ emails: [1, 'a@b.co'] })).toEqual(['a@b.co']);
  });

  it('leaves out anyone already in To, whatever the case', () => {
    expect(
      officeCopyFor({ emails: ['sam@thc.example', 'ops@client.example'] }, [
        'events@client.example',
        'Ops@Client.example',
      ]),
    ).toEqual(['sam@thc.example']);
    expect(officeCopyFor({ emails: ['ops@client.example'] }, ['ops@client.example'])).toEqual([]);
  });

  it('accepts an address the database accepts', () => {
    expect(isOfficeCopyAddress('sam@thehospitalitycompany.co.uk')).toBe(true);
    expect(isOfficeCopyAddress('sam@thc')).toBe(false);
    expect(isOfficeCopyAddress('s am@thc.co')).toBe(false);
    expect(isOfficeCopyAddress('a@b.co,c@d.co')).toBe(false);
    expect(isOfficeCopyAddress(`${'a'.repeat(250)}@b.co`)).toBe(false);
    expect(normaliseAddresses(['A@B.co', 'a@b.co '])).toEqual(['a@b.co']);
  });
});

describe('Resend payload', () => {
  const base = { from: 'A <a@b.c>', to: ['x@y.z'], subject: 's', text: 't' };

  it('sends bcc only when there is someone to copy', () => {
    const copied = JSON.parse(
      buildResendRequest({ ...base, bcc: ['sam@thc.example'] }, 'k', 'D1:auto:1').body,
    );
    expect(copied.bcc).toEqual(['sam@thc.example']);
    expect(copied.to).toEqual(['x@y.z']);
    expect(copied).not.toHaveProperty('cc');
    expect(
      JSON.parse(buildResendRequest({ ...base, bcc: [] }, 'k', 'D1:auto:1').body),
    ).not.toHaveProperty('bcc');
    expect(JSON.parse(buildResendRequest(base, 'k', 'D1:auto:1').body)).not.toHaveProperty('bcc');
  });
});

describe('the outbox row', () => {
  it.each(OFFICE_COPY_TEMPLATES)('%s renders payload.bcc as the hidden copy', (code) => {
    const message = documentMessageFor(withBcc(code, ['sam@thc.example', 'b@x.co']));
    expect(message.bcc).toEqual(['sam@thc.example', 'b@x.co']);
    expect(message.to).toEqual(['events@client.example', 'Ops@Client.example']);
  });

  it('takes the database text form too', () => {
    expect(documentMessageFor(withBcc('D1', '["sam@thc.example"]')).bcc).toEqual([
      'sam@thc.example',
    ]);
  });

  it('drops anyone already in To, so nobody gets it twice', () => {
    const message = documentMessageFor(withBcc('D1', ['ops@client.example', 'sam@thc.example']));
    expect(message.bcc).toEqual(['sam@thc.example']);
    expect(documentMessageFor(withBcc('D1', ['events@client.example'])).bcc).toBeUndefined();
  });

  it('has no bcc when the row carries none', () => {
    expect(documentMessageFor(sheet('D1')).bcc).toBeUndefined();
    expect(documentMessageFor(withBcc('D2', [])).bcc).toBeUndefined();
  });

  it('never prints the copy addresses in the email itself', () => {
    const message = documentMessageFor(withBcc('D1', ['sam@thc.example']));
    expect(message.subject).not.toContain('sam@');
    expect(message.body).not.toContain('sam@');
    expect(message.html).not.toContain('sam@');
  });

  it('fails a row whose bcc is not a list of addresses', () => {
    expect(() => documentMessageFor(withBcc('D1', 'not json'))).toThrow(UnsendableRow);
    expect(() => documentMessageFor(withBcc('D1', ['nobody']))).toThrow(UnsendableRow);
    expect(() => documentMessageFor(withBcc('D1', { emails: [] }))).toThrow(UnsendableRow);
    expect(() => parseBcc([1], 'D2')).toThrow(UnsendableRow);
  });
});

describe('the drain', () => {
  it('passes the copy through to Resend as bcc, never as to or cc', async () => {
    const { p, sent } = ports();
    const s = await drainRow(
      withBcc('D1', ['sam@thc.example', 'events@client.example']),
      CONFIGURED,
      null,
      p,
    );
    expect(s.verdict).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(RESEND_ENDPOINT);
    const body = JSON.parse(sent[0]!.body);
    expect(body.to).toEqual(['events@client.example', 'Ops@Client.example']);
    expect(body.bcc).toEqual(['sam@thc.example']);
    expect(body).not.toHaveProperty('cc');
    expect(body.from).toContain('timesheets@');
  });

  it('D2 the same way', async () => {
    const { p, sent } = ports();
    await drainRow(withBcc('D2', ['sam@thc.example']), CONFIGURED, null, p);
    expect(JSON.parse(sent[0]!.body).bcc).toEqual(['sam@thc.example']);
  });

  it('sends no bcc at all when the setting was empty', async () => {
    const { p, sent } = ports();
    await drainRow(sheet('D1'), CONFIGURED, null, p);
    expect(JSON.parse(sent[0]!.body)).not.toHaveProperty('bcc');
  });
});
