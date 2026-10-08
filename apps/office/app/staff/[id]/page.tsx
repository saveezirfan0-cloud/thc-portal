import { notFound } from 'next/navigation';
import { Alert } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { currentOfficeRole } from '../../_components/officeUser';
import { officeCan } from '../../_lib/permissions';
import { loadProfile } from './data';
import { canMessageWorker } from '../message';
import { ProfileScreen } from './ProfileScreen';

export const metadata = { title: 'Staff profile · THC Back Office' };

/**
 * /staff/:id — §9.6, `wireframes/backoffice/staff-profile.html`.
 *
 * Read on the server. §1.7's anonymisation and every mask are applied in
 * the views, so nothing this page holds could print a personal detail a
 * GDPR removal was meant to retire.
 *
 * A worker who does not exist is a 404, not an error panel: it is not a
 * fault the manager can do anything about. A worker who exists but cannot
 * be read — no Supabase project, or a policy refusing — is, so that stays
 * a message.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, role] = await Promise.all([loadProfile(id), currentOfficeRole()]);

  if (data.problem) {
    return (
      <OfficeShell activeHref="/staff" title="Staff">
        <Alert tone="coral">{data.problem}</Alert>
      </OfficeShell>
    );
  }
  if (!data.profile) notFound();

  // ADR-0070: "Correct" on the date of birth is for owners and managers;
  // office_correct_dob() refuses everyone else whatever this says.
  // ADR-0072: the Pay rate card is money — finance roles only (a scheduler
  // reads no staff_pay_rates row anyway); a viewer reads it, and only a
  // role that may also write gets Set / Edit / Clear.
  // ADR-0082: Send push for any login that may write, never on a removed
  // profile; send_staff_message() refuses a viewer whatever this says.
  const finance = officeCan(role, 'finance');
  return (
    <ProfileScreen
      data={data}
      canCorrectDob={officeCan(role, 'identity')}
      canEditGender={officeCan(role, 'write')}
      canEditLanguages={officeCan(role, 'write')}
      canEditScheduling={officeCan(role, 'write')}
      canEditPayrollId={finance && officeCan(role, 'write')}
      showPayRate={finance}
      canEditPayRate={finance && officeCan(role, 'write')}
      canMessage={canMessageWorker(data.profile.status, officeCan(role, 'write'))}
    />
  );
}
