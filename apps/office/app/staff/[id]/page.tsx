import { notFound } from 'next/navigation';
import { Alert } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { loadProfile } from './data';
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
  const data = await loadProfile(id);

  if (data.problem) {
    return (
      <OfficeShell activeHref="/staff" title="Staff">
        <Alert tone="coral">{data.problem}</Alert>
      </OfficeShell>
    );
  }
  if (!data.profile) notFound();

  return <ProfileScreen data={data} />;
}
