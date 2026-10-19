import { Suspense, cache } from 'react';
import { notFound } from 'next/navigation';
import {
  Alert,
  Skeleton,
  SkeletonPanel,
  SkeletonScreen,
  SkeletonText,
  SkeletonToolbar,
} from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { currentOfficeRole } from '../../_components/officeUser';
import { officeCan } from '../../_lib/permissions';
import type { OfficeRole } from '../../_lib/permissions';
import { loadProfile } from './data';
import { loadProfileHead } from './head';
import { canMessageWorker } from '../message';
import { ProfileCrumbs } from './chrome';
import { ProfileScreen } from './ProfileScreen';
import './profile.css';

export const metadata = { title: 'Staff profile · THC Back Office' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The whole profile, once per request: started by the page, read by the body. */
const profileView = cache(loadProfile);

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
 *
 * Streaming (ADR-0161). The profile is two dozen reads (`loadProfile`); the
 * page starts them, then waits only for the profile's first read — one row
 * of the same view — and answers the 404 there, before anything streams.
 * The shell and the topbar's name paint at once; the profile streams in
 * behind a skeleton of its header. The tabs change `?tab=` through the
 * History API (`useListQuery`), never a router navigation, so the boundary
 * never sits under a query-only navigation (ADR-0109).
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A malformed id names nobody: a 404, as an unknown one is — not the
  // database's "invalid input syntax for type uuid" in a coral panel.
  if (!UUID.test(id)) notFound();
  // Started now, so the profile's reads run while the head is read below.
  // The body awaits the same promise; a failure is its to show.
  profileView(id).catch(() => undefined);
  const [head, role] = await Promise.all([loadProfileHead(id), currentOfficeRole()]);

  if (head.problem) {
    return (
      <OfficeShell activeHref="/staff" title="Staff">
        <Alert tone="coral">{head.problem}</Alert>
      </OfficeShell>
    );
  }
  // Decided before the Suspense below, so the answer is a real 404.
  if (!head.profile) notFound();

  return (
    <OfficeShell
      activeHref="/staff"
      title="Staff"
      crumbs={
        <ProfileCrumbs name={head.profile.display_name} employee={head.profile.employee_id} />
      }
    >
      <Suspense fallback={<ProfileSkeleton />}>
        <Profile id={id} role={role} />
      </Suspense>
    </OfficeShell>
  );
}

async function Profile({ id, role }: { id: string; role: OfficeRole | null }) {
  const data = await profileView(id);
  if (data.problem) return <Alert tone="coral">{data.problem}</Alert>;
  // Read a moment ago by the head; gone now (a removal in between).
  if (!data.profile) {
    return (
      <Alert tone="coral">This worker can no longer be found. Go back to the directory.</Alert>
    );
  }

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
      bare
      data={data}
      canCorrectDob={officeCan(role, 'identity')}
      canEditGender={officeCan(role, 'write')}
      canEditPassportCountry={officeCan(role, 'write')}
      canEditLanguages={officeCan(role, 'write')}
      canEditScheduling={officeCan(role, 'write')}
      canEditPayrollId={finance && officeCan(role, 'write')}
      showPayRate={finance}
      canEditPayRate={finance && officeCan(role, 'write')}
      canMessage={canMessageWorker(data.profile.status, officeCan(role, 'write'))}
    />
  );
}

/** The profile's shape while it is read: its header, the tabs, a panel. */
function ProfileSkeleton() {
  return (
    <SkeletonScreen label="Loading the profile">
      <div className="phead">
        <Skeleton shape="avatar" />
        <div className="who">
          <SkeletonText lines={3} />
        </div>
      </div>
      <SkeletonToolbar controls={5} />
      <SkeletonPanel rows={5} />
    </SkeletonScreen>
  );
}
