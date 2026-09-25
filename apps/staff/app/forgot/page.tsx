import { AuthCard } from '@thc/ui';
import { ForgotForm } from './ForgotForm';
import '../login/auth-tap.css';

export const metadata = { title: 'Forgot password · THC Staff' };

/** A1 Forgot password — §10.2, wireframes/staff/auth.html. */
export default function Page() {
  return (
    <AuthCard product="Staff app" heading="Forgot your password?">
      <ForgotForm />
    </AuthCard>
  );
}
