import { AuthCard } from '@thc/ui';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in · THC Client Portal' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthCard
      product="Client Portal"
      footer={
        <>
          Access is set up by The Hospitality Company for your venue. Need an account? Email
          admin@thehospitalitycompany.co.uk
        </>
      }
    >
      <LoginForm next={next} />
    </AuthCard>
  );
}
