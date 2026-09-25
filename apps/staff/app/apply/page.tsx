import { AuthCard } from '@thc/ui';
import { ApplyForm } from './ApplyForm';
import './apply.css';

export const metadata = {
  title: 'Apply · The Hospitality Company',
  description: 'Apply to work with The Hospitality Company.',
};

/**
 * `/apply` (§2.1) — a public URL with no registration and no login. The
 * middleware already lists it as public; it deliberately renders none of the
 * app's chrome.
 */
export default function Page() {
  return (
    <div className="apply-page">
      {/* The public card draws no appearance switch in any state (apply.html). */}
      <AuthCard product="Join our team" heading="Apply to work with us" appearance="none">
        <ApplyForm />
      </AuthCard>
    </div>
  );
}
