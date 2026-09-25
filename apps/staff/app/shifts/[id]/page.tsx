import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Alert } from '@thc/ui';
import { LoadProblem } from '../../_components/LoadProblem';
import { StaffShell } from '../../_components/StaffShell';
import { loadBookings, openInvites } from '../../data';
import { readProfile } from '../../profile/data';
import { loadShift, supabaseConfigured } from './data';
import { shiftScreenReachable } from './phase';
import { ShiftScreen } from './ShiftScreen';
import '../../staff-app.css';
import './shift.css';

export const metadata = { title: 'Shift · THC Staff' };
/** The shift screen is the state of right now; nothing may be cached. */
export const dynamic = 'force-dynamic';

/**
 * `/shifts/:id` — §10.4, §5.1, `wireframes/staff/shift-detail.html`.
 *
 * Rendered through `StaffShell`, like every other working screen, so the
 * §10.1 app lock stands in front of it: an auto-blocked worker sees the
 * Documents-only screen, a held one the hold screen, a leaver the leaver
 * screen — never a check-in button reached by a deep link or a stale push.
 * The shell also owns the header and the four tabs, in the one order the
 * rest of the app uses.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `?checkin=1` — the today card's Check in (§10.4) opened this screen. */
  searchParams?: Promise<{ checkin?: string }>;
}) {
  const { id } = await params;
  const { checkin } = (await searchParams) ?? {};
  const back = <Link href="/shifts">‹ Shifts</Link>;

  if (!supabaseConfigured()) {
    return (
      <StaffShell title="Shift" sub={back} active="/shifts">
        <Alert tone="coral">
          This environment has no Supabase project, so the shift cannot be read. See
          docs/04-setup-github-vercel-supabase.md.
        </Alert>
      </StaffShell>
    );
  }

  // `staff_shift_detail()` answers for the caller's own bookings only:
  // another worker's id returns nothing rather than their shift.
  const [{ shift, problem }, { rows: bookings, problem: listProblem }, me] = await Promise.all([
    loadShift(id),
    loadBookings(),
    readProfile(),
  ]);

  // A read that FAILED is not a 404 (audit D18): "this shift doesn't exist"
  // to a worker who has one is how a No-show happens.
  if (problem) {
    return (
      <StaffShell title="Shift" sub={back} active="/shifts">
        <LoadProblem what="this shift" />
      </StaffShell>
    );
  }
  if (!shift) notFound();

  // An invitation has its own screen, with Accept and Decline.
  if (shift.status === 'invited') redirect(`/invites/${id}`);
  if (!shiftScreenReachable(shift)) notFound();

  return (
    <StaffShell
      title={`${shift.eventTitle} · ${shift.roleName}`}
      sub={back}
      active="/shifts"
      {...(listProblem
        ? {}
        : {
            shifts: bookings.filter((b) => b.status === 'confirmed' || b.status === 'worked')
              .length,
            invites: openInvites(bookings).length,
          })}
    >
      <ShiftScreen
        shift={shift}
        firstName={me.kind === 'ok' ? me.profile.firstName || null : null}
        autoCheckIn={checkin === '1'}
      />
    </StaffShell>
  );
}
