import { AuthCard } from '@thc/ui';
import { ForgotForm } from './ForgotForm';

export const metadata = { title: 'Reset your password · THC Client Portal' };

/** A1 Forgot password — §10.2, `wireframes/client/login.html` (forgot). */
export default function Page() {
  return (
    <AuthCard product="Client Portal" heading="Reset your password">
      <ForgotForm />
    </AuthCard>
  );
}
