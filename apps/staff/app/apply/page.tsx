import { AuthCard } from '@thc/ui';
import { ApplyForm } from './ApplyForm';
import { referralCodeFrom } from './form';
import './apply.css';

export const metadata = {
  title: 'Apply · The Hospitality Company',
  description: 'Apply to work with The Hospitality Company.',
};

/**
 * `/apply` (§2.1) — a public URL with no registration and no login. The
 * middleware already lists it as public; it deliberately renders none of the
 * app's chrome.
 *
 * `/apply?ref={code}` (ADR-0040) is the same page: the code is checked for
 * shape and carried to the server action in a hidden field. Nothing on the
 * page changes with it — the applicant is never shown who referred them.
 */
export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ ref?: string | string[] }>;
}) {
  const params = searchParams ? await searchParams : {};
  const referralCode = referralCodeFrom(params.ref);
  return (
    <div className="apply-page">
      {/* The public card draws no appearance switch in any state (apply.html). */}
      <AuthCard product="Join our team" heading="Apply to work with us" appearance="none">
        <ApplyForm referralCode={referralCode} />
      </AuthCard>
    </div>
  );
}
