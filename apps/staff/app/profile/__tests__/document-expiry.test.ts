import { describe, expect, it } from 'vitest';
import { EXPIRING_WITHIN_DAYS } from '@thc/domain';
import { data, doc, TODAY } from '../../documents/__tests__/fixtures';
import { expiringDocument, expiryLine } from '../document-expiry';

/**
 * The Profile tab's Documents row: "Passport expires in 12 days".
 *
 * The window is §4.2's first reminder rung, "1 month before expiry" —
 * `EXPIRING_WITHIN_DAYS` in @thc/domain, the same number the Documents
 * screen calls "expiring" with. Today is 23.09.2026 (the fixtures').
 */
const inDays = (n: number) => {
  const at = new Date(`${TODAY}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + n);
  return at.toISOString().slice(0, 10);
};

describe('expiringDocument', () => {
  it('uses the first rung of the §4.2 ladder: one month, i.e. 30 days', () => {
    expect(EXPIRING_WITHIN_DAYS).toBe(30);
    expect(expiringDocument(data({ documents: [doc({ expiresOn: inDays(30) })] }))).toMatchObject({
      label: 'Passport',
      days: 30,
    });
    expect(expiringDocument(data({ documents: [doc({ expiresOn: inDays(31) })] }))).toBeNull();
  });

  it('says nothing for a document far from expiry, or one with no expiry', () => {
    expect(expiringDocument(data())).toBeNull();
    expect(expiringDocument(data({ documents: [doc({ expiresOn: null })] }))).toBeNull();
  });

  it('an expired document is lock case 1, not "expiring"', () => {
    expect(expiringDocument(data({ documents: [doc({ expiresOn: TODAY })] }))).toBeNull();
    expect(expiringDocument(data({ documents: [doc({ expiresOn: inDays(-3) })] }))).toBeNull();
  });

  it('picks the soonest of several', () => {
    const found = expiringDocument(
      data({
        documents: [
          doc({ expiresOn: inDays(20) }),
          doc({
            id: 'visa',
            docType: 'visa_document',
            label: 'Visa document',
            expiresOn: inDays(9),
          }),
        ],
      }),
    );
    expect(found).toMatchObject({ docType: 'visa_document', days: 9 });
  });

  it('counts only the verified row expiry is measured off', () => {
    expect(
      expiringDocument(
        data({ documents: [doc({ expiresOn: inDays(5), isCountedVerified: false })] }),
      ),
    ).toBeNull();
  });

  it('leaves out a type whose replacement is already with the office', () => {
    const old = doc({ id: 'old', expiresOn: inDays(5), isCurrent: false });
    const replacement = doc({
      id: 'new',
      reviewStatus: 'pending',
      isCurrent: true,
      isCountedVerified: false,
      expiresOn: inDays(3650),
    });
    expect(expiringDocument(data({ documents: [old, replacement] }))).toBeNull();
  });

  it('still warns when the replacement was rejected — the worker has to act', () => {
    const old = doc({ id: 'old', expiresOn: inDays(5), isCurrent: false });
    const rejected = doc({
      id: 'new',
      reviewStatus: 'rejected',
      isCurrent: true,
      isCountedVerified: false,
      rejectionReason: 'Blurred',
    });
    expect(expiringDocument(data({ documents: [old, rejected] }))).toMatchObject({ days: 5 });
  });

  it('names the share code by what expires: the right to work', () => {
    const found = expiringDocument(
      data({
        documents: [
          doc({
            docType: 'share_code_report',
            label: 'Right to work · share code',
            expiresOn: inDays(14),
          }),
        ],
      }),
    );
    expect(found?.label).toBe('Right to work');
  });
});

describe('expiryLine', () => {
  it('reads as the row sub-line', () => {
    expect(expiryLine({ label: 'Passport', days: 12 })).toBe('Passport expires in 12 days');
    expect(expiryLine({ label: 'Passport', days: 1 })).toBe('Passport expires tomorrow');
  });
});
