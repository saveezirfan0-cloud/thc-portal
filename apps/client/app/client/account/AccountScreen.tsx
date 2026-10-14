import { Alert, PageHead, Panel } from '@thc/ui';
import { ACCOUNT_COPY, EMAILS_COPY } from './copy';
import { PasswordForm } from './PasswordForm';

/**
 * "Your account" (ADR-0051) — a deliberate, recorded addition to §11.
 *
 * Everything on it is read-only except the password: there is no input for
 * the name, the sign-in email, the company or the recipients, because
 * §11.1 says "Read-only — no editing whatsoever" and those are business
 * data the office keeps (§9.7). What the customer can do about them is the
 * third panel: ask the office.
 *
 * No money, no terms, nothing about workers: the page reads the caller's
 * own `profiles` row, their auth email, and `client_account_v` (name +
 * contact_emails, 606_client_account_view).
 */
export interface AccountDetails {
  name: string | null;
  email: string | null;
  company: string | null;
  recipients: string[];
  /**
   * Which of the two line-up emails THC sends this company (ADR-0135 §3);
   * null when the account could not be read.
   */
  lineupEmails?: { confirmed: boolean; changed: boolean } | null;
}

export interface AccountScreenProps {
  account: AccountDetails;
  officeEmail: string;
  problem?: string | null;
}

export function AccountScreen({ account, officeEmail, problem }: AccountScreenProps) {
  const subject = account.company ? `Account change · ${account.company}` : 'Account change';
  const mailto = `mailto:${officeEmail}?subject=${encodeURIComponent(subject)}`;

  return (
    <>
      <PageHead title={ACCOUNT_COPY.title} description={ACCOUNT_COPY.description} />
      {problem ? <Alert tone="amber">{problem}</Alert> : null}

      <div className="acct-grid">
        <Panel title="Your details" className="acct-details">
          <dl className="acct-dl">
            <Row k="Name">{account.name}</Row>
            <Row k="Sign-in email" mail>
              {account.email}
            </Row>
            <Row k="Company">{account.company}</Row>
          </dl>

          <section className="acct-recipients" aria-labelledby="acct-recipients-h">
            <h4 id="acct-recipients-h" className="acct-k">
              Timesheet emails go to
            </h4>
            <p className="acct-help">{ACCOUNT_COPY.recipientsHelp}</p>
            {account.recipients.length > 0 ? (
              <ul className="acct-list">
                {account.recipients.map((address) => (
                  <li key={address}>{address}</li>
                ))}
              </ul>
            ) : (
              <p className="acct-v muted">{ACCOUNT_COPY.noRecipients}</p>
            )}
          </section>

          {account.lineupEmails ? (
            <section className="acct-recipients" aria-labelledby="acct-emails-h">
              <h4 id="acct-emails-h" className="acct-k">
                {EMAILS_COPY.title}
              </h4>
              <p className="acct-help">{EMAILS_COPY.help}</p>
              <ul className="acct-list acct-emails">
                <li>
                  {EMAILS_COPY.documents} <span className="acct-on">{EMAILS_COPY.always}</span>
                </li>
                <li>
                  {EMAILS_COPY.confirmed} <OnOff on={account.lineupEmails.confirmed} />
                </li>
                <li>
                  {EMAILS_COPY.changed} <OnOff on={account.lineupEmails.changed} />
                </li>
              </ul>
              <p className="acct-help">{EMAILS_COPY.change}</p>
            </section>
          ) : null}
        </Panel>

        <div className="acct-side">
          <Panel title="Change password">
            <PasswordForm />
          </Panel>

          <Panel title="Need something changed?">
            <p className="acct-help">{ACCOUNT_COPY.managedByThc}</p>
            <div className="acct-contact">
              <a className="btn" href={mailto}>
                Email the office
              </a>
              <a className="acct-mail" href={mailto}>
                {officeEmail}
              </a>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

/** "On" / "Off" in words (never colour alone), for the emails list. */
function OnOff({ on }: { on: boolean }) {
  return (
    <span className={on ? 'acct-on' : 'acct-off'}>{on ? EMAILS_COPY.on : EMAILS_COPY.off}</span>
  );
}

function Row({ k, mail, children }: { k: string; mail?: boolean; children: string | null }) {
  return (
    <div className="acct-row">
      <dt className="acct-k">{k}</dt>
      <dd className={mail ? 'acct-v acct-mail' : 'acct-v'}>{children ?? '—'}</dd>
    </div>
  );
}
