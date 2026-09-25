import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@thc/ui';
import { createAdminClient } from '@thc/db/admin';
import { isActivationToken, parseActivationType } from '@thc/db/activation';
import type { Personal } from '../rules';
import { HELP_EMAIL, PERSONAL_NOTE } from '../copy';
import { ActivateForm } from './ActivateForm';
import { LinkSpent } from '../LinkSpent';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Activate your account · THC Staff',
  // The token is in this page's URL. No Referer carries it anywhere, and
  // no search engine keeps it.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/**
 * /activate/:token — §1.4, §2.7, §2.8 (E3), §10.2,
 * wireframes/public/activate.html ("Activate · set password").
 *
 * Public (middleware PUBLIC_PATHS). Nothing on this page spends the
 * token: it is verified by the form's server action when the candidate
 * presses "Activate my account", because mail scanners open the link
 * first. What the page does read is who the link is for — a read-only
 * lookup with the service key (`activation_preview`) — so the greeting and
 * the "not your name or email" rule can work as they type. If that lookup
 * cannot run, the form still does: the action checks the same rule against
 * the account once the token is verified.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const { token } = await params;
  const { type } = await searchParams;

  if (!isActivationToken(token)) {
    return (
      <AuthCard product="Account activation" heading="This link doesn’t work">
        <LinkSpent />
      </AuthCard>
    );
  }

  const person = await preview(token);
  const footer = (
    <>
      {PERSONAL_NOTE} Expired? Write to <a href={`mailto:${HELP_EMAIL}`}>{HELP_EMAIL}</a>.
    </>
  );

  // "The activation link is single-use; a second click shows the sign-in
  // screen" (activate.html). Nothing is spent to learn this: the preview
  // says whether the account already has a password, when it can.
  if (person?.activated) {
    return (
      <AuthCard product="Account activation" heading="You’re already activated" footer={footer}>
        <p className="sm muted">
          This link has been used and your password is set. Sign in with it to carry on.
        </p>
        <Link href="/login" className="btn primary block lg">
          Sign in
        </Link>
      </AuthCard>
    );
  }

  const heading = person?.firstName
    ? `Welcome, ${person.firstName} — set your password`
    : 'Welcome — set your password';

  return (
    <ActivateForm
      token={token}
      type={parseActivationType(type)}
      person={person}
      heading={heading}
      footer={footer}
      lead={
        <>
          Your interview was accepted. Create a password to activate your account
          {person?.email ? (
            <>
              {' '}
              for <b className="mono">{person.email}</b>
            </>
          ) : null}
          .
        </>
      }
    />
  );
}

/**
 * Best-effort: null when the service key is absent or the lookup fails.
 * `activated` is read when `activation_preview` returns it (a spent link
 * with the password already set); a preview without it is a form, as before.
 */
async function preview(token: string): Promise<Personal | null> {
  if (!process.env['SUPABASE_SERVICE_ROLE_KEY'] || !process.env['NEXT_PUBLIC_SUPABASE_URL']) {
    return null;
  }
  try {
    const admin = createAdminClient() as unknown as {
      rpc(
        fn: 'activation_preview',
        args: { p_token_hash: string },
      ): PromiseLike<{
        data: {
          firstName?: string;
          lastName?: string;
          email?: string;
          activated?: boolean;
        } | null;
        error: { message: string } | null;
      }>;
    };
    const { data, error } = await admin.rpc('activation_preview', { p_token_hash: token });
    if (error || !data) return null;
    return {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      activated: data.activated === true,
    };
  } catch {
    return null;
  }
}
