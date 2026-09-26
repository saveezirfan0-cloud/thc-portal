import { isSafeRelativePath } from '@thc/db';
import { AuthCard } from '@thc/ui';
import { LEAD } from './copy';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in · THC Client Portal' };

/**
 * The privacy notice (§1.7) lives on the Staff App, a different deployment,
 * so its origin is configuration: NEXT_PUBLIC_STAFF_URL, as in the Back
 * Office. Unset in production means no link rather than one to localhost.
 */
function privacyHref(): string | null {
  const origin =
    process.env['NEXT_PUBLIC_STAFF_URL'] ??
    (process.env.NODE_ENV === 'production' ? null : 'http://127.0.0.1:3001');
  return origin ? `${origin.replace(/\/$/, '')}/privacy` : null;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const privacy = privacyHref();
  return (
    <AuthCard
      product="Client Portal"
      footer={
        <>
          Access is set up by The Hospitality Company for your venue. Need an account? Email
          admin@thehospitalitycompany.co.uk
          {privacy ? (
            <>
              {' · '}
              <a href={privacy}>Privacy notice</a>
            </>
          ) : null}
        </>
      }
    >
      {/* login.html:62: what this portal is, under the heading. */}
      <p className="sm muted lead">{LEAD}</p>
      {/* Not reflected into the form unless it is a path on this app (§1.4). */}
      <LoginForm next={isSafeRelativePath(next) ? next : undefined} />
    </AuthCard>
  );
}
