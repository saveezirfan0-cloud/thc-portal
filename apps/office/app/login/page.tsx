import { AuthCard } from '@thc/ui';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in · THC Back Office' };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthCard
      product="Back Office"
      footer={
        <>
          Staff use the mobile app — accounts are activated from the personal link in the acceptance
          email, not from this page.
        </>
      }
    >
      <LoginForm next={next} />
    </AuthCard>
  );
}
