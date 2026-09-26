import { describe, expect, it } from 'vitest';
import { DOCUMENT_EMAILS } from '../documents';
import {
  OFFICE_ADDRESSES,
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

describe('office inbox (ADR-0052)', () => {
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
