import { cookies } from 'next/headers';
import { SENT_TO_COOKIE } from '../form';
import '../apply.css';

export const metadata = {
  title: 'Application sent · The Hospitality Company',
  description: 'Your application has been sent.',
};

/**
 * `/apply/submitted` (§2.7) — the one confirmation screen.
 *
 * A returning applicant (§2.12) sees exactly this, and is never told that a
 * record already existed or why it was blocked. Nothing on this page comes
 * from the outcome of the submission, which is the point.
 */
export default async function Page() {
  // Written by the server action for this visitor only, and expires in ten
  // minutes. Its absence is not an error: the screen simply omits the line.
  const sentTo = (await cookies()).get(SENT_TO_COOKIE)?.value;

  return (
    <div className="apply-page">
      <div className="auth-wrap">
        <section className="auth-card done">
          <div className="brand">
            <span className="logo round" aria-hidden="true">
              THC
            </span>
            <div>
              <div className="name">The Hospitality Company</div>
              <div className="sub">Join our team</div>
            </div>
          </div>

          <span className="ico" aria-hidden="true">
            ✓
          </span>
          <h2>Check your inbox</h2>
          <p className="lead">
            We&apos;ve sent you an email from <b style={{ color: 'var(--text)' }}>Willo</b> with a
            link to your video interview. Complete it whenever you&apos;re ready — it takes about
            ten minutes and you can record it on your phone.
          </p>

          <div className="box">
            {sentTo ? (
              <div className="row">
                <span className="label">Sent to</span>
                <span className="mono sm">{sentTo}</span>
              </div>
            ) : null}
            <div className="row" style={{ marginTop: sentTo ? 8 : 0 }}>
              <span className="label">From</span>
              <span className="mono sm">Willo (interview invitation)</span>
            </div>
          </div>

          <p className="xs muted">
            Can&apos;t find it? Check your spam folder, or write to{' '}
            <a href="mailto:admin@thehospitalitycompany.co.uk">admin@thehospitalitycompany.co.uk</a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
