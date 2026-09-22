import { notFound } from 'next/navigation';
import { AppBody, AppHeader, Alert, BottomNav } from '@thc/ui';
import { loadShift, supabaseConfigured } from './data';
import { ShiftScreen } from './ShiftScreen';
import './shift.css';

export const metadata = { title: 'Shift · THC' };
/** The shift screen is the state of right now; nothing may be cached. */
export const dynamic = 'force-dynamic';

// Invites and Radar exist now (§10.4), so they are links rather than the
// `pending` text this carried while they did not. Documents and Profile
// still do not, and Documents stays listed either way: it is the one tab an
// auto-blocked worker keeps (§10.1).
// The same four tabs in the same order as `_components/StaffShell`, which is
// the wireframes' order: tapping into a shift must not reorder the tab bar
// under the worker's thumb. Documents stays listed although it does not
// exist yet — it is the one tab an auto-blocked worker keeps (§10.1).
const NAV = [
  { href: '/documents', label: 'Documents', pending: true },
  { href: '/shifts', label: 'Shifts' },
  { href: '/invites', label: 'Invites' },
  { href: '/radar', label: 'Radar' },
];

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!supabaseConfigured()) {
    return (
      <>
        <AppHeader title="Shift" />
        <AppBody>
          <Alert tone="coral">
            This environment has no Supabase project, so the shift cannot be read. See
            docs/04-setup-github-vercel-supabase.md.
          </Alert>
        </AppBody>
        <BottomNav items={NAV} activeHref="/shifts" />
      </>
    );
  }

  // RLS decides this, not the route: `staff_self_bookings` means another
  // worker's id returns nothing rather than their shift.
  const shift = await loadShift(id);
  if (!shift) notFound();

  return (
    <>
      <ShiftScreen shift={shift} />
      <BottomNav items={NAV} activeHref="/shifts" />
    </>
  );
}
