import { isSafeRelativePath } from '@thc/db';
import { AuthCard } from '@thc/ui';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in · THC Staff' };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthCard
      product="Staff"
      footer={
        <>
          New here? Use the personal link in your acceptance email to set a password, then sign in.
        </>
      }
    >
      {/* Not reflected into the form unless it is a path on this app (§1.4). */}
      <LoginForm next={isSafeRelativePath(next) ? next : undefined} />
    </AuthCard>
  );
}
