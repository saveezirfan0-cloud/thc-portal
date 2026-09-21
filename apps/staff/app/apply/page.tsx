import type { Metadata } from 'next';
import { AuthCard } from '@thc/ui';
import { ApplyForm } from './ApplyForm';
import './apply.css';

export const metadata: Metadata = {
  title: 'Apply to work with us · The Hospitality Company',
  description:
    'Apply to join The Hospitality Company. Two minutes, then a short video interview link by email.',
};

/**
 * Public application form (§2.1).
 *
 * Public URL, no registration, no login and no app shell — `/apply` is in
 * the staff app's PUBLIC_PATHS (middleware.ts) and most applicants reach
 * it from a phone browser, long before there is an account to install an
 * app into.
 */
export default function Page() {
  return (
    <div className="apply-page">
      <AuthCard
        product="Join our team"
        heading="Apply to work with us"
        footer={
          <>
            Questions?{' '}
            <a href="mailto:admin@thehospitalitycompany.co.uk">admin@thehospitalitycompany.co.uk</a>
          </>
        }
      >
        <ApplyForm />
      </AuthCard>
    </div>
  );
}
