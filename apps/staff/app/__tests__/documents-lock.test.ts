import { describe, expect, it } from 'vitest';
import { documentsNotice } from '../_components/DocumentsLock';

/**
 * Lock case 1's COPY — §4.3, §10.7, §10.1.
 *
 * `appLock()` and its four cases are tested in
 * `app/profile/__tests__/lock.test.ts` (#42) and are not retested here.
 * What is tested here is the one decision that rule leaves open: it sends
 * everything that is not a manual block to the documents case, including a
 * block whose `block_kind` was never recorded — and on that screen the
 * difference between "update your document" and "contact the office" is
 * the difference between a worker fixing this today and a worker uploading
 * a passport that cannot unblock them.
 */
describe('documents lock copy', () => {
  it('names the actual documents when compliance_blockers() can', () => {
    const notice = documentsNotice(['document_expired:passport'], 'auto_document', false);
    expect(notice.tone).toBe('coral');
    expect(notice.headline).toBe('You have been blocked — update your document.');
    expect(notice.detail).toContain('1 expired document');
  });

  it('is factual, never punitive, for a conviction under review (§10.7)', () => {
    const notice = documentsNotice(['conviction_unreviewed'], 'conviction_review', false);
    expect(notice.tone).toBe('cyan');
    expect(notice.headline).toBe('Thanks for telling us.');
    // §10.7 step 5, word for word (typographic apostrophes).
    expect(`${notice.headline} ${notice.detail}`).toBe(
      'Thanks for telling us. We’ve paused your upcoming shifts while the office reviews your ' +
        'declaration, and we’ll be in touch. If you need to speak to someone, contact us at: ' +
        'admin@thehospitalitycompany.co.uk.',
    );
    // The declaration itself is never read back to the worker.
    expect(notice.detail).not.toMatch(/conviction_unreviewed/);
  });

  it('keeps the §10.7 copy when an expired document is on the record too', () => {
    const notice = documentsNotice(
      ['conviction_unreviewed', 'document_expired:passport'],
      'conviction_review',
      false,
    );
    expect(notice.headline).toBe('Thanks for telling us.');
    expect(notice.detail).not.toMatch(/expired/);
  });

  it('does not tell a worker to upload something when nothing is uploadable', () => {
    // A block with no `block_kind` recorded: #42's rule reads anything not
    // 'manual' as the documents case, so it lands here with no blocker to
    // name. Sending them to Documents would waste their time.
    const notice = documentsNotice([], null, false);
    expect(notice.headline).toBe('Your account is blocked.');
    expect(notice.detail).toContain('nothing for you to upload');
    expect(notice.detail).toContain('admin@thehospitalitycompany.co.uk');
  });

  it('an onboarding worker is waiting, not blocked, and is told so', () => {
    const notice = documentsNotice([], null, true);
    expect(notice.tone).toBe('cyan');
    expect(notice.headline).toBe('Your documents are with the office.');
    expect(notice.detail).not.toMatch(/blocked/i);
  });
});
