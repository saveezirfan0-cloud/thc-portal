import { describe, expect, it } from 'vitest';
import {
  actorName,
  auditStamp,
  describe as describeRow,
  parsePeriod,
  periodStart,
} from '../view-model';
import {
  actionLabel,
  entityHref,
  entityLabel,
  explainAccountError,
  validatePhone,
} from '../../_lib/accounts';

describe('activity rows', () => {
  it('a settings change reads from → to, without repeating its key', () => {
    expect(
      describeRow({ data: { key: 'booked_elsewhere_gap_minutes', from: 120, to: 150 } }),
    ).toEqual(['120 → 150']);
  });

  it('other data reads as Key: value pairs, ids left out', () => {
    expect(
      describeRow({ data: { reason: 'Late twice', staffId: 'x', fields: ['full_name', 'phone'] } }),
    ).toEqual(['Reason: Late twice', 'Fields: full_name, phone']);
  });

  it('a date-of-birth correction reads Date of birth: from → to (ADR-0070)', () => {
    expect(
      describeRow({
        data: {
          staffId: 'x',
          dob: { from: '1995-01-01', to: '1994-12-31' },
          reason: 'Passport shows 31 December',
          rtwCheck: 'queued',
        },
      }),
    ).toEqual([
      'Date of birth: 01.01.1995 → 31.12.1994',
      'Reason: Passport shows 31 December',
      'gov.uk check: queued',
    ]);
    expect(actionLabel('staff.dob_corrected')).toBe('Corrected date of birth');
  });

  it('no actor is the system; an actor with no profile left is a former user', () => {
    expect(actorName({ actor: null, actor_name: null })).toBe('System');
    expect(actorName({ actor: 'u', actor_name: null })).toBe('Former user');
    expect(actorName({ actor: 'u', actor_name: 'Gisela M.' })).toBe('Gisela M.');
  });

  it('known actions read as words, and a new one still reads', () => {
    expect(actionLabel('block_manual')).toBe('Blocked worker');
    expect(actionLabel('account.disabled')).toBe('Switched login off');
    expect(actionLabel('payroll.exported_twice')).toBe('Payroll exported twice');
  });

  it('links a record to its Back Office page where one exists', () => {
    expect(entityHref('staff', 'abc')).toBe('/staff/abc');
    expect(entityHref('event', 'abc')).toBe('/events/abc');
    expect(entityHref('settings', null)).toBe('/settings');
    expect(entityHref('booking', 'abc')).toBeNull();
    expect(entityLabel('compliance_docs')).toBe('Documents');
  });

  // Release audit 14.10.2026 (D-M1 and the /activity minors).
  it('audit stamps are UK time, dd.mm.yyyy HH:mm, in summer and winter (§1.8)', () => {
    expect(auditStamp('2026-07-01T13:05:00Z')).toBe('01.07.2026 14:05');
    expect(auditStamp('2026-01-15T09:30:00Z')).toBe('15.01.2026 09:30');
    expect(auditStamp('2026-10-13T23:30:00Z')).toBe('14.10.2026 00:30');
    expect(auditStamp('2026-07-01T13:05:00Z', '12h')).toBe('01.07.2026 2:05 pm');
  });

  it('money reads as pounds, policies as Yes/No, and nothing is cut short', () => {
    expect(
      describeRow({
        data: {
          chargeRate: { from: 20, to: 21.5 },
          role: 'Waiting Staff',
          roleId: 'r1',
          clientId: 'c',
        },
      }),
    ).toEqual(['Charge rate: £20.00 → £21.50', 'Role: Waiting Staff']);
    expect(describeRow({ data: { paysBreaks: { from: true, to: false } } })).toEqual([
      'Pays breaks: Yes → No',
    ]);
    const long = 'x'.repeat(300);
    expect(describeRow({ data: { notes: { from: null, to: long } } })).toEqual([
      `Notes: — → ${long}`,
    ]);
  });

  it('an instant in the data reads as a UK stamp, not ISO UTC', () => {
    expect(describeRow({ data: { uploadedAt: '2026-10-14T11:48:24.591076+00:00' } })).toEqual([
      'Uploaded at: 14.10.2026 12:48',
    ]);
  });

  it('an object reads as words, never raw JSON', () => {
    const [line] = describeRow({ data: { detail: { reason: 'Late', count: 2 } } });
    expect(line).toBe('Detail: Reason: Late, Count: 2');
    expect(line).not.toContain('{');
  });

  it('every action the Back Office now records has words, and venues and roles link', () => {
    for (const action of [
      'client.created',
      'client.updated',
      'client.archived',
      'client.restored',
      'client.rate_added',
      'client.rate_changed',
      'client.rate_removed',
      'staff.pay_rate_set',
      'staff.pay_rate_cleared',
      'staff.role_added',
      'staff.role_removed',
      'client_qualification.granted',
      'client_qualification.revoked',
      'feedback.added',
      'feedback.edited',
      'feedback.deleted',
      'feedback.read',
      'venue.created',
      'venue.updated',
      'venue.deleted',
      'event.created',
      'event.duplicated',
      'event.updated',
      'event.role_added',
      'event.role_changed',
      'event.role_removed',
    ]) {
      // A labelled action is not just its code with the dots taken out.
      expect(actionLabel(action)).not.toBe(
        action.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      );
    }
    expect(actionLabel('client.rate_changed')).toBe('Changed the rate card');
    expect(entityLabel('venue')).toBe('Venues');
    expect(entityHref('venue', 'v1')).toBe('/venues');
    expect(entityHref('role', 'r1')).toBe('/roles');
  });

  it('periods default to 30 days and count back from now', () => {
    expect(parsePeriod('nonsense')).toBe('30d');
    const now = new Date('2026-09-25T12:00:00Z');
    expect(periodStart('24h', now)).toBe('2026-09-24T12:00:00.000Z');
    expect(periodStart('all', now)).toBeNull();
  });
});

describe('account rules', () => {
  it('accepts UK and international phone shapes and refuses words', () => {
    expect(validatePhone('')).toBeNull();
    expect(validatePhone('+44 7700 900123')).toBeNull();
    expect(validatePhone('(020) 7946-0958')).toBeNull();
    expect(validatePhone('call me')).not.toBeNull();
  });

  it('turns the database’s refusal codes into words, whatever follows the code', () => {
    expect(explainAccountError('last_admin')).toMatch(/last working Back Office login/);
    expect(explainAccountError('account_has_other_role: detail')).toMatch(
      /different kind of login/,
    );
    expect(explainAccountError('something new')).toMatch(/did not save/);
  });
});

describe('an emailed invitation or activation link in the log (release audit m7)', () => {
  it('says the email was queued, never the raw outbox key', () => {
    const lines = describeRow({
      data: {
        outboxKey: 'E11:invite:3f1d2b7c-9a01-4d6e-9a43-0b5c3e0e1c0a:1',
        n: 1,
        email: 'a@b.example',
      },
    });
    expect(lines).toEqual(['Email queued', 'Send no.: 1', 'Email: a@b.example']);
    expect(lines.join(' ')).not.toContain('E11:');
  });
});
