import { describe, expect, it } from 'vitest';
import { UK_ZONE, formatDateTimeIn } from '@thc/domain';
import { EMAIL_AUDIENCES } from '@thc/notifications';
import {
  AUDIENCES,
  DEFAULT_PERIOD,
  inboxHref,
  parseAudience,
  parsePeriod,
  parseSearch,
  parseStatus,
  periodStart,
} from '../filters';
import type { InboxRow } from '../view-model';
import {
  NO_RECORD,
  about,
  parseType,
  phaseLabel,
  present,
  profileHref,
  statusDetail,
  statusOf,
} from '../view-model';

/** /inbox (ADR-0058): office emails, read from notification_outbox. */

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
    const current = {
      audience: 'office' as const,
      q: null,
      type: 'E8',
      status: null,
      period: DEFAULT_PERIOD,
      before: 120,
    };
    expect(inboxHref(current, {})).toBe('/inbox?type=E8');
    expect(inboxHref(current, { status: 'failed' })).toBe('/inbox?type=E8&status=failed');
    expect(inboxHref(current, { before: '80' })).toBe('/inbox?type=E8&before=80');
    expect(inboxHref({ ...current, type: null }, { period: '7d' })).toBe('/inbox?period=7d');
    expect(inboxHref({ ...current, type: null }, {})).toBe('/inbox');
  });
});

/** ADR-0086: candidates, workers and clients. */

const PERSON = 'dddddddd-0000-4000-8000-0000000000aa';

const personRow = (over: Partial<InboxRow> = {}): InboxRow =>
  row({
    id: 11,
    key: `E3:staff:${PERSON}:1759999999`,
    template: 'E3',
    recipient_emails: ['sam.candidate@example.com'],
    payload: { name: 'Sam' },
    staff_id: PERSON,
    recipient_name: 'Sam Candidate',
    staff_status: 'documents',
    staff_removed: false,
    ...over,
  });

describe('audiences', () => {
  it('match the register: same values, same labels', () => {
    expect(AUDIENCES.map((a) => [a.value, a.label])).toEqual(
      EMAIL_AUDIENCES.map((a) => [a.value, a.label]),
    );
  });

  it('default to the office and ignore anything else', () => {
    expect(parseAudience('people')).toBe('people');
    expect(parseAudience('clients')).toBe('clients');
    expect(parseAudience('everyone')).toBe('office');
    expect(parseAudience(undefined)).toBe('office');
  });

  it('read a type in the audience on screen only', () => {
    expect(parseType('E3', 'people')).toBe('E3');
    expect(parseType('OC1', 'people')).toBe('OC1');
    expect(parseType('E3')).toBeNull();
    expect(parseType('E3', 'office')).toBeNull();
    expect(parseType('E9', 'people')).toBeNull();
    expect(parseType('D1', 'clients')).toBe('D1');
  });

  it('trim and cap the search, and treat blank as none', () => {
    expect(parseSearch('  sam@example.com ')).toBe('sam@example.com');
    expect(parseSearch('   ')).toBeNull();
    expect(parseSearch(undefined)).toBeNull();
    expect(parseSearch('x'.repeat(500))).toHaveLength(100);
  });

  it('are in the URL, with the default left out, and a change of audience drops the type', () => {
    const current = {
      audience: 'office' as const,
      q: null,
      type: 'E8',
      status: null,
      period: DEFAULT_PERIOD,
      before: null,
    };
    expect(inboxHref(current, { who: 'people' })).toBe('/inbox?who=people');
    expect(inboxHref({ ...current, audience: 'people', type: 'E3' }, {})).toBe(
      '/inbox?who=people&type=E3',
    );
    expect(inboxHref({ ...current, audience: 'people', type: 'E3' }, { who: 'office' })).toBe(
      '/inbox',
    );
    expect(inboxHref({ ...current, audience: 'people', type: 'E3' }, { who: 'clients' })).toBe(
      '/inbox?who=clients',
    );
    expect(inboxHref(current, { q: 'sam@example.com' })).toBe('/inbox?q=sam%40example.com&type=E8');
    expect(inboxHref({ ...current, q: 'sam' }, { status: 'failed' })).toBe(
      '/inbox?q=sam&type=E8&status=failed',
    );
  });
});

describe('a candidate’s or worker’s email', () => {
  it('links the candidate to the onboarding profile and a worker to the directory', () => {
    expect(profileHref(PERSON, 'documents')).toBe(`/onboarding/${PERSON}`);
    expect(profileHref(PERSON, 'rejected')).toBe(`/onboarding/${PERSON}`);
    expect(profileHref(PERSON, 'compliant')).toBe(`/staff/${PERSON}`);
    expect(profileHref(PERSON, 'documents', true)).toBe(`/staff/${PERSON}`);
    expect(about(personRow()).href).toBe(`/onboarding/${PERSON}`);
    expect(about(personRow({ staff_status: 'compliant' })).href).toBe(`/staff/${PERSON}`);
  });

  it('names the person the address resolved to', () => {
    expect(about(personRow())).toMatchObject({ primary: 'Sam Candidate' });
  });

  it('says so when no record has the address, rather than implying it was sent to someone', () => {
    const a = about(
      personRow({
        key: 'E2:application:6a6a6a6a-0000-4000-8000-000000000009',
        template: 'E2',
        staff_id: null,
        recipient_name: null,
        staff_status: null,
      }),
    );
    expect(a).toEqual({ primary: 'Sam', secondary: NO_RECORD, href: null });
    expect(
      about(personRow({ staff_id: null, recipient_name: null, payload: {}, key: 'OC1:x' })),
    ).toEqual({ primary: '—', secondary: NO_RECORD, href: null });
  });

  it('renders the register subject and the address, never the link', () => {
    const entry = present(
      personRow({
        template: 'E3',
        // Nothing in the payload reaches the page but the whitelisted values;
        // even if a link did arrive, no column renders it.
        payload: { name: 'Sam', link: 'https://x/activate/secret', installLink: 'https://x/i' },
        sent_at: '2026-10-05T13:31:00Z',
      }),
      uk,
    );
    expect(entry).toMatchObject({
      code: 'E3',
      type: 'Account activation',
      subject: 'Activate your account',
      to: 'sam.candidate@example.com',
      status: 'sent',
    });
    expect(JSON.stringify(entry)).not.toMatch(/secret|activate\/|https/);
  });

  it('picks the reminder variant’s own subject', () => {
    expect(
      present(personRow({ template: 'OC1', payload: { name: 'Sam', variant: 'repeat' } }), uk)
        .subject,
    ).toBe('Reminder: your video interview is still waiting');
    expect(
      present(personRow({ template: 'OC1', payload: { name: 'Sam', variant: 'first' } }), uk)
        .subject,
    ).toBe('Your video interview with The Hospitality Company');
  });

  it('renders the login invitation’s subject from its app', () => {
    expect(
      present(personRow({ template: 'E11', payload: { name: 'Pat', app: 'Back Office' } }), uk)
        .subject,
    ).toBe('Your THC Back Office login');
  });

  it('shows no address for a removed profile', () => {
    const entry = present(
      personRow({
        recipient_emails: null,
        recipient_name: 'Deleted account #10042',
        staff_removed: true,
      }),
      uk,
    );
    expect(entry.to).toBe('—');
    expect(entry.about.primary).toBe('Deleted account #10042');
  });

  it('names the event for a client’s timesheet', () => {
    const a = about(
      row({
        key: 'D1:document:1',
        template: 'D1',
        recipient_emails: ['events@client.example'],
        payload: {
          event: 'Gala Dinner',
          client: 'Mandarin Oriental',
          date: 'Friday 9 October 2026',
        },
      }),
    );
    expect(a).toEqual({
      primary: 'Gala Dinner · Friday 9 October 2026',
      secondary: 'Mandarin Oriental',
      href: null,
    });
  });
});

describe('the pill', () => {
  it('reads Queued, Held, Retrying, Sent or Failed', () => {
    expect(phaseLabel(row())).toBe('Queued');
    expect(phaseLabel(row({ error: 'not configured: RESEND_API_KEY is not set' }))).toBe('Held');
    expect(phaseLabel(row({ error: 'Resend answered 500', attempts: 1 }))).toBe('Retrying');
    expect(phaseLabel(row({ sent_at: '2026-10-05T13:31:00Z' }))).toBe('Sent');
    expect(phaseLabel(row({ failed_at: '2026-10-05T14:00:00Z', error: 'x' }))).toBe('Failed');
  });
});
