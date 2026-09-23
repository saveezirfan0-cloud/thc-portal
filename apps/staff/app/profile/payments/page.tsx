import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert, EmptyState } from '@thc/ui';
import { ProfileShell } from '../_components/ProfileShell';
import { appLock, canReachPayments } from '../lock';
import { loadEarnings, loadProfile, supabaseConfigured } from '../data';
import { signOwnPhoto } from '../photos';
import { BankForm } from './BankForm';
import { EarningsCard } from './EarningsCard';
import { formatMoney, paidShifts, paidThisMonth } from './earnings';
import { payMonthLabel } from './pay-date';
import '../profile.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payment information · THC Staff' };

/**
 * /profile/payments — §10.1's Payment information, two tabs.
 *
 * This is the one screen a leaver keeps (§10.6 step 7): "the worker can
 * still sign in and still reach Payment information, so their earnings
 * history stays available to them after they leave." `canReachPayments()`
 * is where that is decided, and it is the only place a leaver is let past
 * the lock.
 *
 * The tabs are two URLs rather than client state, so the back button works
 * and a link into Bank & payroll lands there.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const bankTab = tab === 'bank';

  if (!supabaseConfigured()) {
    return (
      <ProfileShell
        title="Payment information"
        back={{ href: '/profile', label: 'Profile' }}
        lock="none"
        name="THC"
      >
        <Alert tone="coral">
          This environment has no Supabase project, so your earnings cannot be read. See
          docs/04-setup-github-vercel-supabase.md.
        </Alert>
      </ProfileShell>
    );
  }

  const profile = await loadProfile();
  if (!profile) redirect('/profile');

  const lock = appLock(profile);
  if (!canReachPayments(lock)) redirect('/profile');

  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const rows = bankTab ? [] : await loadEarnings();
  const paid = paidShifts(rows);
  const month = paidThisMonth(rows);

  return (
    <ProfileShell
      title="Payment information"
      back={{ href: '/profile', label: 'Profile' }}
      lock={lock}
      name={name}
      photoUrl={await signOwnPhoto(profile.photoPath)}
    >
      <div className="mtabs">
        <Link href="/profile/payments" className={bankTab ? undefined : 'active'}>
          Earnings history
        </Link>
        <Link href="/profile/payments?tab=bank" className={bankTab ? 'active' : undefined}>
          Bank &amp; payroll
        </Link>
      </div>

      {bankTab ? (
        <BankForm bank={profile.bank} />
      ) : paid.length === 0 ? (
        <EmptyState>
          <h3>No earnings yet</h3>
          Your first paid shift will appear here after the Friday it’s paid. You’re paid the Friday
          after the week you worked.
        </EmptyState>
      ) : (
        <>
          {month.count > 0 ? (
            <div className="paid-total">
              <span className="label">Paid so far · {payMonthLabel(`${month.month}-01`)}</span>
              <span className="v">{formatMoney(month.totalPence)}</span>
              <span className="xs muted">
                Base pay only. Payslips and holiday pay come from payroll, not this app.
              </span>
            </div>
          ) : null}
          {paid.map((row) => (
            <EarningsCard key={row.bookingId} row={row} />
          ))}
        </>
      )}
    </ProfileShell>
  );
}
