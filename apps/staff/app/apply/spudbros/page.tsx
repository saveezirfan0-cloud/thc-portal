import { AuthCard } from '@thc/ui';
import { ApplyForm } from '../ApplyForm';
import { referralCodeFrom } from '../form';
import '../apply.css';

export const metadata = {
  title: 'SpudBros Express onboarding · The Hospitality Company',
  description: 'Complete your onboarding with The Hospitality Company as SpudBros Express staff.',
};

/**
 * `/apply/spudbros` (ADR-0103) — the application for SpudBros Express staff.
 *
 * The same form, the same checks, the same interview and the same eleven
 * onboarding steps as `/apply`: what differs is who they are afterwards. A
 * candidate who comes through here is marked SpudBros Express staff by the
 * database (`record_application_source`), so once their documents are
 * verified they stay off the rota here — their shifts are on Connecteam —
 * unless the office switches THC shifts on for them.
 *
 * A separate page, not a query string on `/apply`, so the two applications
 * stay different on purpose: their own wording now and their own steps later
 * (the wizard's last step reads from the same marker). The marker rides in a
 * hidden field that only this page renders, and the database applies it to
 * the candidate THIS submission created — never to an existing worker.
 */
export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ ref?: string | string[] }>;
}) {
  const params = searchParams ? await searchParams : {};
  return (
    <div className="apply-page">
      <AuthCard
        product="SpudBros Express team"
        heading="Onboarding with The Hospitality Company"
        appearance="none"
      >
        <p className="lead" style={{ marginTop: 0 }}>
          Your Right to Work check and onboarding are done with us in this app. Your shifts and
          scheduling stay on Connecteam.
        </p>
        <ApplyForm referralCode={referralCodeFrom(params.ref)} source="spudbros" />
      </AuthCard>
    </div>
  );
}
