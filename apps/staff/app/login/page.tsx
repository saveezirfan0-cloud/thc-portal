import { isSafeRelativePath } from '@thc/db';
import { AuthCard } from '@thc/ui';
import { LoginForm } from './LoginForm';
import './auth-tap.css';

export const metadata = { title: 'Sign in · THC Staff' };

/** A0 Login — §10.2, wireframes/staff/auth.html: "Staff app", and the footer verbatim. */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthCard
      product="Staff app"
      footer={
        <>
          No account yet? Your login is created when the office accepts your interview — look for
          the activation email from admin@thehospitalitycompany.co.uk.
        </>
      }
    >
      {/* Not reflected into the form unless it is a path on this app (§1.4). */}
      <LoginForm next={isSafeRelativePath(next) ? next : undefined} />
    </AuthCard>
  );
}
