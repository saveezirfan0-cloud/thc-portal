import { AuthCard } from '@thc/ui';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in · THC Back Office' };

/**
 * The privacy notice (§1.7) lives on the Staff App, a different deployment,
 * so its origin is the same NEXT_PUBLIC_STAFF_URL the activation links use.
 * Unset in production means no link rather than one to localhost.
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
      product="Back Office"
      footer={
        <>
          Staff use the mobile app — accounts are activated from the personal link in the acceptance
          email, not from this page.
          {privacy ? (
            <>
              {' '}
              <a href={privacy}>Privacy notice</a>
            </>
          ) : null}
        </>
      }
    >
      <LoginForm next={next} />
    </AuthCard>
  );
}
