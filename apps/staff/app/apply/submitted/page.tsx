import type { Metadata } from 'next';
import { AuthCard } from '@thc/ui';
import '../apply.css';

export const metadata: Metadata = {
  title: 'Check your inbox · The Hospitality Company',
  robots: { index: false, follow: false },
};

/** Loose on purpose — this only decides whether it is worth echoing back. */
const LOOKS_LIKE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The confirmation screen (§2.7) — and the whole of what an applicant is
 * ever told.
 *
 * §2.12 is explicit: a returning or duplicate applicant sees exactly this
 * screen and never the reason a previous record was blocked. So this page
 * reads nothing back from the database and takes no id; the address it
 * shows is the one the applicant just typed, echoed from the query string
 * purely so they can spot their own typo.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  const sentTo = email && LOOKS_LIKE_EMAIL.test(email) ? email : null;

  return (
    <div className="apply-page apply-done">
      <AuthCard
        product="Join our team"
        heading="Check your inbox"
        banner={
          <span className="ico" aria-hidden="true">
            ✓
          </span>
        }
        footer={
          <>
            Can&apos;t find it? Check your spam folder, or write to{' '}
            <a href="mailto:admin@thehospitalitycompany.co.uk">admin@thehospitalitycompany.co.uk</a>
            .
          </>
        }
      >
        <p className="lead">
          We&apos;ve sent you an email from <b>Willo</b> with a link to your video interview.
          Complete it whenever you&apos;re ready — it takes about ten minutes and you can record it
          on your phone.
        </p>
        <div className="box">
          {sentTo ? (
            <div className="row between">
              <span className="label">Sent to</span>
              <span className="mono sm">{sentTo}</span>
            </div>
          ) : null}
          <div className={`row between${sentTo ? ' mt-8' : ''}`}>
            <span className="label">From</span>
            <span className="mono sm">Willo (interview invitation)</span>
          </div>
        </div>
      </AuthCard>
    </div>
  );
}
