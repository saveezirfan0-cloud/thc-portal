import { describe, expect, it } from 'vitest';
import { documentsNotice } from '../_components/DocumentsLock';
import { HOME_OFFICE_RENEWING, describeBlockers, onlyHomeOfficeBlockers } from '../profile/lock';

/**
 * A worker blocked because their Home Office check result ran out (ADR-0182)
 * is never told to upload or update anything: only an employer can ask the
 * Home Office, so the office renews it.
 */
describe('the lock when the Home Office check has run out', () => {
  const expired = ['document_expired:home_office_check_result'];

  it('says the office is renewing it — no upload, no "update your document"', () => {
    expect(onlyHomeOfficeBlockers(expired)).toBe(true);
    expect(describeBlockers(expired)).toBe(HOME_OFFICE_RENEWING);
    expect(HOME_OFFICE_RENEWING).toMatch(
      /^Your Home Office check has run out — the office is renewing it\./,
    );
    const notice = documentsNotice(expired, 'auto_document', false);
    expect(notice.headline).toBe('Your shifts are paused.');
    expect(notice.headline).not.toMatch(/update/i);
    expect(notice.detail).toContain('the office is renewing it');
    expect(notice.detail).not.toMatch(/Upload a valid document/);
  });

  it('a renewal waiting for review reads the same', () => {
    expect(describeBlockers(['document_unverified:home_office_check_result'])).toBe(
      HOME_OFFICE_RENEWING,
    );
  });

  it('beside a document of their own, counts only that one and says the office renews the check', () => {
    const text = describeBlockers([...expired, 'document_expired:passport']);
    expect(text).toMatch(/^1 expired document\. Upload a valid document/);
    expect(text).toMatch(/The office is renewing your Home Office check\.$/);
    expect(onlyHomeOfficeBlockers([...expired, 'document_expired:passport'])).toBe(false);
    expect(
      documentsNotice([...expired, 'document_expired:passport'], 'auto_document', false).headline,
    ).toBe('You have been blocked — update your document.');
  });
});
