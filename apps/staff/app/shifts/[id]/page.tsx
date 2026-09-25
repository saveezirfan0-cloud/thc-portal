import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert } from '@thc/ui';
import { StaffShell } from '../../_components/StaffShell';
import { loadBookings, openInvites } from '../../data';
import { loadProfile } from '../../profile/data';
import { shiftsBadge } from '../list';
import { loadShift, supabaseConfigured } from './data';
import { ShiftScreen } from './ShiftScreen';
import '../../staff-app.css';
import '../shifts.css';
import './shift.css';

export const metadata = { title: 'Shift · THC' };
/** The shift screen is the state of right now; nothing may be cached. */
export const dynamic = 'force-dynamic';

/**
 * `/shifts/:id` — §10.4, §5.1–5.2b.
 *
 * Rendered through `StaffShell` like every other working screen, so the
 * §10.1 app lock, the four tabs with their lock state and counts, and the
 * profile behind the avatar are the same here as on the list a worker came
 * from. The header carries the wireframe's "‹ Shifts" way back above the
 * title.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!supabaseConfigured()) {
    return (
      <StaffShell title="Shift" active="/shifts">
        <Alert tone="coral">
          This environment has no Supabase project, so the shift cannot be read. See
          docs/04-setup-github-vercel-supabase.md.
        </Alert>
      </StaffShell>
    );
  }

  // `staff_bookings()` resolves the caller itself: another worker's id
  // returns nothing rather than their shift.
  const [bookings, profile] = await Promise.all([loadBookings(), loadProfile()]);
  const shift = await loadShift(id, bookings);
  if (!shift) notFound();

  return (
    <StaffShell
      title={
        <>
          <Link href="/shifts" className="back">
            ‹ Shifts
          </Link>
          {shift.eventTitle} · {shift.roleName}
        </>
      }
      active="/shifts"
      shifts={shiftsBadge(bookings)}
      invites={openInvites(bookings).length}
    >
      <ShiftScreen shift={shift} firstName={profile?.firstName ?? null} />
    </StaffShell>
  );
}
