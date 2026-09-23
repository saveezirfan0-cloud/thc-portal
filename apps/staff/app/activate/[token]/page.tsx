import type { Metadata } from 'next';
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
  const heading = person?.firstName
    ? `Welcome, ${person.firstName} — set your password`
    : 'Welcome — set your password';

  return (
    <AuthCard
      product="Account activation"
      heading={heading}
      footer={
        <>
          {PERSONAL_NOTE} Expired? Write to <a href={`mailto:${HELP_EMAIL}`}>{HELP_EMAIL}</a>.
        </>
      }
    >
      <p className="sm muted">
        Your interview was accepted. Create a password to activate your account
        {person?.email ? (
          <>
            {' '}
            for <b className="mono">{person.email}</b>
          </>
        ) : null}
        .
      </p>
      <ActivateForm token={token} type={parseActivationType(type)} person={person} />
    </AuthCard>
  );
}

/** Best-effort: null when the service key is absent or the lookup fails. */
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
        data: { firstName?: string; lastName?: string; email?: string } | null;
        error: { message: string } | null;
      }>;
    };
    const { data, error } = await admin.rpc('activation_preview', { p_token_hash: token });
    if (error || !data) return null;
    return { firstName: data.firstName, lastName: data.lastName, email: data.email };
  } catch {
    return null;
  }
}
