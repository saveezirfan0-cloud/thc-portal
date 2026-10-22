import Link from 'next/link';
import { OfficeShell } from '../../_components/OfficeShell';
import { staffUrlIsOffice } from '../../_lib/staffUrl';
import { loadReminderPage } from './data';
import { reminderPreviews } from './previews';
import { ReminderEmailsScreen } from './ReminderEmailsScreen';

export const metadata = { title: 'Reminder emails · Onboarding · THC Back Office' };

// Read per request with the manager's session — never prerendered.
export const dynamic = 'force-dynamic';

/**
 * The Staff App's origin for the links in the previews. It is another
 * deployment, so its origin is NEXT_PUBLIC_STAFF_URL, as for the activation
 * links; without it the live address stands in, since a preview only shows
 * the link.
 */
function staffOrigin(): string {
  const explicit = process.env['NEXT_PUBLIC_STAFF_URL'];
  const origin =
    explicit && !staffUrlIsOffice()
      ? explicit
      : process.env.NODE_ENV === 'production'
        ? 'https://staff.thehospitalitycompany.co.uk'
        : 'http://127.0.0.1:3001';
  return origin.replace(/\/$/, '');
}

/**
 * /onboarding/reminders — the daily reminders that chase a candidate through
 * onboarding (ADR-0071, ADR-0169, ADR-0186), their numbers, and a View of
 * each as it is sent (ADR-0193). A static segment under /onboarding, so
 * Next.js serves it ahead of `/onboarding/[id]`.
 */
export default async function Page() {
  const origin = staffOrigin();
  const { report, problem } = await loadReminderPage();
  return (
    <OfficeShell
      activeHref="/onboarding"
      title="Reminder emails"
      crumbs={
        <>
          <Link href="/onboarding">Onboarding</Link> / <b>Reminder emails</b>
        </>
      }
    >
      <ReminderEmailsScreen
        report={report}
        problem={problem}
        previews={reminderPreviews({
          appLink: `${origin}/onboarding`,
          activationLink: `${origin}/activate/sample-link`,
          installLink: `${origin}/install`,
        })}
      />
    </OfficeShell>
  );
}
