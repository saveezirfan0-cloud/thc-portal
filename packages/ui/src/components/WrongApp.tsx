import { AuthCard } from './AuthCard';
import { SignOut } from './SignOut';

export interface WrongAppProps {
  /** This app, under the company name: "Back Office", "Client Portal", "Staff App". */
  product: string;
  /** "This account is not for the Back Office" — `wrongAppCopy()` in @thc/db. */
  title: string;
  /** Which account is signed in, and what to do. */
  body: string;
}

/**
 * The page a signed-in account sees when it opens an app its role has no
 * business in (an admin on the Client Portal, a worker on the Back Office).
 *
 * It is the sign-in card — the logo, the font, the appearance switch and
 * the reader's own light or dark (ADR-0007) — because it is the same moment
 * as sign-in, one step on: it used to be a bare inline-styled page that
 * followed the device, not the reader's choice, and drew no logo (release
 * audit 14.10.2026). The only way on is to sign out; the button POSTs, as
 * every sign-out does (§1.4).
 */
export function WrongApp({ product, title, body }: WrongAppProps) {
  return (
    <AuthCard product={product} heading={title}>
      <p className="muted">{body}</p>
      <SignOut tone="primary" size="md" block />
    </AuthCard>
  );
}
