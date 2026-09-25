import { AuthCard } from '@thc/ui';
import { ForgotForm } from './ForgotForm';

export const metadata = { title: 'Reset your password · THC Back Office' };

/** A1 Forgot password — §10.2, `wireframes/backoffice/login.html` (forgot). */
export default function Page() {
  return (
    <AuthCard product="Back Office" heading="Reset your password">
      <ForgotForm />
    </AuthCard>
  );
}
