import Link from 'next/link';
import { Pill } from '@thc/ui';
import { docIcon } from '../state';
import type { UploadedDoc } from '../state';

/** Where the wizard's own completion-letter screen lives. */
export const ONBOARDING_COMPLETION_HREF = '/onboarding/completion-letter';

/**
 * The optional completion letter row, for a Student-visa candidate
 * (`completionLetterDoc()`): step 4's list and the review hub both show it.
 * Optional in words and in behaviour — it is outside the documents the
 * office must verify, so it never holds onboarding up.
 */
export function CompletionLetterOption({ doc }: { doc: UploadedDoc | null }) {
  const status = doc?.status ?? null;
  const meta =
    status === 'pending'
      ? 'With the office for review. Your weekly limit stays as it is until they approve it.'
      : status === 'verified'
        ? 'Approved — your limit rises to 48 h/week from your course completion date.'
        : status === 'rejected'
          ? `Not accepted · “${doc?.rejectionReason ?? 'see the office'}”`
          : 'Optional · finished your course already? Upload it now and the office can lift your weekly limit to 48 hours.';
  const upload = status === null || status === 'rejected' || status === 'superseded';

  return (
    <div className={`docrow ${status === 'verified' ? 'verified' : upload ? '' : 'pending'}`}>
      <span className="ico">{docIcon(doc)}</span>
      <div>
        <div className="t">University completion letter</div>
        <div className={`m ${status === 'rejected' ? 'coral' : ''}`}>{meta}</div>
      </div>
      <div className="right">
        {upload ? (
          <Link className="btn outline sm" href={ONBOARDING_COMPLETION_HREF}>
            {status === 'rejected' ? 'Re-upload' : 'Upload'}
          </Link>
        ) : (
          <Pill tone={status === 'verified' ? 'green' : 'amber'}>
            {status === 'verified' ? 'Approved' : 'In review'}
          </Pill>
        )}
      </div>
    </div>
  );
}
