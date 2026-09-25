import { Logo } from '@thc/ui';
import '../apply/apply.css';
import './privacy.css';

export const metadata = {
  title: 'Privacy notice · The Hospitality Company',
  description: 'How The Hospitality Company uses the personal data of applicants and staff.',
};

const CONTACT_EMAIL = 'admin@thehospitalitycompany.co.uk';

/**
 * `/privacy` — the notice the GDPR consent on `/apply` links to (§1.7, §2.1).
 *
 * Public: no session, no app chrome. It is in the Staff App middleware's
 * PUBLIC_PATHS, because an applicant reads it BEFORE ticking the consent box
 * and has no account yet (D3). The Back Office and Client Portal sign-in
 * footers link here too.
 *
 * ===========================================================================
 * PLACEHOLDER — REPLACE WITH THC'S LEGAL TEXT WHEN SUPPLIED.
 *
 * Everything below is a plain-language summary of what the system actually
 * does, taken from the scope (docs/scope/scope-of-work-v1.6.txt) and the
 * ADRs; the source section is cited in a comment beside each point. It is
 * NOT a solicitor's privacy notice: it names no lawful bases, no controller
 * details, no ICO complaint route and no international-transfer terms. When
 * THC (or their solicitor) supply the notice, replace the body of this page
 * with it and keep the route, the metadata and the PUBLIC_PATHS entry.
 *
 * The completion-letter retention point follows ADR-0019, whose point 1 is
 * still pending THC's confirmation.
 * ===========================================================================
 */
export default function Page() {
  return (
    <div className="apply-page privacy-page">
      <div className="auth-wrap">
        <article className="auth-card" aria-labelledby="privacy-title">
          <div className="brand">
            <Logo size="lg" />
            <div>
              <div className="name">The Hospitality Company</div>
              <div className="sub">Privacy notice</div>
            </div>
          </div>

          <h2 id="privacy-title">How we use your personal data</h2>
          <p className="lead">
            This notice explains what The Hospitality Company (&ldquo;THC&rdquo;, &ldquo;we&rdquo;)
            holds about you when you apply to work with us and when you work shifts through the
            Staff App, who can see it, how long we keep it, and how to have it removed.
          </p>
          <p className="notice" role="note">
            This is a summary. THC&rsquo;s full legal privacy notice will replace this page. Until
            then, send any questions to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>

          <section aria-labelledby="privacy-hold">
            <h3 id="privacy-hold">What we hold</h3>
            <ul>
              {/* §1.7, §2.1, §2.4 */}
              <li>
                <b>When you apply:</b> your first name, surname, email, mobile number and age. You
                must be 18 or over; we check this on the form and again on our server. Your details
                are passed to Willo, our video-interview provider, so it can send you the interview
                invitation.
              </li>
              {/* ADR-0040 (Refer a friend, proposed): the /apply?ref= link.
                  Placeholder wording — THC's legal text is pending (Q20). The
                  office sees who referred whom; the person who referred you
                  sees a count only, never your name. */}
              <li>If a friend referred you, we record who referred you.</li>
              {/* §2.5, §2.8, §2.10, §2.11, §4.5, §10.3 step order */}
              <li>
                <b>While you onboard:</b> your right-to-work documents and the result of the gov.uk
                share-code check, your home address, a profile selfie, your documents including the
                criminal-conviction declaration, your health &amp; safety quiz result, the HMRC New
                Starter Checklist, your National Insurance number, two references, your bank and
                payroll details and your signed contract. Students also give us their university
                term dates and, when they finish, their university completion letter.
              </li>
              {/* §2.6 */}
              <li>
                <b>Reading your documents:</b> an AI service reads each document you upload to take
                the expiry date (and, for students, term and completion dates) onto your profile. A
                manager still checks every document.
              </li>
              {/* §5 (check-in/out, GPS during the shift), §9.10 feedback. ADR-0001:
                  the PWA records a fix while the app is open (Option A); the
                  background version ships only if THC confirms Option B, and this
                  sentence must not claim it before then. */}
              <li>
                <b>While you work:</b> the shifts you are offered, accept and work; your check-in
                and check-out times; your GPS location while the app is open during a shift, to show
                you were on site; and ratings and feedback from our office and our clients.
              </li>
            </ul>
          </section>

          <section aria-labelledby="privacy-see">
            <h3 id="privacy-see">Who can see it</h3>
            <ul>
              {/* §10.7 access */}
              <li>
                <b>THC&rsquo;s office</b> — the people who run onboarding, rotas and payroll.
                Details of a criminal-conviction declaration are visible to admin users only.
              </li>
              {/* §11.1, §11.2, §11.3 */}
              <li>
                <b>Our clients</b> see only the name, photo and role of the confirmed staff on their
                own events, and can leave feedback on them. They never see your pay, contact
                details, address or documents. The timesheet and allocation sheet sent to a client
                for an event show the names and photos of the staff who worked it.
              </li>
              {/* §1.7 "TLS in transit, encryption at rest, role-based access" */}
              <li>
                Your data is protected in transit and at rest, and every screen shows each person
                only what their role allows.
              </li>
            </ul>
          </section>

          <section aria-labelledby="privacy-keep">
            <h3 id="privacy-keep">How long we keep it</h3>
            <ul>
              <li>
                While you are applying or working with us, we keep your details for as long as they
                are needed for that purpose.
              </li>
              {/* §10.6 "employment records THC has to keep" */}
              <li>
                <b>When you stop working with us</b>, your profile, documents and work history are
                kept as the employment records THC is required to hold.
              </li>
              {/* ADR-0019 §1; completion-letter requirement §4 */}
              <li>
                <b>Right-to-work evidence</b> is kept for the length of your employment plus two
                years after it ends. Your university completion letter is held for that period even
                if you ask to be removed, because the law requires us to be able to show it; it is
                then deleted automatically.
              </li>
            </ul>
          </section>

          <section aria-labelledby="privacy-remove">
            <h3 id="privacy-remove">Having your data removed</h3>
            {/* §1.7 "Remove from system"; §10.6 leaving is not removal */}
            <p>
              Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> to ask for your personal
              data to be removed. Leaving through the app does not remove it on its own; removal is
              a separate request. The office confirms it twice, and after that it cannot be undone:
            </p>
            <ul>
              <li>
                Your name is replaced with <b>&ldquo;Deleted account #id&rdquo;</b>, and your
                contact details, documents, bank details and photo are wiped.
              </li>
              <li>Your login is disabled and any future shifts are released.</li>
              <li>
                Your work history — past shifts and feedback — is kept for reporting, shown under
                &ldquo;Deleted account #id&rdquo;. Feedback comments are kept as written; ask us and
                the office will edit your name out of them.
              </li>
              {/* §1.7, §11.3 already-issued PDFs */}
              <li>
                Timesheets and allocation sheets already sent to a client before your request stay
                exactly as issued, because they are a billing and HMRC record. Any copy produced
                afterwards shows &ldquo;Deleted account #id&rdquo; and no photo.
              </li>
              {/* §10.7 retention */}
              <li>
                If you made a criminal-conviction declaration, its details are wiped; the fact that
                one was made and its review outcome stay on the compliance record.
              </li>
              {/* ADR-0019 §1 */}
              <li>
                The one exception to the wipe is the right-to-work evidence we must keep, described
                above.
              </li>
            </ul>
          </section>

          <section aria-labelledby="privacy-contact">
            <h3 id="privacy-contact">Contact</h3>
            <p>
              Questions about this notice or your data:{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          </section>

          <p className="foot">
            <a href="/apply">Back to the application form</a>
          </p>
        </article>
      </div>
    </div>
  );
}
