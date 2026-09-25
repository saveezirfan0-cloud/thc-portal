import { AuthCard } from '@thc/ui';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in · THC Staff' };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    // A0 (wireframes/staff/auth.html): the hero sub-line and the footer
    // sentence are the wireframe's, word for word. The footer names the
    // §9.12 sender, which is what a worker hunting for the activation
    // email (E3) needs to search their inbox for.
    <AuthCard
      product="Staff app"
      footer={
        <>
          No account yet? Your login is created when the office accepts your interview — look for
          the activation email from admin@thehospitalitycompany.co.uk.
        </>
      }
    >
      <LoginForm next={next} />
    </AuthCard>
  );
}
