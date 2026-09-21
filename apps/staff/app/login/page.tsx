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
      <LoginForm next={next} />
    </AuthCard>
  );
}
