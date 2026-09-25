import { describe, expect, it } from 'vitest';
import { UK_ZONE, formatDateTimeIn } from '@thc/domain';
import { DEFAULT_PERIOD, inboxHref, parsePeriod, parseStatus, periodStart } from '../filters';
import type { InboxRow } from '../view-model';
import { about, parseType, present, statusDetail, statusOf } from '../view-model';

/** /inbox (ADR-0038): office emails, read from notification_outbox. */

const STAFF = 'dddddddd-0000-4000-8000-000000000001';

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  id: 7,
  key: `E8:staff:${STAFF}:1759999999`,
  template: 'E8',
  recipient_emails: ['admin@thehospitalitycompany.co.uk'],
  payload: { name: 'Ada Lovelace', employeeId: '1042', reason: 'Moving away' },
  queued_at: '2026-10-05T13:30:00Z',
  send_after: '2026-10-05T13:30:00Z',
  sent_at: null,
  failed_at: null,
  error: null,
  attempts: 0,
  ...over,
});

const uk = (d: Date) => formatDateTimeIn(d, UK_ZONE);

describe('status', () => {
  it('is queued until sent or failed, and failed wins', () => {
    expect(statusOf(row())).toBe('queued');
    expect(statusOf(row({ sent_at: '2026-10-05T13:31:00Z' }))).toBe('sent');
    expect(statusOf(row({ failed_at: '2026-10-05T14:00:00Z' }))).toBe('failed');
    expect(statusOf(row({ sent_at: 'x', failed_at: 'y' }))).toBe('failed');
  });

  it('says why a failure failed', () => {
    expect(
      statusDetail(row({ failed_at: '2026-10-05T14:00:00Z', error: 'Resend answered 422' })),
    ).toBe('Resend answered 422');
    expect(statusDetail(row({ failed_at: '2026-10-05T14:00:00Z', error: null }))).toMatch(
      /no reason/,
    );
  });

  it('tells a held email from one being retried', () => {
    expect(
      statusDetail(row({ attempts: 0, error: 'not configured: RESEND_API_KEY is not set' })),
    ).toMatch(/^Held — not configured/);
    expect(statusDetail(row({ attempts: 2, error: 'Resend answered 500' }))).toBe(
      'Retrying after attempt 2 — Resend answered 500',
    );
    expect(statusDetail(row())).toBeNull();
    expect(statusDetail(row({ sent_at: '2026-10-05T13:31:00Z' }))).toBeNull();
  });
});

describe('about', () => {
  it('names the worker, their Employee ID, and links their profile from the key', () => {
    expect(about(row())).toEqual({
      primary: 'Ada Lovelace',
      secondary: 'Employee ID 1042',
      href: `/staff/${STAFF}`,
    });
  });

  it('adds the event, role and date for the self-cancel email', () => {
    const a = about(
      row({
        key: 'E10:booking:0a0a0a0a-0000-4000-8000-000000000001',
        template: 'E10',
        payload: {
          name: 'Ada Lovelace',
          employeeId: '1042',
          event: 'Gala Dinner',
          role: 'Bar Staff',
          date: 'Fri 09 Oct 2026',
        },
      }),
    );
    expect(a).toEqual({
      primary: 'Ada Lovelace',
      secondary: 'Employee ID 1042 · Gala Dinner · Bar Staff · Fri 09 Oct 2026',
      href: null,
    });
  });

  it('names the week for the payroll email', () => {
    expect(
      about(
        row({
          key: 'BG08:2026-09-28',
          template: 'BG08',
          payload: { periodStart: '21 Sep 2026', periodEnd: '27 Sep 2026' },
        }),
      ),
    ).toEqual({ primary: 'Week 21 Sep 2026 – 27 Sep 2026', secondary: null, href: null });
  });

  it('shows a dash rather than nothing', () => {
    expect(about(row({ key: 'E5:x', payload: null })).primary).toBe('—');
  });
});

describe('present', () => {
  it('renders the subject from the register and stamps in UK time', () => {
    const entry = present(
      row({ sent_at: '2026-10-05T13:31:00Z', attempts: 1 }),
      (d) => `UK ${d.toISOString()}`,
    );
    expect(entry).toMatchObject({
      type: 'P45 requested',
      subject: 'P45 requested — Ada Lovelace, Employee ID 1042',
      to: 'admin@thehospitalitycompany.co.uk',
      queuedAt: 'UK 2026-10-05T13:30:00.000Z',
      status: 'sent',
      tone: 'green',
      settledAt: 'Sent UK 2026-10-05T13:31:00.000Z',
      detail: null,
    });
  });

  it('shows the queue stamp as UK wall-clock time, one hour ahead in BST', () => {
    expect(present(row(), uk).queuedAt).toBe('05 Oct, 14:30');
  });

  it('marks a failure coral with its reason', () => {
    const entry = present(
      row({ failed_at: '2026-10-05T14:00:00Z', error: 'Resend answered 422: invalid to' }),
      uk,
    );
    expect(entry).toMatchObject({
      status: 'failed',
      tone: 'coral',
      detail: 'Resend answered 422: invalid to',
    });
    expect(entry.settledAt).toBe('Failed 05 Oct, 15:00');
  });
});

describe('filters', () => {
  it('accepts only office email codes as a type', () => {
    expect(parseType('E9')).toBe('E9');
    expect(parseType('BG08')).toBe('BG08');
    expect(parseType('E3')).toBeNull();
    expect(parseType('E11')).toBeNull();
    expect(parseType(undefined)).toBeNull();
  });

  it('parses status and period, defaulting the period', () => {
    expect(parseStatus('failed')).toBe('failed');
    expect(parseStatus('bogus')).toBeNull();
    expect(parsePeriod('7d')).toBe('7d');
    expect(parsePeriod('bogus')).toBe(DEFAULT_PERIOD);
  });

  it('turns a period into its earliest instant', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    expect(periodStart('24h', now)).toBe('2026-10-04T12:00:00.000Z');
    expect(periodStart('7d', now)).toBe('2026-09-28T12:00:00.000Z');
    expect(periodStart('all', now)).toBeNull();
  });

  it('builds URLs that drop the default period and reset paging on a filter change', () => {
    const current = { type: 'E8', status: null, period: DEFAULT_PERIOD, before: 120 };
    expect(inboxHref(current, {})).toBe('/inbox?type=E8');
    expect(inboxHref(current, { status: 'failed' })).toBe('/inbox?type=E8&status=failed');
    expect(inboxHref(current, { before: '80' })).toBe('/inbox?type=E8&before=80');
    expect(inboxHref({ ...current, type: null }, { period: '7d' })).toBe('/inbox?period=7d');
    expect(inboxHref({ ...current, type: null }, {})).toBe('/inbox');
  });
});
